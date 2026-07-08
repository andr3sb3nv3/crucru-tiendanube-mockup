import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import {
  claimDueReservations,
  deleteReservation,
  getReservation,
  initStore,
  insertReservation,
  listReservations,
  updateReservation,
} from "./golf-store.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

const port = Number(process.env.PORT || process.env.GOLF_PLANNER_PORT || 5180);
const publicDir = path.resolve("golf-reservas");
const schedulerIntervalMs = Number(process.env.GOLF_SCHEDULER_INTERVAL_MS || 15000);
const enableScheduler = booleanEnv("GOLF_ENABLE_INTERNAL_SCHEDULER", true);
const targets = {
  "golf-tracker": {
    label: "Golf Tracker",
    script: "scripts/golf-agent.mjs",
    productionAdvanceDays: 3,
    defaultBookingText: () => process.env.GOLF_BOOKING_TEXT || "practica deportiva feriado",
  },
  "jockey-palermo": {
    label: "Jockey Club",
    script: "scripts/jockey-agent.mjs",
    productionAdvanceDays: 2,
    defaultBookingText: () => process.env.JOCKEY_TOURNAMENT_TEXT || "AZUL",
    siteName: "JOCKEY",
    siteUrl: () => process.env.JOCKEY_URL || "https://golf.e-jockeyclub.org.ar/golf/login.php",
    username: () => process.env.JOCKEY_USERNAME,
    password: () => process.env.JOCKEY_PASSWORD,
  },
  "club-newman": {
    label: "Club Newman",
    script: "scripts/jockey-agent.mjs",
    productionAdvanceDays: Number(process.env.NEWMAN_ADVANCE_DAYS || "2"),
    defaultBookingText: () => process.env.NEWMAN_TOURNAMENT_TEXT || "",
    siteName: "NEWMAN",
    siteUrl: () => process.env.NEWMAN_URL || "https://www.clubnewmangolf.com/golf/login.php",
    username: () => process.env.NEWMAN_USERNAME || process.env.JOCKEY_USERNAME,
    password: () => process.env.NEWMAN_PASSWORD || process.env.JOCKEY_PASSWORD,
  },
};

await initStore();

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      return serveFile(response, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    }

    if (request.method === "GET" && request.url === "/api/health") {
      return json(response, { ok: true });
    }

    if (request.method === "GET" && request.url === "/api/reservations") {
      return json(response, await listReservations());
    }

    if (request.method === "POST" && request.url === "/api/reservations") {
      const payload = await readJson(request);
      const reservation = normalizeReservation(payload);
      await insertReservation(reservation);
      return json(response, reservation, 201);
    }

    if (request.method === "POST" && request.url === "/api/reservations/run-now") {
      const payload = await readJson(request);
      const reservation = normalizeReservation(payload);
      reservation.status = "running";
      reservation.runMode = "manual";
      reservation.lastRunAt = new Date().toISOString();
      reservation.lastStdout = "Solicitud manual recibida. Iniciando agente...\n";
      reservation.lastStderr = "";
      await insertReservation(reservation);
      runReservationNow(reservation.id);
      return json(response, reservation, 202);
    }

    if (request.method === "POST" && request.url?.match(/^\/api\/reservations\/[^/]+\/run-now$/)) {
      const id = decodeURIComponent(request.url.split("/")[3] || "");
      const reservation = await getReservation(id);
      if (!reservation) throw new Error("No encontré esa solicitud.");
      if (reservation.status === "running") throw new Error("Esa solicitud ya está ejecutándose.");

      await updateReservation(id, (current) => ({
        ...current,
        status: "running",
        runMode: "manual",
        lastRunAt: new Date().toISOString(),
        lastError: null,
        lastStdout: "Reintento manual recibido. Iniciando agente...\n",
        lastStderr: "",
      }));
      runReservationNow(reservation.id);
      return json(response, reservation, 202);
    }

    if (request.method === "DELETE" && request.url?.startsWith("/api/reservations/")) {
      const id = decodeURIComponent(request.url.split("/").pop() || "");
      await deleteReservation(id);
      return json(response, { ok: true });
    }

    response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(port, () => {
  console.log(`Planificador de golf: http://localhost:${port}`);
  if (enableScheduler) {
    console.log(`Revisando solicitudes pendientes cada ${Math.round(schedulerIntervalMs / 1000)} segundos.`);
  }
});

