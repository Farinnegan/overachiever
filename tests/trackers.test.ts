import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker } from '../src/tracking/exercises.ts';
import type { Exercise, Point } from '../src/tracking/types.ts';

const ASPECT = 3 / 4; // portrait phone camera
const STEP = 66; // ~15 fps, like the live loop

/** Build a full 33-point pose with only the given joints visible. */
function pose(joints: Record<number, [number, number]>): Point[] {
  const p: Point[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.1 }));
  for (const [i, [x, y]] of Object.entries(joints)) p[Number(i)] = { x, y, visibility: 0.95 };
  return p;
}

/** Push-up pose. `depth` 0 = arms straight, 1 = chest at the bottom. */
function pushup(depth: number): Point[] {
  const shoulderY = 0.35 + 0.13 * depth;
  const half = 0.125 + 0.035 * depth; // shoulders look wider as you get closer to the camera
  return pose({ 11: [0.5 + half, shoulderY], 12: [0.5 - half, shoulderY], 13: [0.68, 0.55], 14: [0.32, 0.55], 15: [0.7, 0.76], 16: [0.3, 0.76] });
}

/** Squat pose seen from the side. `depth` 0 = standing, 1 = deep squat. */
function squat(depth: number): Point[] {
  const knee = (180 - 95 * depth) * Math.PI / 180; // knee angle in radians
  const hip: [number, number] = [0.5, 0.45];
  const kneePt: [number, number] = [0.5, 0.65];
  const ankle: [number, number] = [0.5 + Math.sin(Math.PI - knee) * 0.2 / ASPECT, 0.65 + Math.cos(Math.PI - knee) * 0.2];
  return pose({ 23: hip, 25: kneePt, 27: ankle, 24: [hip[0] + 0.01, hip[1]], 26: [kneePt[0] + 0.01, kneePt[1]], 28: [ankle[0] + 0.01, ankle[1]] });
}

/** Side leg raise, front view. `lift` 0 = legs together, 1 = leg raised ~45 degrees. */
function legRaise(lift: number): Point[] {
  const a = (45 * lift * Math.PI) / 180;
  return pose({ 23: [0.55, 0.5], 24: [0.45, 0.5], 25: [0.56, 0.7], 26: [0.45 - Math.sin(a) * 0.2 / ASPECT, 0.5 + Math.cos(a) * 0.2] });
}

/** Feed a depth profile through a tracker and return the rep count. */
function run(exercise: Exercise, build: (d: number) => Point[], profile: number[], noise = 0): number {
  const tracker = createTracker(exercise);
  let t = 0, reps = 0, seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  for (const depth of profile) {
    const p = build(depth).map((pt) => (pt.visibility! > 0.5 ? { ...pt, x: pt.x + rand() * noise, y: pt.y + rand() * noise } : pt));
    if (tracker.update(p, ASPECT, t).counted) reps++;
    t += STEP;
  }
  return reps;
}

/** Hold still for `holdMs`, then do `reps` smooth reps of `repMs` each reaching `depth`. */
function profile(reps: number, depth = 1, repMs = 1600, holdMs = 1200): number[] {
  const out: number[] = Array(Math.round(holdMs / STEP)).fill(0);
  const n = Math.round(repMs / STEP);
  for (let r = 0; r < reps; r++) for (let i = 0; i < n; i++) out.push(depth * Math.sin((Math.PI * i) / n) ** 2);
  return out.concat(Array(10).fill(0));
}

for (const [exercise, build] of [['push-up', pushup], ['squat', squat], ['side-leg-raise', legRaise]] as const) {
  test(`${exercise}: counts full reps`, () => {
    assert.equal(run(exercise, build, profile(5)), 5);
  });
  test(`${exercise}: counts with landmark jitter`, () => {
    assert.equal(run(exercise, build, profile(6), 0.004), 6);
  });
  test(`${exercise}: counts fast reps`, () => {
    assert.equal(run(exercise, build, profile(4, 1, 900)), 4);
  });
  test(`${exercise}: ignores small wobbles`, () => {
    assert.equal(run(exercise, build, profile(5, 0.25)), 0);
  });
  test(`${exercise}: nothing counts before holding the start position`, () => {
    assert.equal(run(exercise, build, profile(3, 1, 1600, 0).slice(0, 20)), 0);
  });
}

test('push-up: needs shoulders and a hand visible', () => {
  const tracker = createTracker('push-up');
  const hidden = pushup(0).map((p, i) => (i === 11 ? { ...p, visibility: 0.1 } : p));
  assert.equal(tracker.update(hidden, ASPECT, 0).status, 'searching');
});

test('push-up: standing up does not count as a rep', () => {
  // Calibrate in plank, then the person stands up and walks off.
  const tracker = createTracker('push-up');
  let t = 0, reps = 0;
  for (let i = 0; i < 20; i++) { tracker.update(pushup(0), ASPECT, t); t += STEP; }
  for (let i = 0; i < 30; i++) { if (tracker.update(undefined, ASPECT, t).counted) reps++; t += STEP; }
  assert.equal(reps, 0);
});

test('side leg raise: reports position until legs are together', () => {
  const tracker = createTracker('side-leg-raise');
  let last = tracker.update(legRaise(1.2), ASPECT, 0);
  for (let t = STEP; t < 1000; t += STEP) last = tracker.update(legRaise(1.2), ASPECT, t);
  assert.equal(last.status, 'position');
});
