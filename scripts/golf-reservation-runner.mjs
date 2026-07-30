import process from "node:process";
import { spawn } from "node:child_process";
import { updateReservation } from "./golf-store.mjs";
import { RESERVATION_WRITE_STARTED_MARKER } from "./golf-reservation-retry.mjs";

const targets = {
  "golf-tracker": {
    script: "scripts/golf-agent.mjs",
  },
  "jockey-palermo": {
    script: "scripts/jockey-agent.mjs",
    siteName: "JOCKEY",
    siteUrl: () => process.env.JOCKEY_URL || "https://golf.e-jockeyclub.org.ar/golf/login.php",
    defaultBookingText: () => process.env.JOCKEY_TOURNAMENT_TEXT || "AZUL",
    username: () => process.env.JOCKEY_USERNAME,
    password: () => process.env.JOCKEY_PASSWORD,
  },
  "club-newman": {
    script: "scripts/jockey-agent.mjs",
    siteName: "NEWMAN",
    siteUrl: () => process.env.NEWMAN_URL || "https://www.clubnewmangolf.com/golf/login.php",
    defaultBookingText: () => process.env.NEWMAN_TOURNAMENT_TEXT || "",
    username: () => process.env.NEWMAN_USERNAME || process.env.JOCKEY_USERNAME,
    password: () => process.env.NEWMAN_PASSWORD || process.env.JOCKEY_PASSWORD,
  },
};

export async function executeReservation(reservation) {
  const id = reservation.id;
  const timeoutMs = positiveNumber(process.env.GOLF_JOB_TIMEOUT_SECONDS, 900) * 1000;
  const heartbeatMs = positiveNumber(process.env.GOLF_JOB_HEARTBEAT_MS, 2000);
  const progressMs = positiveNumber(process.env.GOLF_JOB_PROGRESS_MS, 500);
  let stdout = String(reservation.lastStdout || "");
  let stderr = "";
  let child;
  let progressTimer;
  let heartbeatTimer;
  let timeoutTimer;
  let killTimer;
  let finished = false;
  let timedOut = false;
  let reservationWriteStarted = Boolean(reservation.reservationWriteStarted);
  let writeChain = Promise.resolve();

  const persist = (patch) => {
    writeChain = writeChain
      .then(() => updateReservation(id, (current) => current ? { ...current, ...patch } : null))
      .catch((error) => {
        console.error(`No pude actualizar la reserva ${id}:`, error instanceof Error ? error.message : error);
      });
    return writeChain;
  };

  const flushProgress = (force = false) => {
    if (finished && !force) return;
    if (progressTimer) clearTimeout(progressTimer);
    progressTimer = undefined;
    return persist({
      lastStdout: trimLog(stdout),
      lastStderr: trimLog(stderr),
      heartbeatAt: new Date().toISOString(),
    });
  };

  const scheduleProgress = () => {
    if (progressTimer || finished) return;
    progressTimer = setTimeout(() => flushProgress(), progressMs);
  };

  await persist({
    status: "starting",
    lastError: null,
    lastStdout: trimLog(stdout || "Preparando el agente de reservas...\n"),
    lastStderr: "",
    heartbeatAt: new Date().toISOString(),
  });

  return new Promise((resolve) => {
    const finish = async (code, launchError) => {
      if (finished) return;
      finished = true;
      clearTimeout(progressTimer);
      clearInterval(heartbeatTimer);
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);

      if (launchError) stderr += `${launchError instanceof Error ? launchError.message : launchError}\n`;
      if (timedOut) stderr += `El agente superó el límite de ${Math.round(timeoutMs / 1000)} segundos.\n`;

      await flushProgress(true);
      const finalStatus = timedOut || launchError ? "failed" : statusFromExitCode(code);
      const completedAt = new Date().toISOString();
      const lastError = finalStatus === "failed"
        ? trimLog(stderr || stdout || `Proceso terminó con código ${code}`)
        : null;

      await persist({
        status: finalStatus,
        completedAt,
        heartbeatAt: completedAt,
        lastRunAt: completedAt,
        lastStdout: trimLog(stdout),
        lastStderr: trimLog(stderr),
        lastError,
        reservationWriteStarted,
        workerId: null,
      });
      await writeChain;
      resolve({
        status: finalStatus,
        code,
        stdout: trimLog(stdout),
        stderr: trimLog(stderr),
        reservationWriteStarted,
      });
    };

    try {
      child = spawn(process.execPath, [agentScriptFor(reservation)], {
        cwd: process.cwd(),
        env: reservationEnv(reservation),
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      finish(null, error);
      return;
    }

    child.once("spawn", () => {
      const startedAt = new Date().toISOString();
      stdout += "Agente iniciado.\n";
      persist({
        status: "running",
        startedAt,
        lastRunAt: startedAt,
        heartbeatAt: startedAt,
        lastStdout: trimLog(stdout),
      });
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (!reservationWriteStarted && stdout.includes(RESERVATION_WRITE_STARTED_MARKER)) {
        reservationWriteStarted = true;
        persist({ reservationWriteStarted: true });
      }
      scheduleProgress();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      scheduleProgress();
    });
    child.once("error", (error) => finish(null, error));
    child.once("close", (code) => finish(code, null));

    heartbeatTimer = setInterval(() => flushProgress(true), heartbeatMs);
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      stderr += "Tiempo máximo alcanzado; detengo el agente.\n";
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
    }, timeoutMs);
  });
}

