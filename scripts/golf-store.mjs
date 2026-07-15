import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const reservationsFile = path.resolve(process.env.GOLF_RESERVATIONS_FILE || "data/golf-reservations.json");
const useDatabase = Boolean(process.env.DATABASE_URL);
let pool;
let initialized = false;

export function storeBackend() {
  return useDatabase ? "postgres" : "file";
}

export async function initStore() {
  if (initialized) return;
  initialized = true;

  if (!useDatabase) {
    fs.mkdirSync(path.dirname(reservationsFile), { recursive: true });
    if (!fs.existsSync(reservationsFile)) fs.writeFileSync(reservationsFile, "[]\n");
    return;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
  });

  await pool.query(`
    create table if not exists golf_reservations (
      id text primary key,
      data jsonb not null,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

export async function listReservations() {
  await initStore();
  if (!useDatabase) return readJsonReservations();

  const result = await pool.query("select data from golf_reservations order by created_at asc");
  return result.rows.map((row) => row.data);
}

export async function getReservation(id) {
  await initStore();
  if (!useDatabase) return readJsonReservations().find((reservation) => reservation.id === id) || null;

  const result = await pool.query("select data from golf_reservations where id = $1", [id]);
  return result.rows[0]?.data || null;
}

export async function insertReservation(reservation) {
  await initStore();
  if (!useDatabase) {
    const reservations = readJsonReservations();
    reservations.push(reservation);
    writeJsonReservations(reservations);
    return reservation;
  }

  await pool.query(
    "insert into golf_reservations (id, data) values ($1, $2::jsonb)",
    [reservation.id, JSON.stringify(reservation)],
  );
  return reservation;
}

export async function updateReservation(id, updater) {
  await initStore();
  if (!useDatabase) {
    const reservations = readJsonReservations();
    const index = reservations.findIndex((reservation) => reservation.id === id);
    if (index === -1) return null;
    const next = updater({ ...reservations[index] });
    if (!next) return reservations[index];
    reservations[index] = next;
    writeJsonReservations(reservations);
    return next;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await client.query("select data from golf_reservations where id = $1 for update", [id]);
    const current = result.rows[0]?.data;
    if (!current) {
      await client.query("rollback");
      return null;
    }

    const next = updater({ ...current });
    if (!next) {
      await client.query("commit");
      return current;
    }

    await client.query(
      "update golf_reservations set data = $2::jsonb, updated_at = now() where id = $1",
      [id, JSON.stringify(next)],
    );
    await client.query("commit");
    return next;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteReservation(id) {
  await initStore();
  if (!useDatabase) {
    const next = readJsonReservations().filter((reservation) => reservation.id !== id);
    writeJsonReservations(next);
    return;
  }

  await pool.query("delete from golf_reservations where id = $1", [id]);
}

export async function claimDueReservations(now, isDue, options = {}) {
  await initStore();
  const reservations = await listReservations();
  const due = [];
  const limit = Number.isFinite(Number(options.limit)) ? Math.max(0, Number(options.limit)) : Infinity;
  const workerId = String(options.workerId || "worker");

  for (const reservation of reservations) {
    if (due.length >= limit) break;
    if (reservation.status !== "pending") continue;
    if (!isDue(reservation, now)) continue;

    const claimed = await claimReservation(reservation.id, workerId);
    if (claimed) due.push(claimed);
  }

  return due;
}

export async function recoverStaleReservations(now = new Date(), options = {}) {
  await initStore();
  const staleMs = positiveNumber(options.staleMs, 15000);
  const maxAttempts = positiveNumber(options.maxAttempts, 2);
  const cutoff = now.getTime() - staleMs;
  const reservations = await listReservations();
  const recovered = [];

  for (const reservation of reservations) {
    if (!["starting", "running"].includes(reservation.status)) continue;
    const heartbeatAt = Date.parse(reservation.heartbeatAt || reservation.claimedAt || reservation.lastRunAt || "");
    if (Number.isFinite(heartbeatAt) && heartbeatAt >= cutoff) continue;

    const expectedHeartbeat = reservation.heartbeatAt || null;
    const next = await updateReservation(reservation.id, (current) => {
      if (!["starting", "running"].includes(current.status)) return null;
      if ((current.heartbeatAt || null) !== expectedHeartbeat) return null;

      const attemptCount = Number(current.attemptCount || 0);
      const interruptedMessage = "El proceso anterior se interrumpió y dejó de enviar actividad.";
      if (attemptCount < maxAttempts) {
        return {
          ...current,
          status: "pending",
          workerId: null,
          heartbeatAt: null,
          claimedAt: null,
          startedAt: null,
          lastError: null,
          lastStdout: appendLog(current.lastStdout, `${interruptedMessage} Reintento automático.\n`),
        };
      }

      return {
        ...current,
        status: "failed",
        workerId: null,
        heartbeatAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        lastError: `${interruptedMessage} Se alcanzó el máximo de reintentos automáticos.`,
      };
    });
    if (next && next.status !== reservation.status) recovered.push(next);
  }

  return recovered;
}

export async function closeStore() {
  if (!pool) return;
  const currentPool = pool;
  pool = undefined;
  initialized = false;
  await currentPool.end();
}

async function claimReservation(id, workerId) {
  const claimedAt = new Date().toISOString();
  if (!useDatabase) {
    return updateReservation(id, (reservation) => {
      if (reservation.status !== "pending") return null;
      reservation.status = "starting";
      reservation.runMode = reservation.runMode || "scheduled";
      reservation.claimedAt = claimedAt;
      reservation.heartbeatAt = claimedAt;
      reservation.workerId = workerId;
      reservation.attemptCount = Number(reservation.attemptCount || 0) + 1;
      reservation.lastRunAt = claimedAt;
      reservation.lastError = null;
      return reservation;
    });
  }

  const result = await pool.query(
    `
      update golf_reservations
      set data = data || jsonb_build_object(
          'status', 'starting',
          'runMode', coalesce(data->>'runMode', 'scheduled'),
          'claimedAt', $2::text,
          'heartbeatAt', $2::text,
          'workerId', $3::text,
          'attemptCount', coalesce((data->>'attemptCount')::integer, 0) + 1,
          'lastRunAt', $2::text,
          'lastError', null
        ),
        updated_at = now()
      where id = $1 and data->>'status' = 'pending'
      returning data
    `,
    [id, claimedAt, workerId],
  );
  return result.rows[0]?.data || null;
}

function readJsonReservations() {
  return JSON.parse(fs.readFileSync(reservationsFile, "utf8"));
}

function writeJsonReservations(reservations) {
  fs.writeFileSync(reservationsFile, `${JSON.stringify(reservations, null, 2)}\n`);
}

function appendLog(current, addition) {
  return `${String(current || "")}${addition}`.slice(-12000);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}
