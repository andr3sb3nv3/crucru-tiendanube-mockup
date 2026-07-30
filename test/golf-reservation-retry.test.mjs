import assert from "node:assert/strict";
import test from "node:test";
import { applyScheduledRetry, scheduledRetryPlan } from "../scripts/golf-reservation-retry.mjs";
import { reservationEnv } from "../scripts/golf-reservation-runner.mjs";

const reservation = {
  id: "scheduled-job",
  status: "failed",
  mode: "production",
  runMode: "scheduled",
  target: "golf-tracker",
  runDate: "2026-07-14",
  runTime: "07:00",
  runAtLocal: "2026-07-14T07:00:00",
  bookingOpenDate: "2026-07-14",
  scheduledRetryCount: 0,
  lastStdout: "Primer intento.\n",
};

test("schedules one safe retry at 07:10 before the first reservation write", () => {
  const plan = scheduledRetryPlan(reservation, {
    status: "failed",
    stderr: "No apareció el botón Reservar.",
    reservationWriteStarted: false,
  });
  assert.deepEqual(plan, {
    retryDate: "2026-07-14",
    retryTime: "07:10",
    retryAtLocal: "2026-07-14T07:10:00",
    retryNumber: 1,
    reason: "No apareció el botón Reservar.",
  });

  const queued = applyScheduledRetry(reservation, plan);
  assert.equal(queued.status, "pending");
  assert.equal(queued.runAtLocal, "2026-07-14T07:10:00");
  assert.equal(queued.scheduledRetryCount, 1);
  assert.match(queued.lastStdout, /Reintento automático 1 programado/);
});

test("does not retry after the first reservation write", () => {
  const plan = scheduledRetryPlan(reservation, {
    status: "failed",
    stderr: "La confirmación quedó pendiente.",
    reservationWriteStarted: true,
  });
  assert.equal(plan, null);
});

test("does not retry manual runs or exceed the retry limit", () => {
  const failed = { status: "failed", reservationWriteStarted: false };
  assert.equal(scheduledRetryPlan({ ...reservation, runMode: "manual" }, failed), null);
  assert.equal(scheduledRetryPlan({ ...reservation, scheduledRetryCount: 1 }, failed), null);
});

test("does not move an exact-time request to the 07:10 retry", () => {
  const plan = scheduledRetryPlan({ ...reservation, scheduleKind: "exact" }, {
    status: "failed",
    reservationWriteStarted: false,
  });
  assert.equal(plan, null);
});

test("limits only the initial scheduled search window", () => {
  const initialEnv = reservationEnv({
    ...reservation,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(initialEnv.GOLF_NOT_BEFORE_LOCAL, "2026-07-14T07:00:00");
  assert.equal(initialEnv.GOLF_SEARCH_DEADLINE_LOCAL, "2026-07-14T07:08:00");

  const retryEnv = reservationEnv({
    ...reservation,
    runTime: "07:10",
    runAtLocal: "2026-07-14T07:10:00",
    scheduledRetryCount: 1,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(retryEnv.GOLF_NOT_BEFORE_LOCAL, "2026-07-14T07:10:00");
  assert.equal(retryEnv.GOLF_SEARCH_DEADLINE_LOCAL, "");
});

test("scheduled development checks can run without confirming a booking", () => {
  const dryRunEnv = reservationEnv({
    ...reservation,
    mode: "development",
    dryRun: true,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });

  assert.equal(dryRunEnv.GOLF_CONFIRM_BOOKING, "false");
  assert.equal(dryRunEnv.GOLF_NOT_BEFORE_LOCAL, "2026-07-14T07:00:00");
  assert.equal(dryRunEnv.GOLF_SEARCH_DEADLINE_LOCAL, "");
});

test("production requests always instruct the agents to confirm", () => {
  const golfEnv = reservationEnv({
    ...reservation,
    dryRun: false,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(golfEnv.GOLF_CONFIRM_BOOKING, "true");

  const jockeyEnv = reservationEnv({
    ...reservation,
    target: "jockey-palermo",
    dryRun: false,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(jockeyEnv.JOCKEY_CONFIRM_BOOKING, "true");
});
