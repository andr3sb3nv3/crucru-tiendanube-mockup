import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { claimDueReservations, closeStore, initStore, recoverStaleReservations } from "./golf-store.mjs";
import { executeReservation } from "./golf-reservation-runner.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

const now = process.env.GOLF_DUE_AT ? dateTimeFromLocal(process.env.GOLF_DUE_AT) : new Date();
const concurrency = positiveNumber(process.env.GOLF_WORKER_CONCURRENCY, 2);
const workerId = `cron-${process.pid}-${Date.now()}`;

try {
  await initStore();
  await recoverStaleReservations(now, {
    staleMs: positiveNumber(process.env.GOLF_WORKER_STALE_MS, 15000),
    maxAttempts: positiveNumber(process.env.GOLF_WORKER_MAX_ATTEMPTS, 2),
  });

  const dueReservations = await claimDueReservations(now, reservationIsDue, { workerId });
  if (!dueReservations.length) {
    console.log(`No hay reservas pendientes para ejecutar ahora (${formatLocalDateTime(now)}).`);
  }

  for (let index = 0; index < dueReservations.length; index += concurrency) {
    const batch = dueReservations.slice(index, index + concurrency);
    const results = await Promise.all(batch.map(async (reservation) => {
      console.log(`Ejecutando reserva ${reservation.id} para jugar ${reservation.playDate}`);
      const result = await executeReservation(reservation);
      if (result.status === "done") {
        console.log(`Reserva ${reservation.id} completada y verificada.`);
      } else if (result.status === "dry_run") {
        console.log(`Reserva ${reservation.id} quedó en modo prueba; no se confirmó.`);
      } else {
        console.error(`Reserva ${reservation.id} falló.`);
        console.error(result.stderr || result.stdout);
      }
      return result;
    }));
    if (results.some((result) => result.status === "failed")) process.exitCode = 1;
  }
} finally {
  await closeStore();
}

function reservationIsDue(reservation, at) {
  const runAt = reservationRunAt(reservation);
  return runAt ? runAt <= at : false;
}

function reservationRunAt(reservation) {
  if (reservation.runAtLocal) return dateTimeFromLocal(reservation.runAtLocal);
  if (reservation.runDate && reservation.runTime) return dateTimeFromLocal(`${reservation.runDate}T${reservation.runTime}:00`);
  if (reservation.bookingOpenDate) return dateTimeFromLocal(`${reservation.bookingOpenDate}T08:00:00`);
  return null;
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

function dateTimeFromLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
