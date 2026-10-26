import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXERCISES } from '../src/tracking/exercises.ts';
import { fromLegacyRecord, fromPoseLog, replayCount, type LegacyRecord, type PoseLog } from '../src/tracking/replay.ts';

/**
 * Real movement recorded on Fal's phone with the old Replit app (data/training).
 * Each sample is replayed through the current trackers.
 */
const data = JSON.parse(readFileSync(new URL('../data/training/rep_training_examples.json', import.meta.url), 'utf8')) as { records: LegacyRecord[] };
const byId = Object.fromEntries(data.records.map((r) => [r.recordId, r]));
const count = (r: LegacyRecord) => replayCount(r.exercise as 'squat' | 'push-up', fromLegacyRecord(r), r.aspectRatio).counted;

test('push-up example-017: old app counted 0, new tracker counts the 2 full push-ups', () => {
  // Plank, two full push-ups, then a third descent that never comes back up
  // (shoulders stay at floor level until the clip ends). Two is the honest count.
  assert.equal(count(byId['example-017']!), 2);
});

test('push-up example-015 and 016: arms out of view, nothing to count', () => {
  assert.equal(count(byId['example-015']!), 0);
  assert.equal(count(byId['example-016']!), 0);
});

test('every squat labelled correct that starts standing counts exactly one rep', () => {
  // example-013 and 014 were clipped mid-squat (knee already bent at the first frame),
  // so there is no standing start to calibrate from. Live sessions always have one.
  const def = EXERCISES.squat;
  const startsStanding = (r: LegacyRecord) => {
    const pts: { x: number; y: number; visibility: number }[] = [];
    for (const l of r.frames[0]!.landmarks) pts[l.index] = l;
    const v = def.measure(pts, r.aspectRatio);
    return v !== null && def.counter.isValidRest(v);
  };
  const correct = data.records.filter((r) => r.exercise === 'squat' && r.label === 'correct' && startsStanding(r));
  assert.ok(correct.length >= 10, `expected at least 10 usable squat samples, got ${correct.length}`);
  const off = correct.map((r) => ({ id: r.recordId, counted: count(r) })).filter((r) => r.counted !== 1);
  assert.deepEqual(off, []);
});

// ---------- Sessions uploaded from the phone (data/sessions) ----------

const session = (name: string) => JSON.parse(readFileSync(new URL(`../data/sessions/${name}`, import.meta.url), 'utf8')) as PoseLog;
const recount = (log: PoseLog) => replayCount(log.exercise, fromPoseLog(log), log.aspect).counted;

test('2026-10-26 push-ups: 10 of 10', () => {
  assert.equal(recount(session('2026-10-26_1330_push-up_1793010611090.json')), 10);
});

test('2026-10-26 leg raises: all 7 reps the camera could see, nothing during setup', () => {
  // Checked against Fal's video clips: 12 single-leg bridges in this session. 5 in the living room
  // (~1:35-1:46) were never detected because only her legs were in frame, so the pose model found
  // no person. The 7 in the second room (2:33-2:51) are all counted; the setup in between is not.
  assert.equal(recount(session('2026-10-26_1326_side-leg-raise_1793010407877.json')), 7);
});
