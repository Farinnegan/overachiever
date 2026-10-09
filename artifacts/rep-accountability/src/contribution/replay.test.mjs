import test from 'node:test';
import assert from 'node:assert/strict';
import { replayPose } from './replay.ts';
import { RepCapture } from './capture.ts';

const joints = (x, visibility = .99) => [23, 24, 25, 26, 27, 28].map(index => ({ index, x, y: .5, visibility }));
const frames = [
  { offsetMs: 0, phase: 'stand', landmarks: joints(.2) },
  { offsetMs: 500, phase: 'bottom', landmarks: joints(.6) },
  { offsetMs: 1000, phase: 'stand', landmarks: joints(.3) },
];

test('replay uses actual timestamps, interpolates, and leaves upload data unchanged', () => {
  const original = JSON.stringify(frames);
  const halfway = replayPose(frames, 250);
  assert.equal(halfway.index, 0);
  assert.ok(Math.abs(halfway.landmarks[0].x - .4) < .00001);
  assert.equal(replayPose(frames, 500).phase, 'bottom');
  assert.equal(replayPose(frames, -100).index, 0);
  assert.equal(replayPose(frames, 9999).index, 2);
  assert.equal(JSON.stringify(frames), original);
  assert.equal(replayPose([], 0), null);
});

test('low-visibility poses survive for missed reports but never count as complete reps', () => {
  const capture = new RepCapture();
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .3 }));
  for (const t of [0, 300, 600]) capture.observe(points, 'squat', null, 155, 110, t, 1.3);
  const sample = capture.snapshotMissed('squat', 700);
  assert.equal(sample.source, 'missed');
  assert.equal(sample.frames.length, 3);
  assert.equal(sample.aspectRatio, 1.3);
  assert.ok(sample.frames.every(f => f.phase === 'unknown'));
  assert.deepEqual(sample.frames[0].landmarks.map(p => p.index), [23, 24, 25, 26, 27, 28]);
  assert.equal(capture.finishRep('squat'), null);
  assert.equal(capture.snapshotMissed('squat', 13000), null);
  capture.reset();
  assert.equal(capture.snapshotMissed('squat', 700), null);
});

test('successful cycles remain captureable as reference samples', () => {
  const capture = new RepCapture();
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: .99 }));
  for (const [t, angle] of [[0, 170], [300, 130], [600, 90], [900, 130], [1200, 170]]) {
    capture.observe(points, 'squat', angle, 155, 110, t, 4 / 3);
  }
  const sample = capture.finishRep('squat');
  assert.equal(sample.source, 'rep');
  assert.equal(sample.frames.length, 5);
  assert.equal(sample.frames.at(-1).offsetMs, 1200);
});
