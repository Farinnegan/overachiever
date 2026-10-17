import test from 'node:test';
import assert from 'node:assert/strict';
import { FrontPushupTracker } from './front-pushup.ts';

const aspect = 4 / 3;
const pose = (degrees) => {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 0 }));
  points[0] = { x: .5, y: .18, z: 0, visibility: .95 };

  for (const [shoulderIndex, elbowIndex, wristIndex, side] of [
    [11, 13, 15, -1],
    [12, 14, 16, 1],
  ]) {
    const shoulderX = side < 0 ? .40 : .60;
    const elbowX = shoulderX + side * .015;
    const elbowY = .42;
    const bend = (180 - degrees) * Math.PI / 180;
    const wristDx = side * Math.sin(bend) * .16 / aspect;
    const wristDy = Math.cos(bend) * .16;
    points[shoulderIndex] = { x: shoulderX, y: .24, z: 0, visibility: .95 };
    points[elbowIndex] = { x: elbowX, y: elbowY, z: 0, visibility: .95 };
    points[wristIndex] = { x: elbowX + wristDx, y: elbowY + wristDy, z: 0, visibility: .95 };
  }
  return points;
};

function feed(tracker, degrees, start, frames = 1) {
  let counted = 0;
  let result;
  for (let i = 0; i < frames; i++) {
    result = tracker.update(pose(degrees), aspect, start + i * 66);
    if (result.counted) counted++;
  }
  return { counted, result, nextTime: start + frames * 66 };
}

test('front push-ups calibrate with only face and arm landmarks; hips and legs are not required', () => {
  const tracker = new FrontPushupTracker();
  const calibrated = feed(tracker, 160, 0, 12);
  assert.equal(calibrated.result.phase, 'stand');
  assert.match(calibrated.result.text, /high plank/i);

  let time = calibrated.nextTime;
  const lowered = feed(tracker, 90, time, 10);
  time = lowered.nextTime;
  const returned = feed(tracker, 160, time, 10);
  assert.equal(returned.counted, 1);
  assert.equal(returned.result.phase, 'stand');
});

test('front push-ups require a full bend-and-return cycle and visible face plus arm joints', () => {
  const tracker = new FrontPushupTracker();
  const calibrated = feed(tracker, 160, 0, 12);
  let time = calibrated.nextTime;

  const partial = feed(tracker, 145, time, 10);
  time = partial.nextTime;
  assert.equal(partial.counted, 0);

  const lowered = feed(tracker, 90, time, 10);
  time = lowered.nextTime;
  assert.equal(lowered.counted, 0);
  const noFace = pose(160);
  noFace[0].visibility = 0;
  const missingFace = tracker.update(noFace, aspect, time);
  assert.equal(missingFace.phase, 'unknown');
  assert.match(missingFace.text, /face/);
});

test('a brief detector gap does not immediately discard front-view calibration', () => {
  const tracker = new FrontPushupTracker();
  const calibrated = feed(tracker, 160, 0, 12);
  const gap = tracker.update(undefined, aspect, calibrated.nextTime);
  assert.equal(gap.phase, 'unknown');

  let time = calibrated.nextTime + 66;
  const lowered = feed(tracker, 90, time, 10);
  time = lowered.nextTime;
  const returned = feed(tracker, 160, time, 10);
  assert.equal(returned.counted, 1);
});
