import type { CounterStatus } from '../tracking/counter.ts';
import { EXERCISES } from '../tracking/exercises.ts';
import { visibility } from '../tracking/geometry.ts';
import { LM, type Exercise, type Point } from '../tracking/types.ts';

/**
 * Setup coach: works out what to tell you when the camera can't track you, so it can be said
 * out loud while the phone is across the room. Pure logic, no sound here (see feedback.ts).
 */

export type Callout = { kind: 'problem' | 'ok'; text: string };

/** A joint counts as seen at this visibility. */
const SEEN = 0.5;
/** A problem must last this long before it is spoken, so walking into position stays quiet. */
const PERSIST_MS = 3000;
const CALIBRATING_PERSIST_MS = 3500;
/** The same problem is repeated at most this often; a different one can follow after GAP_MS. */
const REPEAT_MS = 10000;
const GAP_MS = 4000;

type Part = 'shoulders' | 'hips' | 'knees' | 'feet' | 'hands';
const PART_OF: Record<number, Part> = {
  [LM.leftShoulder]: 'shoulders', [LM.rightShoulder]: 'shoulders',
  [LM.leftWrist]: 'hands', [LM.rightWrist]: 'hands',
  [LM.leftHip]: 'hips', [LM.rightHip]: 'hips',
  [LM.leftKnee]: 'knees', [LM.rightKnee]: 'knees',
  [LM.leftAnkle]: 'feet', [LM.rightAnkle]: 'feet',
};

const legSide = (s: number, h: number, k: number) => [s, h, k];
/** For each exercise: alternative sets of joints, any one complete set is enough to track you. */
const NEEDS: Record<Exercise, number[][]> = {
  squat: [
    [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  ],
  'push-up': [
    [LM.leftShoulder, LM.rightShoulder, LM.leftWrist],
    [LM.leftShoulder, LM.rightShoulder, LM.rightWrist],
  ],
  'side-leg-raise': [legSide(LM.leftShoulder, LM.leftHip, LM.leftKnee), legSide(LM.rightShoulder, LM.rightHip, LM.rightKnee)],
  'hip-abduction': [legSide(LM.leftShoulder, LM.leftHip, LM.leftKnee), legSide(LM.rightShoulder, LM.rightHip, LM.rightKnee)],
};

/** Lying-down exercises where the pose model needs your head in view to find you at all. */
const NEEDS_WHOLE_BODY = new Set<Exercise>(['side-leg-raise', 'hip-abduction']);

const outOfFrame = (p: Point | undefined) => !p || p.x < 0.02 || p.x > 0.98 || p.y < 0.02 || p.y > 0.98;

const list = (parts: Part[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

/** What is wrong with the picture right now? Null if everything the tracker reads is visible. */
export function diagnose(exercise: Exercise, points: Point[] | undefined): { key: string; text: string } | null {
  if (!points) {
    return {
      key: 'none',
      text: NEEDS_WHOLE_BODY.has(exercise)
        ? 'I can’t see you. Move the phone back so your whole body is in the frame, head included.'
        : 'I can’t see you. Step into the frame, or move the phone further back.',
    };
  }
  // The set with the fewest missing joints is the one you are closest to completing.
  let best: number[] | null = null;
  for (const set of NEEDS[exercise]) {
    const missing = set.filter((i) => visibility(points[i]) < SEEN);
    if (missing.length === 0) return null;
    if (!best || missing.length < best.length) best = missing;
  }
  const parts = [...new Set(best!.map((i) => PART_OF[i]!))];
  const cutOff = best!.some((i) => outOfFrame(points[i]));
  const advice = cutOff ? 'You’re cut off. Move the phone further back.' : 'Move the phone back, or turn a little so nothing blocks it.';
  return { key: `missing:${parts.join(',')}:${cutOff ? 'edge' : 'hidden'}`, text: `I can’t see your ${list(parts)}. ${advice}` };
}

const isTracking = (s: CounterStatus) => s === 'ready' || s === 'moving' || s === 'bottom' || s === 'returning';

export class SetupCoach {
  private problemKey = '';
  private problemSince = 0;
  private lastSpokenAt = -Infinity;
  private lastKey = '';
  private spokeProblem = false;
  private everTracking = false;

  private exercise: Exercise;

  constructor(exercise: Exercise) { this.exercise = exercise; }

  /** Call once per processed frame. Returns something to say, or null. */
  update(status: CounterStatus, points: Point[] | undefined, now: number): Callout | null {
    if (isTracking(status)) {
      this.problemKey = '';
      const first = !this.everTracking;
      this.everTracking = true;
      if (first || this.spokeProblem) {
        this.spokeProblem = false;
        return { kind: 'ok', text: first ? 'I’ve got you. Start when you’re ready.' : 'Got you.' };
      }
      return null;
    }

    const def = EXERCISES[this.exercise];
    let key: string, text: string;
    if (status === 'searching') {
      const d = diagnose(this.exercise, points);
      key = d?.key ?? 'searching';
      text = d?.text ?? def.text.searching;
    } else if (status === 'position') {
      key = 'position'; text = def.text.position;
    } else {
      key = 'calibrating'; text = 'Hold still for a second.';
    }

    if (key !== this.problemKey) { this.problemKey = key; this.problemSince = now; }
    if (now - this.problemSince < (status === 'calibrating' ? CALIBRATING_PERSIST_MS : PERSIST_MS)) return null;
    const sinceLast = now - this.lastSpokenAt;
    if (sinceLast < (key === this.lastKey ? REPEAT_MS : GAP_MS)) return null;

    this.lastSpokenAt = now;
    this.lastKey = key;
    this.spokeProblem = true;
    return { kind: 'problem', text };
  }
}
