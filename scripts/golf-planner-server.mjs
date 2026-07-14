import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  claimDueReservations,
  deleteReservation,
  getReservation,
  initStore,
  insertReservation,
  listReservations,
  recoverStaleReservations,
  updateReservation,
} from "./golf-store.mjs";
import { executeReservation } from "./golf-reservation-runner.mjs";
import { applyScheduledRetry, scheduledRetryPlan } from "./golf-reservation-retry.mjs";
import { isExecutionTime, localDateTime, reservationIsDue } from "./golf-schedule.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

const port = Number(process.env.PORT || process.env.GOLF_PLANNER_PORT || 5180);
const publicDir = path.resolve("golf-reservas");
const workerPollMs = positiveNumber(process.env.GOLF_WORKER_POLL_MS, 1000);
const workerConcurrency = positiveNumber(process.env.GOLF_WORKER_CONCURRENCY, 2);
const workerStaleMs = positiveNumber(process.env.GOLF_WORKER_STALE_MS, 15000);
const workerMaxAttempts = positiveNumber(process.env.GOLF_WORKER_MAX_ATTEMPTS, 2);
const workerPrewarmMs = positiveNumber(process.env.GOLF_WORKER_PREWARM_SECONDS, 90) * 1000;
const enableWorker = booleanEnv("GOLF_RUNNER_ENABLED", true);
const workerId = `${os.hostname()}-${process.pid}-${randomUUID().slice(0, 8)}`;
const activeJobs = new Map();
let workerTimer;
let workerTickInFlight = false;
let lastRecoveryAt = 0;
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
      return json(response, {
        ok: true,
        worker: {
          enabled: enableWorker,
          active: activeJobs.size,
          concurrency: workerConcurrency,
          pollMs: workerPollMs,
        },
        schedule: {
          golfTrackerFirstAttempt: productionRunTime("golf-tracker"),
          initialAttemptDeadline: configuredTime("GOLF_INITIAL_ATTEMPT_DEADLINE_TIME", "08:08"),
          safeRetry: configuredTime("GOLF_SCHEDULED_RETRY_TIME", "08:10"),
        },
        now: new Date().toISOString(),
      });
    }

    if (request.method === "GET" && request.url === "/api/reservations") {
      return json(response, await listReservations());
    }

    if (request.method === "POST" && request.url === "/api/reservations") {
      const payload = await readJson(request);
      const reservation = normalizeReservation(payload);
      await assertNoPreviousWrite(reservation);
      await insertReservation(reservation);
      wakeWorker();
      return json(response, reservation, 201);
    }

    if (request.method === "POST" && request.url === "/api/reservations/run-now") {
      const payload = await readJson(request);
      const reservation = makeImmediate(normalizeReservation(payload), "Solicitud manual recibida. En cola para iniciar...\n");
      await assertNoPreviousWrite(reservation);
      await insertReservation(reservation);
      wakeWorker();
      return json(response, reservation, 202);
    }

    if (request.method === "POST" && request.url?.match(/^\/api\/reservations\/[^/]+\/run-now$/)) {
      const id = decodeURIComponent(request.url.split("/")[3] || "");
      const reservation = await getReservation(id);
      if (!reservation) throw new Error("No encontré esa solicitud.");
      if (["starting", "running"].includes(reservation.status)) throw new Error("Esa solicitud ya está ejecutándose.");
      if (reservation.reservationWriteStarted) {
        throw new Error("Esta solicitud ya envió datos a Golf Tracker. Revisá o cancelá esa línea antes de volver a intentarla.");
      }

      const immediate = makeImmediate(reservation, "Reintento manual recibido. En cola para iniciar...\n");
      const updated = await updateReservation(id, () => immediate);
      wakeWorker();
      return json(response, updated, 202);
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
  if (enableWorker) {
    console.log(`Worker ${workerId}: revisando solicitudes cada ${workerPollMs} ms.`);
  }
});

if (enableWorker) wakeWorker();

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
    runAtLocal: localDateTime(runDate, runTime),
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
    scheduledRetryCount: 0,
    reservationWriteStarted: false,
    dryRun: mode === "development" && truthyValue(payload.dryRun),
  };
}

