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
  runTime: "08:01",
  runAtLocal: "2026-07-14T08:01:00",
  bookingOpenDate: "2026-07-14",
  scheduledRetryCount: 0,
  lastStdout: "Primer intento.\n",
};

test("schedules one safe retry at 08:10 before the first reservation write", () => {
  const plan = scheduledRetryPlan(reservation, {
    status: "failed",
    stderr: "No apareció el botón Reservar.",
    reservationWriteStarted: false,
  });
  assert.deepEqual(plan, {
    retryDate: "2026-07-14",
    retryTime: "08:10",
    retryAtLocal: "2026-07-14T08:10:00",
    retryNumber: 1,
    reason: "No apareció el botón Reservar.",
  });

  const queued = applyScheduledRetry(reservation, plan);
  assert.equal(queued.status, "pending");
  assert.equal(queued.runAtLocal, "2026-07-14T08:10:00");
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

test("limits only the initial scheduled search window", () => {
  const initialEnv = reservationEnv({
    ...reservation,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(initialEnv.GOLF_NOT_BEFORE_LOCAL, "2026-07-14T08:01:00");
  assert.equal(initialEnv.GOLF_SEARCH_DEADLINE_LOCAL, "2026-07-14T08:08:00");

  const retryEnv = reservationEnv({
    ...reservation,
    runTime: "08:10",
    runAtLocal: "2026-07-14T08:10:00",
    scheduledRetryCount: 1,
    memberIds: ["135890"],
    playerData: [{ memberId: "135890", documentId: "" }],
    players: 1,
  });
  assert.equal(retryEnv.GOLF_NOT_BEFORE_LOCAL, "2026-07-14T08:10:00");
  assert.equal(retryEnv.GOLF_SEARCH_DEADLINE_LOCAL, "");
});
