import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseReferences, embedding, PoseClassifier, PoseSmoothing, ExerciseCounter, ExerciseTracker } from './classifier.ts';
import { RepCapture } from '../contribution/capture.ts';
const refs = parseReferences(await readFile('artifacts/rep-accountability/public/pose/fitness_pose_samples.csv', 'utf8'));
const classifier = new PoseClassifier(refs);
const zero = () => ({ squats_up: 0, squats_down: 0, pushups_up: 0, pushups_down: 0 });
const score = (name, confidence = 1) => ({ ...zero(), [name]: confidence });
const fixture = label => refs.find(r => r.label === label && classifier.classify(r.points)[label] > .8);
const normalized = (points, aspect = 4 / 3) => {
  const minX = Math.min(...points.map(p => p.x)), minY = Math.min(...points.map(p => p.y));
  const h = Math.max(...points.map(p => Math.max((p.x - minX + 20) / aspect, p.y - minY + 20))) + 20;
  return points.map(p => ({ x: (p.x - minX + 20) / (h * aspect), y: (p.y - minY + 20) / h, z: p.z / (h * aspect), visibility: .99 }));
};

test('loads all 812 original Google samples in the four exercise classes', () => {
  assert.equal(refs.length, 812);
  for (const [name, count] of [['pushups_down', 195], ['pushups_up', 201], ['squats_down', 225], ['squats_up', 191]]) {
    assert.equal(refs.filter(r => r.label === name).length, count);
    assert.ok(fixture(name), `No confident fixture for ${name}`);
  }
  assert.throws(() => parseReferences('invalid'));
});

test('embedding removes translation and scale; classifier recognizes mirrored reference poses', () => {
  for (const name of ['squats_up', 'squats_down', 'pushups_up', 'pushups_down']) {
    const p = fixture(name).points;
    const original = embedding(p);
    const transformed = embedding(p.map(v => ({ x: v.x * 2 + 40, y: v.y * 2 - 15, z: v.z * 2 + 32 })));
    original.forEach((n, i) => assert.ok(Math.abs(n - transformed[i]) < 1e-9));
    const mirrored = classifier.classify(p.map(v => ({ ...v, x: -v.x })));
    assert.ok(mirrored[name] > .8);
  }
});

test('smoothing and hysteresis reject boundary jitter, partial reps and unrelated exercises', () => {
  const smooth = new PoseSmoothing();
  smooth.add(score('squats_up'));
  assert.ok(smooth.add(score('squats_down')).squats_down < .6);
  const counter = new ExerciseCounter();
  for (const name of ['squats_down', 'squats_up']) assert.equal(counter.update(score(name), 'squat').counted, false);
  assert.equal(counter.update(score('squats_down', .6), 'squat').counted, false);
  counter.update(score('squats_down'), 'squat');
  assert.equal(counter.update(score('pushups_up'), 'squat').counted, false);
  assert.equal(counter.update({ ...score('squats_up'), squats_down: .4 }, 'squat').counted, false);
  assert.equal(counter.update(score('squats_up'), 'squat').counted, true);
  assert.equal(counter.update(score('squats_up'), 'squat').counted, false);
});

for (const exercise of ['squat', 'push-up']) {
  test(`${exercise}: real reference up/down/up frames count once and yield reviewable six-joint samples`, () => {
    const prefix = exercise === 'squat' ? 'squats' : 'pushups';
    const up = normalized(fixture(`${prefix}_up`).points);
    const down = normalized(fixture(`${prefix}_down`).points);
    const tracker = new ExerciseTracker(classifier, exercise);
    const capture = new RepCapture();
    let count = 0, sample = null, now = 0;
    for (const poses of [up, down, up, up]) {
      for (let i = 0; i < 20; i++) {
        const result = tracker.update(poses, 4 / 3, now);
        capture.observePhase(poses, exercise, result.phase, now, 4 / 3);
        if (result.counted) { count++; sample = capture.finishRep(exercise); }
        now += 66;
      }
    }
    assert.equal(count, 1);
    assert.ok(sample);
    assert.equal(sample.exercise, exercise);
    assert.equal(sample.frames[0].phase, 'stand');
    assert.equal(sample.frames.at(-1).phase, 'stand');
    assert.ok(sample.frames.some(f => f.phase === 'bottom'));
    assert.deepEqual(sample.frames[0].landmarks.map(p => p.index), exercise === 'squat' ? [23, 24, 25, 26, 27, 28] : [11, 12, 13, 14, 15, 16]);

    // Tracking loss must not turn the previous down pose into a false count.
    for (let i = 0; i < 20; i++) { tracker.update(down, 4 / 3, now); now += 66; }
    assert.equal(tracker.update(undefined, 4 / 3, now).phase, 'unknown');
    for (let i = 0; i < 20; i++) { assert.equal(tracker.update(up, 4 / 3, now).counted, false); now += 66; }
    assert.equal(tracker.update(up.map(p => ({ ...p, visibility: .1 })), 4 / 3, now).phase, 'unknown');
  });
}