async function assertNoPreviousWrite(reservation) {
  if (reservation.dryRun) return;
  const previous = (await listReservations()).find((item) => (
    item.id !== reservation.id
    && item.target === reservation.target
    && item.playDate === reservation.playDate
    && item.reservationWriteStarted
  ));
  if (!previous) return;
  throw new Error(`Ya existe una solicitud que envió datos para ${reservation.playDate}. Revisá o cancelá esa reserva antes de crear otra.`);
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
      runTime: productionRunTime(target),
    };
  }

  const runDate = String(payload.runDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) throw new Error("Elegí una fecha de ejecución válida.");

  const runTime = String(payload.runTime || "").trim();
  if (!isExecutionTime(runTime)) throw new Error("Elegí una hora de ejecución válida.");

  return { runDate, runTime };
}

function wakeWorker(delay = 0) {
  if (!enableWorker) return;
  clearTimeout(workerTimer);
  workerTimer = setTimeout(workerTick, Math.max(0, delay));
}

async function workerTick() {
  if (workerTickInFlight) return wakeWorker(workerPollMs);
  workerTickInFlight = true;

  try {
    const now = new Date();
    if (Date.now() - lastRecoveryAt >= workerStaleMs) {
      const recovered = await recoverStaleReservations(now, {
        staleMs: workerStaleMs,
        maxAttempts: workerMaxAttempts,
      });
      if (recovered.length) console.log(`Worker recuperó ${recovered.length} solicitud(es) interrumpida(s).`);
      lastRecoveryAt = Date.now();
    }

    const capacity = Math.max(0, workerConcurrency - activeJobs.size);
    if (capacity > 0) {
      const due = await claimDueReservations(now, (reservation, currentTime) => (
        reservationIsDue(reservation, currentTime, workerPrewarmMs)
      ), {
        limit: capacity,
        workerId,
      });

      for (const reservation of due) {
        const execution = executeReservation(reservation)
          .then(async (result) => {
            const retryPlan = scheduledRetryPlan(reservation, result, {
              retryTime: configuredTime("GOLF_SCHEDULED_RETRY_TIME", "08:10"),
              maxRetries: positiveNumber(process.env.GOLF_SCHEDULED_RETRIES, 1),
            });
            if (!retryPlan) return result;

            const updated = await updateReservation(reservation.id, (current) => {
              if (current.status !== "failed") return null;
              return applyScheduledRetry(current, retryPlan);
            });
            if (updated?.status === "pending") {
              console.log(`Reserva ${reservation.id}: reintento programado para ${retryPlan.retryDate} ${retryPlan.retryTime}.`);
            }
            return result;
          })
          .catch(async (error) => {
            const detail = error instanceof Error ? error.stack || error.message : String(error);
            console.error(`Reserva ${reservation.id}: ${detail}`);
            await updateReservation(reservation.id, (current) => ({
              ...current,
              status: "failed",
              completedAt: new Date().toISOString(),
              lastError: detail,
              workerId: null,
            })).catch(() => {});
          })
          .finally(() => {
            activeJobs.delete(reservation.id);
            wakeWorker();
          });
        activeJobs.set(reservation.id, execution);
      }
    }
  } catch (error) {
    console.error("Falló el ciclo del worker:", error instanceof Error ? error.stack || error.message : error);
  } finally {
    workerTickInFlight = false;
    const alignedDelay = workerPollMs - (Date.now() % workerPollMs);
    wakeWorker(alignedDelay);
  }
}

function makeImmediate(reservation, initialLog) {
  const now = new Date();
  const runDate = formatIsoDate(now);
  const runTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
  return {
    ...reservation,
    status: "pending",
    runMode: "manual",
    scheduledRunAtLocal: reservation.runAtLocal,
    runDate,
    runTime,
    runAtLocal: localDateTime(runDate, runTime),
    lastRunAt: null,
    claimedAt: null,
    startedAt: null,
    completedAt: null,
    heartbeatAt: null,
    workerId: null,
    lastError: null,
    reservationWriteStarted: false,
    lastStdout: initialLog,
    lastStderr: "",
  };
}

function productionRunTime(target) {
  if (target === "golf-tracker") {
    return configuredTime("GOLF_PRODUCTION_RUN_TIME", "08:01");
  }
  return configuredTime("JOCKEY_PRODUCTION_RUN_TIME", "08:00");
}

function configuredTime(name, fallback) {
  const value = process.env[name] || fallback;
  return isTime(value) ? value : fallback;
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

function truthyValue(value) {
  return ["1", "true", "yes", "si", "sí", "on"].includes(String(value || "").trim().toLowerCase());
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
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
