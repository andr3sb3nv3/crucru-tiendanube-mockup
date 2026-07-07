import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

const reservationsFile = path.resolve("data/golf-reservations.json");
const useDatabase = Boolean(process.env.DATABASE_URL);
let pool;
let initialized = false;

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

  const current = await getReservation(id);
  if (!current) return null;
  const next = updater({ ...current });
  if (!next) return current;
  await pool.query(
    "update golf_reservations set data = $2::jsonb, updated_at = now() where id = $1",
    [id, JSON.stringify(next)],
  );
  return next;
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

export async function claimDueReservations(now, isDue) {
  await initStore();
  const reservations = await listReservations();
  const due = [];

  for (const reservation of reservations) {
    if (reservation.status !== "pending") continue;
    if (!isDue(reservation, now)) continue;

    const claimed = await claimReservation(reservation.id);
    if (claimed) due.push(claimed);
  }

  return due;
}

async function claimReservation(id) {
  if (!useDatabase) {
    return updateReservation(id, (reservation) => {
      if (reservation.status !== "pending") return null;
      reservation.status = "running";
      reservation.runMode = "scheduled";
      reservation.lastRunAt = new Date().toISOString();
      reservation.lastError = null;
      return reservation;
    });
  }

  const result = await pool.query(
    `
      update golf_reservations
      set data = jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(data, '{status}', '"running"', true),
              '{runMode}', '"scheduled"', true
            ),
            '{lastRunAt}', to_jsonb($2::text), true
          ),
          '{lastError}', 'null'::jsonb, true
        ),
        updated_at = now()
      where id = $1 and data->>'status' = 'pending'
      returning data
    `,
    [id, new Date().toISOString()],
  );
  return result.rows[0]?.data || null;
}

function readJsonReservations() {
  return JSON.parse(fs.readFileSync(reservationsFile, "utf8"));
}

function writeJsonReservations(reservations) {
  fs.writeFileSync(reservationsFile, `${JSON.stringify(reservations, null, 2)}\n`);
}
