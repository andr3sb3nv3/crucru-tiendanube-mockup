import assert from "node:assert/strict";
import test from "node:test";
import { calendarMonthFromTitle } from "../scripts/golf-calendar.mjs";

test("reads Golf Tracker calendar month titles", () => {
  assert.deepEqual(calendarMonthFromTitle("julio 2026"), { month: 6, year: 2026 });
  assert.deepEqual(calendarMonthFromTitle("  agosto   2026 "), { month: 7, year: 2026 });
});

test("rejects unrelated calendar text", () => {
  assert.equal(calendarMonthFromTitle("Lagos de Palermo"), null);
  assert.equal(calendarMonthFromTitle("2026-08-01"), null);
});
