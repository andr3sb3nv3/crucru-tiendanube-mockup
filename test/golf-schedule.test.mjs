import assert from "node:assert/strict";
import test from "node:test";
import { isExecutionTime, localDateTime, reservationIsDue } from "../scripts/golf-schedule.mjs";

test("keeps seconds in development execution times", () => {
  assert.equal(isExecutionTime("16:36:43"), true);
  assert.equal(isExecutionTime("16:36"), true);
  assert.equal(isExecutionTime("16:36:99"), false);
  assert.equal(localDateTime("2026-07-14", "16:36:43"), "2026-07-14T16:36:43");
  assert.equal(localDateTime("2026-07-14", "08:00"), "2026-07-14T08:00:00");
});

test("development waits for the exact second without production prewarm", () => {
  const reservation = {
    mode: "development",
    runMode: "scheduled",
    runAtLocal: "2026-07-14T16:36:43",
  };

  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 14, 16, 36, 42), 90_000), false);
  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 14, 16, 36, 43), 90_000), true);
});

test("production can prewarm before the booking opens", () => {
  const reservation = {
    mode: "production",
    runMode: "scheduled",
    runAtLocal: "2026-07-17T08:00:00",
  };

  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 17, 7, 58, 29), 90_000), false);
  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 17, 7, 58, 30), 90_000), true);
});

test("an exact production request waits for its selected second", () => {
  const reservation = {
    mode: "production",
    scheduleKind: "exact",
    runMode: "scheduled",
    runAtLocal: "2026-07-15T12:00:20",
  };

  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 15, 12, 0, 19), 90_000), false);
  assert.equal(reservationIsDue(reservation, new Date(2026, 6, 15, 12, 0, 20), 90_000), true);
});
