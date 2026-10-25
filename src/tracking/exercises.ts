import { CycleCounter, type CounterConfig, type CounterOutput } from './counter.ts';
import { angleAt, distance, vectorAngle, visibility } from './geometry.ts';
import { LM, type Exercise, type Point } from './types.ts';

/** Bump this whenever measurement or thresholds change, so saved pose logs say which version counted them. */
export const TRACKER_VERSION = 'calibrated-cycle-v2';

const MIN_VIS = 0.5;

export type ExerciseDef = {
  id: Exercise;
  label: string;
  /** Joints the counter reads. Drawn highlighted on the camera overlay. */
  joints: number[];
  /** What the single tracked number means, for the on-screen readout. */
  signal: string;
  format: (value: number) => string;
  measure: (points: Point[], aspect: number) => number | null;
  counter: CounterConfig;
  setup: string;
  steps: [string, string, string];
  text: { searching: string; position: string; calibrating: string; ready: string; moving: string; bottom: string; returning: string };
};

/** Squat: knee angle (hip-knee-ankle) on whichever side the camera sees best. */
function kneeAngle(p: Point[], aspect: number): number | null {
  const sides = [
    [LM.leftHip, LM.leftKnee, LM.leftAnkle],
    [LM.rightHip, LM.rightKnee, LM.rightAnkle],
  ].map((ids) => ({ ids, vis: Math.min(...ids.map((i) => visibility(p[i]))) }));
  const best = sides[0]!.vis >= sides[1]!.vis ? sides[0]! : sides[1]!;
  if (best.vis < MIN_VIS) return null;
  const [a, b, c] = best.ids;
  return angleAt(p[a!], p[b!], p[c!], aspect);
}

/**
 * Front push-up: vertical gap between shoulders and wrists, divided by shoulder width.
 * Hands stay on the floor, so as the chest lowers the shoulders drop toward the wrists
 * and get closer to the camera (shoulder width grows). Both make this number shrink.
 * Dividing by shoulder width means it doesn't matter how far the phone is.
 */
function pushupDrop(p: Point[], aspect: number): number | null {
  const ls = p[LM.leftShoulder], rs = p[LM.rightShoulder];
  if (visibility(ls) < MIN_VIS || visibility(rs) < MIN_VIS) return null;
  const wrists = [p[LM.leftWrist], p[LM.rightWrist]].filter((w) => visibility(w) >= MIN_VIS) as Point[];
  if (wrists.length === 0) return null;
  const width = distance(ls, rs, aspect);
  if (width === null || width < 0.04) return null; // too far away, or a side view
  const shoulderY = (ls!.y + rs!.y) / 2;
  const wristY = wrists.reduce((s, w) => s + w.y, 0) / wrists.length;
  return (wristY - shoulderY) / width;
}

/**
 * Side leg raise: the angle at the pelvis between the two thighs (hip to knee).
 * Legs together is a small angle; raising either leg out to the side opens it.
 * Works standing or lying on your side, and only needs hips and knees in view.
 */
function thighSpread(p: Point[], aspect: number): number | null {
  const ids = [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee];
  if (ids.some((i) => visibility(p[i]) < MIN_VIS)) return null;
  const lh = p[LM.leftHip]!, rh = p[LM.rightHip]!, lk = p[LM.leftKnee]!, rk = p[LM.rightKnee]!;
  const deg = vectorAngle([(lk.x - lh.x) * aspect, lk.y - lh.y], [(rk.x - rh.x) * aspect, rk.y - rh.y]);
  return Number.isFinite(deg) ? deg : null;
}

const deg = (v: number) => `${Math.round(v)}°`;

export const EXERCISES: Record<Exercise, ExerciseDef> = {
  squat: {
    id: 'squat',
    label: 'Squats',
    joints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee, LM.leftAnkle, LM.rightAnkle],
    signal: 'Knee angle',
    format: deg,
    measure: kneeAngle,
    counter: { direction: 'down', scale: 'degrees', trigger: 30, release: 15, stableTolerance: 12, isValidRest: (r) => r >= 140 },
    setup: 'Phone on the floor, a few steps away, side-on or at an angle. Hips, knees and ankles in frame.',
    steps: ['Stand tall', 'Squat down', 'Stand back up'],
    text: {
      searching: 'Get your hips, knees and ankles in view',
      position: 'Stand up straight to start',
      calibrating: 'Hold still for a second…',
      ready: 'Ready · squat down',
      moving: 'Lower…',
      bottom: 'Down · now stand up',
      returning: 'Stand all the way up',
    },
  },
  'push-up': {
    id: 'push-up',
    label: 'Push-ups',
    joints: [LM.leftShoulder, LM.rightShoulder, LM.leftElbow, LM.rightElbow, LM.leftWrist, LM.rightWrist],
    signal: 'Shoulder height',
    format: (v) => v.toFixed(2),
    measure: pushupDrop,
    counter: { direction: 'down', scale: 'ratio', trigger: 0.25, release: 0.1, stableTolerance: 0.12, isValidRest: (r) => r >= 0.55 },
    setup: 'Phone on the floor in front of you, facing you. Face, shoulders, arms and hands in frame. Legs can be out of frame.',
    steps: ['High plank', 'Lower your chest', 'Push back up'],
    text: {
      searching: 'Get your shoulders and both hands in view',
      position: 'Get into a high plank, arms straight',
      calibrating: 'Hold the plank for a second…',
      ready: 'Ready · lower down',
      moving: 'Lower…',
      bottom: 'Down · push up',
      returning: 'Push all the way up',
    },
  },
  'side-leg-raise': {
    id: 'side-leg-raise',
    label: 'Side leg raises',
    joints: [LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee],
    signal: 'Leg opening',
    format: deg,
    measure: thighSpread,
    counter: { direction: 'up', scale: 'degrees', trigger: 25, release: 10, stableTolerance: 10, isValidRest: (r) => r <= 40 },
    setup: 'Camera facing your hips, standing or lying on your side. Pelvis and both knees in frame. Feet and head can be out.',
    steps: ['Legs together', 'Raise the leg out', 'Bring it back'],
    text: {
      searching: 'Get your hips and both knees in view',
      position: 'Bring your legs together to start',
      calibrating: 'Hold still for a second…',
      ready: 'Ready · raise your leg',
      moving: 'Raise…',
      bottom: 'Up · bring it back',
      returning: 'Legs back together',
    },
  },
};

export type TrackResult = CounterOutput & { text: string };

export type Tracker = {
  def: ExerciseDef;
  update: (points: Point[] | undefined, aspect: number, now: number) => TrackResult;
  reset: () => void;
};

export function createTracker(exercise: Exercise): Tracker {
  const def = EXERCISES[exercise];
  const counter = new CycleCounter(def.counter);
  return {
    def,
    reset: () => counter.reset(),
    update(points, aspect, now) {
      const value = points && Number.isFinite(aspect) && aspect > 0 ? def.measure(points, aspect) : null;
      const out = counter.update(value, now);
      return { ...out, text: out.counted ? 'Rep counted' : def.text[out.status] };
    },
  };
}
