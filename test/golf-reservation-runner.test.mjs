import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "golf-runner-test-"));
process.env.GOLF_RESERVATIONS_FILE = path.join(tempDir, "reservations.json");
process.env.GOLF_AGENT_SCRIPT = "test/fixtures/fake-golf-agent.mjs";
process.env.GOLF_JOB_HEARTBEAT_MS = "50";
process.env.GOLF_JOB_PROGRESS_MS = "20";
process.env.GOLF_JOB_TIMEOUT_SECONDS = "5";

const store = await import("../scripts/golf-store.mjs");
const { executeReservation } = await import("../scripts/golf-reservation-runner.mjs");

test.after(async () => {
  await store.closeStore();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("keeps running until the agent exits, then marks done", async () => {
  process.env.FAKE_AGENT_EXIT_CODE = "0";
  process.env.FAKE_AGENT_DELAY_MS = "300";
  process.env.FAKE_AGENT_WRITE_STARTED = "false";
  const reservation = await insertAndClaim("success");

  const execution = executeReservation(reservation);
  await delay(100);
  const during = await store.getReservation(reservation.id);
  assert.equal(during.status, "running");
  assert.equal(during.completedAt, undefined);

  const result = await execution;
  const completed = await store.getReservation(reservation.id);
  assert.equal(result.status, "done");
  assert.equal(completed.status, "done");
  assert.ok(completed.startedAt);
  assert.ok(completed.completedAt);
  assert.match(completed.lastStdout, /Agente de prueba terminado/);
});

test("marks failed only after a non-zero agent exit", async () => {
  process.env.FAKE_AGENT_EXIT_CODE = "1";
  process.env.FAKE_AGENT_DELAY_MS = "100";
  process.env.FAKE_AGENT_WRITE_STARTED = "false";
  const reservation = await insertAndClaim("failure");

  const result = await executeReservation(reservation);
  const completed = await store.getReservation(reservation.id);
  assert.equal(result.status, "failed");
  assert.equal(completed.status, "failed");
  assert.match(completed.lastError, /Agente de prueba terminado/);
});

test("persists when the agent started writing a reservation", async () => {
  process.env.FAKE_AGENT_EXIT_CODE = "1";
  process.env.FAKE_AGENT_DELAY_MS = "100";
  process.env.FAKE_AGENT_WRITE_STARTED = "true";
  const reservation = await insertAndClaim("write-started");

  const result = await executeReservation(reservation);
  const completed = await store.getReservation(reservation.id);
  assert.equal(result.status, "failed");
  assert.equal(result.reservationWriteStarted, true);
  assert.equal(completed.reservationWriteStarted, true);
});

async function insertAndClaim(id) {
  const reservation = {
    id,
    status: "pending",
    runMode: "manual",
    playDate: "2026-07-16",
    runAtLocal: "2026-07-13T08:00:00",
    target: "golf-tracker",
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
    timeWindowStart: "12:30",
    timeWindowEnd: "14:30",
    lastStdout: "Solicitud de prueba.\n",
  };
  await store.insertReservation(reservation);
  const [claimed] = await store.claimDueReservations(new Date(), () => true, {
    workerId: "test-worker",
    limit: 1,
  });
  return claimed;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
