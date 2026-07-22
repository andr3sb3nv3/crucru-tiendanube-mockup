import assert from "node:assert/strict";
import test from "node:test";
import { allowsSingleSlotFallback, compareLineGroups } from "../scripts/golf-slot-policy.mjs";

const groups = [
  { time: "09:30", minutes: 570, score: 10, y: 1 },
  { time: "13:20", minutes: 800, score: 10, y: 2 },
  { time: "14:00", minutes: 840, score: 10, y: 3 },
];

test("orders full lines inside the requested range from earliest to latest", () => {
  const ordered = [...groups].sort((left, right) => compareLineGroups(left, right, {
    respectWindow: true,
    windowEndMinutes: 780,
  }));
  assert.deepEqual(ordered.map((group) => group.time), ["09:30", "13:20", "14:00"]);
});

test("orders fallback lines by proximity to the requested end time", () => {
  const ordered = [...groups].sort((left, right) => compareLineGroups(left, right, {
    respectWindow: false,
    windowEndMinutes: 780,
  }));
  assert.deepEqual(ordered.map((group) => group.time), ["13:20", "14:00", "09:30"]);
});

test("prefers the later line when two fallbacks are equally close", () => {
  const equidistant = [
    { time: "12:50", minutes: 770, score: 10, y: 1 },
    { time: "13:10", minutes: 790, score: 10, y: 2 },
  ];
  const ordered = equidistant.sort((left, right) => compareLineGroups(left, right, {
    respectWindow: false,
    windowEndMinutes: 780,
  }));
  assert.equal(ordered[0].time, "13:10");
});

test("never falls back to a partial line for a multi-player request", () => {
  assert.equal(allowsSingleSlotFallback(4), false);
  assert.equal(allowsSingleSlotFallback(2), false);
  assert.equal(allowsSingleSlotFallback(1), true);
});