if (enableScheduler) {
  setInterval(runDueReservations, schedulerIntervalMs);
  runDueReservations();
}

function normalizeReservation(payload) {
  const playDate = String(payload.playDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playDate)) throw new Error("Elegí una fecha de juego válida.");

  const playerData = parsePlayerRows(payload.memberIds || "");
  const memberIds = playerData.map((player) => player.memberId);
  if (!memberIds.length) throw new Error("Cargá al menos una matrícula.");
  if (memberIds.length > 4) throw new Error("Cargá hasta 4 matrículas para una misma línea.");

  const mode = normalizeMode(payload.mode);
  const target = normalizeTarget(payload.target);
  const { runDate, runTime } = executionTimeForMode(mode, payload, playDate, target);

  const defaultTimeWindowStart = target === "club-newman"
    ? process.env.NEWMAN_TIME_WINDOW_START || process.env.JOCKEY_TIME_WINDOW_START || "12:30"
    : target === "jockey-palermo"
    ? process.env.JOCKEY_TIME_WINDOW_START || "12:30"
    : process.env.GOLF_TIME_WINDOW_START || "12:30";
  const defaultTimeWindowEnd = target === "club-newman"
    ? process.env.NEWMAN_TIME_WINDOW_END || process.env.JOCKEY_TIME_WINDOW_END || "14:30"
    : target === "jockey-palermo"
    ? process.env.JOCKEY_TIME_WINDOW_END || "14:30"
    : process.env.GOLF_TIME_WINDOW_END || "14:30";
  const timeWindowStart = String(payload.timeWindowStart || defaultTimeWindowStart).trim();
  const timeWindowEnd = String(payload.timeWindowEnd || defaultTimeWindowEnd).trim();
  if (!isTime(timeWindowStart) || !isTime(timeWindowEnd)) throw new Error("El rango horario debe estar en formato HH:mm.");

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    status: "pending",
    mode,
    target,
    playDate,
    runDate,
    runTime,
    runAtLocal: `${runDate}T${runTime}:00`,
    bookingOpenDate: runDate,
    memberIds,
    playerData,
    players: memberIds.length,
    bookingText: String(payload.bookingText || targets[target].defaultBookingText()).trim(),
    timeWindowStart,
    timeWindowEnd,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    lastError: null,
  };
}

function normalizeMode(value) {
  return String(value || "production").trim().toLowerCase() === "development" ? "development" : "production";
}

function normalizeTarget(value) {
  const target = String(value || "golf-tracker").trim().toLowerCase();
  return targets[target] ? target : "golf-tracker";
}

function executionTimeForMode(mode, payload, playDate, target) {
  if (mode === "production") {
    return {
      runDate: formatIsoDate(addDays(dateFromIso(playDate), -targets[target].productionAdvanceDays)),
      runTime: "08:00",
    };
  }

  const runDate = String(payload.runDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error("Elegí una fecha de ejecución válida.");

  const runTime = String(payload.runTime || "").trim();
  if (!isTime(runTime)) throw new Error("Elegí una hora de ejecución válida.");

  return { runDate, runTime };
}

function runReservationNow(id) {
  runReservationNowAsync(id).catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
  });
}

