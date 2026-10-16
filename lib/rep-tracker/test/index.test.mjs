import assert from "node:assert/strict";
import test from "node:test";
import { BASELINE_RULES, chooseAngle, initialState, replay, step } from "../src/index.ts";

function frame(offsetMs, angle, exercise) {
  const indices = exercise === "squat" ? [23, 24, 25, 26, 27, 28] : [11, 12, 13, 14, 15, 16];
  const points = angle > 150
    ? [{ x: .1, y: .5 }, { x: .5, y: .5 }, { x: .9, y: .5 }]
    : [{ x: .7, y: .8464 }, { x: .5, y: .5 }, { x: .9, y: .5 }];
  return {
    offsetMs,
    landmarks: indices.map((index, i) => ({
      index, ...points[Math.floor(i / 2)], visibility: .95,
    })),
  };
}

test("offline replay counts one squat and one curl using the shared current rules", () => {
  for (const exercise of ["squat", "bicep-curl"]) {
    const frames = [frame(0, 170, exercise), frame(400, 80, exercise), frame(900, 170, exercise)];
    assert.equal(replay(frames, exercise, 1, BASELINE_RULES[exercise]), 1);
  }
});

test("a visibility loss disarms the cycle and prevents an incomplete count", () => {
  const state = initialState();
  const rule = BASELINE_RULES.squat;
  assert.equal(step(state, 170, 0, rule), false);
  assert.equal(step(state, 80, 100, rule), false);
  assert.equal(step(state, null, 200, rule), false);
  assert.equal(step(state, 170, 1000, rule), false);
});

test("shared angle selection honors visibility", () => {
  const points = Array.from({ length: 29 }, () => ({ x: 0, y: 0, visibility: .9 }));
  points[23] = { x: .1, y: .5, visibility: .9 };
  points[25] = { x: .5, y: .5, visibility: .9 };
  points[27] = { x: .9, y: .5, visibility: .9 };
  assert.equal(chooseAngle(points, "squat", 1), 180);
  points[23] = { ...points[23], visibility: .2 };
  points[24] = { x: .1, y: .5, visibility: .2 };
  points[26] = { x: .5, y: .5, visibility: .2 };
  points[28] = { x: .9, y: .5, visibility: .2 };
  assert.equal(chooseAngle(points, "squat", 1), null);
});