export function reservationEnv(reservation) {
  if (usesJockeyLikeAgent(reservation.target)) return jockeyReservationEnv(reservation);

  const scheduled = reservation.runMode !== "manual";
  return {
    ...process.env,
    GOLF_DATE: reservation.playDate,
    GOLF_MEMBER_IDS: reservation.memberIds.join(","),
    GOLF_PLAYERS_DATA: JSON.stringify(
      reservation.playerData || reservation.memberIds.map((memberId) => ({ memberId, documentId: "" })),
    ),
    GOLF_PLAYERS: String(reservation.players || reservation.memberIds.length),
    GOLF_BOOKING_TEXT: reservation.bookingText || process.env.GOLF_BOOKING_TEXT || "",
    GOLF_TIME_WINDOW_START: reservation.timeWindowStart || process.env.GOLF_TIME_WINDOW_START || "12:30",
    GOLF_TIME_WINDOW_END: reservation.timeWindowEnd || process.env.GOLF_TIME_WINDOW_END || "14:30",
    GOLF_CONFIRM_BOOKING: reservation.dryRun ? "false" : "true",
    GOLF_HEADLESS: process.env.GOLF_HEADLESS || "true",
    GOLF_MAX_ATTEMPTS: scheduled
      ? process.env.GOLF_SCHEDULED_MAX_ATTEMPTS || "20"
      : process.env.GOLF_MANUAL_MAX_ATTEMPTS || process.env.GOLF_MAX_ATTEMPTS || "2",
    GOLF_POLL_SECONDS: scheduled
      ? process.env.GOLF_SCHEDULED_POLL_SECONDS || "1"
      : process.env.GOLF_MANUAL_POLL_SECONDS || process.env.GOLF_POLL_SECONDS || "1",
    GOLF_NOT_BEFORE_LOCAL: scheduled ? reservation.runAtLocal || "" : "",
    GOLF_SEARCH_DEADLINE_LOCAL: initialSearchDeadline(reservation, scheduled),
    GOLF_RESERVATION_SETTLE_SECONDS: process.env.GOLF_RESERVATION_SETTLE_SECONDS || "240",
    GOLF_BASE_RESERVATION_SECONDS: process.env.GOLF_BASE_RESERVATION_SECONDS || "240",
    GOLF_RESERVATION_TRANSITION_SECONDS: process.env.GOLF_RESERVATION_TRANSITION_SECONDS || "90",
  };
}

function jockeyReservationEnv(reservation) {
  const target = targets[normalizeTarget(reservation.target)];
  const memberIds = reservation.memberIds || [];
  const firstMemberId = memberIds[0] || "";
  const username = target.username() || firstMemberId;
  const scheduled = reservation.runMode !== "manual";

  return {
    ...process.env,
    JOCKEY_URL: target.siteUrl(),
    JOCKEY_SITE_NAME: target.siteName,
    JOCKEY_DATE: reservation.playDate,
    JOCKEY_MEMBER_IDS: memberIds.join(","),
    JOCKEY_PLAYERS_DATA: JSON.stringify(
      reservation.playerData || memberIds.map((memberId) => ({ memberId, documentId: "" })),
    ),
    JOCKEY_PLAYERS: String(reservation.players || memberIds.length),
    JOCKEY_TOURNAMENT_TEXT: reservation.bookingText || target.defaultBookingText(),
    JOCKEY_TIME_WINDOW_START: reservation.timeWindowStart || process.env.JOCKEY_TIME_WINDOW_START || "12:30",
    JOCKEY_TIME_WINDOW_END: reservation.timeWindowEnd || process.env.JOCKEY_TIME_WINDOW_END || "14:30",
    JOCKEY_CONFIRM_BOOKING: reservation.dryRun ? "false" : "true",
    JOCKEY_HEADLESS: process.env.JOCKEY_HEADLESS || process.env.GOLF_HEADLESS || "true",
    JOCKEY_USERNAME: username,
    JOCKEY_PASSWORD: target.password() || username,
    JOCKEY_MAX_ATTEMPTS: scheduled
      ? process.env.JOCKEY_SCHEDULED_MAX_ATTEMPTS || "20"
      : process.env.JOCKEY_MANUAL_MAX_ATTEMPTS || process.env.JOCKEY_MAX_ATTEMPTS || "2",
    JOCKEY_POLL_SECONDS: scheduled
      ? process.env.JOCKEY_SCHEDULED_POLL_SECONDS || "1"
      : process.env.JOCKEY_MANUAL_POLL_SECONDS || process.env.JOCKEY_POLL_SECONDS || "1",
    JOCKEY_NOT_BEFORE_LOCAL: scheduled ? reservation.runAtLocal || "" : "",
  };
}

export function statusFromExitCode(code) {
  if (code === 0) return "done";
  if (code === 2) return "dry_run";
  return "failed";
}

function agentScriptFor(reservation) {
  if (normalizeTarget(reservation.target) === "golf-tracker" && process.env.GOLF_AGENT_SCRIPT) {
    return process.env.GOLF_AGENT_SCRIPT;
  }
  if (usesJockeyLikeAgent(reservation.target) && process.env.JOCKEY_AGENT_SCRIPT) {
    return process.env.JOCKEY_AGENT_SCRIPT;
  }
  return targets[normalizeTarget(reservation.target)].script;
}

function normalizeTarget(value) {
  const target = String(value || "golf-tracker").trim().toLowerCase();
  return targets[target] ? target : "golf-tracker";
}

function usesJockeyLikeAgent(target) {
  return ["jockey-palermo", "club-newman"].includes(normalizeTarget(target));
}

function initialSearchDeadline(reservation, scheduled) {
  if (!scheduled || reservation.mode !== "production") return "";
  if (Number(reservation.scheduledRetryCount || 0) > 0) return "";
  const date = String(reservation.bookingOpenDate || reservation.runDate || "");
  const time = String(process.env.GOLF_INITIAL_ATTEMPT_DEADLINE_TIME || "07:08");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return "";
  return `${date}T${time}:00`;
}

function trimLog(value) {
  return String(value || "").slice(-12000);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