async function runReservationNowAsync(id) {
  const reservation = await getReservation(id);
  if (!reservation) return;

  const child = spawn(process.execPath, [agentScriptFor(reservation)], {
    cwd: process.cwd(),
    env: reservationEnv(reservation),
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  let lastProgressFlushAt = 0;

  const flushProgress = async () => {
    const now = Date.now();
    if (now - lastProgressFlushAt < 2000) return;
    lastProgressFlushAt = now;
    await updateReservation(id, (current) => ({
      ...current,
      lastStdout: trimLog(stdout),
      lastStderr: trimLog(stderr),
      status: current.status === "running" ? "running" : current.status,
      lastRunAt: current.lastRunAt || new Date().toISOString(),
    })).catch(() => {});
  };

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    flushProgress();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
    flushProgress();
  });
  child.on("close", async (code) => {
    const finalStatus = statusFromExitCode(code);
    await updateReservation(id, (current) => ({
      ...current,
      lastRunAt: new Date().toISOString(),
      lastStdout: trimLog(stdout),
      lastStderr: trimLog(stderr),
      status: finalStatus,
      lastError: finalStatus === "failed" ? trimLog(stderr || stdout || `Proceso terminó con código ${code}`) : null,
    }));
  });
}

function statusFromExitCode(code) {
  if (code === 0) return "done";
  if (code === 2) return "dry_run";
  return "failed";
}

async function runDueReservations() {
  const due = await claimDueReservations(new Date(), reservationIsDue);
  for (const reservation of due) {
    runReservationNow(reservation.id);
  }
}

function reservationEnv(reservation) {
  if (usesJockeyLikeAgent(reservation.target)) return jockeyReservationEnv(reservation);

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
    GOLF_CONFIRM_BOOKING: process.env.GOLF_CONFIRM_BOOKING || "true",
    GOLF_HEADLESS: process.env.GOLF_HEADLESS || "true",
    GOLF_MAX_ATTEMPTS: process.env.GOLF_MANUAL_MAX_ATTEMPTS || "1",
    GOLF_POLL_SECONDS: process.env.GOLF_MANUAL_POLL_SECONDS || "2",
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
    JOCKEY_CONFIRM_BOOKING: process.env.JOCKEY_CONFIRM_BOOKING || "false",
    JOCKEY_HEADLESS: process.env.JOCKEY_HEADLESS || process.env.GOLF_HEADLESS || "true",
    JOCKEY_USERNAME: username,
    JOCKEY_PASSWORD: target.password() || username,
  };
}

function agentScriptFor(reservation) {
  return targets[normalizeTarget(reservation.target)].script;
}

function usesJockeyLikeAgent(target) {
  return ["jockey-palermo", "club-newman"].includes(normalizeTarget(target));
}

function reservationIsDue(reservation, now) {
  const runAt = reservationRunAt(reservation);
  return runAt ? runAt <= now : false;
}

function reservationRunAt(reservation) {
  if (reservation.runAtLocal) return dateTimeFromLocal(reservation.runAtLocal);
  if (reservation.runDate && reservation.runTime) return dateTimeFromLocal(`${reservation.runDate}T${reservation.runTime}:00`);
  if (reservation.bookingOpenDate) return dateTimeFromLocal(`${reservation.bookingOpenDate}T08:00:00`);
  return null;
}

function parsePlayerRows(value) {
  const raw = String(value || "").trim();
  if (!raw) return [];

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const hasDocumentColumn = lines.some((line) => line.split(/[\s,;]+/).filter(Boolean).length >= 2);

  if (!hasDocumentColumn) {
    return raw
      .split(/[\s,;]+/)
      .map((memberId) => memberId.trim())
      .filter(Boolean)
      .map((memberId) => ({ memberId, documentId: "" }));
  }

  return lines.map((line) => {
    const [memberId, documentId = ""] = line.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
    return { memberId, documentId };
  }).filter((player) => player.memberId);
}

function serveFile(response, filePath, contentType) {
  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(filePath));
}

function json(response, payload, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function trimLog(value) {
  return String(value || "").slice(-8000);
}

function loadEnvFile(fileName) {
  const filePath = path.resolve(fileName);
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}

function booleanEnv(name, fallback) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "si", "sí"].includes(value.toLowerCase());
}

function isTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatIsoDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateTimeFromLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
}
