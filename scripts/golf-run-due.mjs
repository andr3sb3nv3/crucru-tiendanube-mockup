import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { claimDueReservations, initStore, updateReservation } from "./golf-store.mjs";

process.env.TZ = "America/Argentina/Buenos_Aires";
loadEnvFile(".env.golf");

await initStore();

const now = process.env.GOLF_DUE_AT ? dateTimeFromLocal(process.env.GOLF_DUE_AT) : new Date();
const dueReservations = await claimDueReservations(now, reservationIsDue);

if (!dueReservations.length) {
  console.log(`No hay reservas pendientes para ejecutar ahora (${formatLocalDateTime(now)}).`);
  process.exit(0);
}

for (const reservation of dueReservations) {
  console.log(`Ejecutando reserva ${reservation.id} para jugar ${reservation.playDate}`);

  const result = spawnSync(process.execPath, ["scripts/golf-agent.mjs"], {
    cwd: process.cwd(),
    env: reservationEnv(reservation),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  await updateReservation(reservation.id, (current) => ({
    ...current,
    lastStdout: trimLog(result.stdout),
    lastStderr: trimLog(result.stderr),
    lastRunAt: new Date().toISOString(),
    status: result.status === 0 ? "done" : "failed",
    lastError: result.status === 0
      ? null
      : trimLog(result.stderr || result.stdout || `Proceso terminó con código ${result.status}`),
  }));

  if (result.status === 0) {
    console.log(`Reserva ${reservation.id} completada.`);
  } else {
    console.error(`Reserva ${reservation.id} falló.`);
    console.error(result.stderr || result.stdout || `Proceso terminó con código ${result.status}`);
  }
}

function reservationEnv(reservation) {
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
    GOLF_RESERVATION_SETTLE_SECONDS: process.env.GOLF_RESERVATION_SETTLE_SECONDS || "75",
  };
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

function dateTimeFromLocal(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hours, minutes, seconds = "0"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds));
}

function formatLocalDateTime(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
