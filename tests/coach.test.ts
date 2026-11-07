import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, SetupCoach } from '../src/session/coach.ts';
import type { Point } from '../src/tracking/types.ts';

/** A pose where only the listed joints are seen. */
function pose(seen: number[], at: [number, number] = [0.5, 0.5]): Point[] {
  const p: Point[] = Array.from({ length: 33 }, () => ({ x: at[0], y: at[1], visibility: 0.1 }));
  for (const i of seen) p[i] = { x: at[0], y: at[1], visibility: 0.95 };
  return p;
}
const ALL_LEG = [11, 12, 23, 24, 25, 26];

test('nothing wrong when the tracked joints are visible', () => {
  assert.equal(diagnose('side-leg-raise', pose(ALL_LEG)), null);
  assert.equal(diagnose('squat', pose([23, 25, 27])), null);
});

test('no person at all: says it can\'t see you, and asks for the whole body on lying exercises', () => {
  assert.match(diagnose('squat', undefined)!.text, /can’t see you/);
  assert.match(diagnose('hip-abduction', undefined)!.text, /whole body.*head/);
});

test('names the parts that are missing', () => {
  const d = diagnose('side-leg-raise', pose([11, 12, 23, 24]))!;
  assert.match(d.text, /can’t see your knees/);
  const sq = diagnose('squat', pose([23, 24, 25, 26]))!;
  assert.match(sq.text, /can’t see your feet/);
});

test('tells you to move back when you are cut off at the edge', () => {
  const d = diagnose('squat', pose([23, 25], [0.5, 0.99]))!;
  assert.match(d.text, /cut off/);
});

test('speaks only after the problem has lasted, then not again straight away', () => {
  const coach = new SetupCoach('side-leg-raise');
  const hidden = pose([11, 12, 23, 24]);
  let spoken: string[] = [];
  for (let t = 0; t <= 9000; t += 100) {
    const c = coach.update('searching', hidden, t);
    if (c) spoken.push(`${t}:${c.text}`);
  }
  assert.equal(spoken.length, 1);
  assert.ok(Number(spoken[0]!.split(':')[0]) >= 3000, 'waited before speaking');
  // Still broken ten seconds after the first callout: it repeats.
  spoken = [];
  for (let t = 9100; t <= 14000; t += 100) {
    const c = coach.update('searching', hidden, t);
    if (c) spoken.push(c.text);
  }
  assert.equal(spoken.length, 1);
});

test('says "got you" once tracking resumes after a spoken problem, and the first time it locks on', () => {
  const coach = new SetupCoach('squat');
  const first = coach.update('ready', pose([23, 25, 27]), 0);
  assert.equal(first?.kind, 'ok');
  assert.equal(coach.update('moving', pose([23, 25, 27]), 100), null);
  let said = false;
  for (let t = 200; t < 5000; t += 100) said ||= coach.update('searching', undefined, t) !== null;
  assert.ok(said);
  assert.deepEqual(coach.update('ready', pose([23, 25, 27]), 5200), { kind: 'ok', text: 'Got you.' });
  assert.equal(coach.update('ready', pose([23, 25, 27]), 5300), null);
});

test('a brief drop-out mid-set stays quiet', () => {
  const coach = new SetupCoach('push-up');
  coach.update('ready', pose([11, 12, 15]), 0);
  for (let t = 100; t < 1500; t += 100) assert.equal(coach.update('searching', undefined, t), null);
  assert.equal(coach.update('ready', pose([11, 12, 15]), 1600), null);
});

test('asks you to get into the start position, and to hold still', () => {
  const coach = new SetupCoach('squat');
  let text = '';
  for (let t = 0; t < 4000; t += 100) text = coach.update('position', pose([23, 25, 27]), t)?.text ?? text;
  assert.match(text, /Stand up straight/);
  const c2 = new SetupCoach('squat');
  text = '';
  for (let t = 0; t < 5000; t += 100) text = c2.update('calibrating', pose([23, 25, 27]), t)?.text ?? text;
  assert.match(text, /Hold still/);
});
