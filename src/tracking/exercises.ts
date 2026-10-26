import { CycleCounter, type CounterConfig, type CounterOutput } from './counter.ts';
import { angleAt, distance, vectorAngle, visibility } from './geometry.ts';
import { LM, type Exercise, type Point } from './types.ts';

/** Bump this whenever measurement or thresholds change, so saved pose logs say which version counted them. */
export const TRACKER_VERSION = 'calibrated-cycle-v3';

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
  /**
   * Optional: measure each body side separately, with its own counter.
   * A rep counts when either side completes one (once, if both move together).
   */
  sides?: { joints: number[]; measure: (points: Point[], aspect: number) => number | null }[];
  /**
   * Optional: a body point that should stay put during reps (e.g. the shoulders when lying
   * on your side). If it moves more than ANCHOR_DRIFT body-lengths after calibrating, you're
   * repositioning, not doing a rep, so the counter starts over.
   */
  anchor?: (points: Point[], aspect: number) => { x: number; y: number; scale: number } | null;
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
 * Side leg raise: the hip angle (shoulder, hip, knee) on one side of the body.
 * It changes whenever the pelvis lifts or the thigh swings, whichever way it moves,
 * so it works lying on your side (bent or straight legs) and standing.
 * Only that side's shoulder, hip and knee need to be visible, so the hidden
 * bottom leg doesn't matter. Each side gets its own counter.
 */
const LEG_VIS = 0.45;
function hipAngle(side: 'left' | 'right') {
  const [s, h, k] = side === 'left'
    ? [LM.leftShoulder, LM.leftHip, LM.leftKnee]
    : [LM.rightShoulder, LM.rightHip, LM.rightKnee];
  return (p: Point[], aspect: number): number | null => {
    if ([s, h, k].some((i) => visibility(p[i]) < LEG_VIS)) return null;
    return angleAt(p[s], p[h], p[k], aspect);
  };
}
const leftHipAngle = hipAngle('left');
const rightHipAngle = hipAngle('right');
const LEFT_LEG = [LM.leftShoulder, LM.leftHip, LM.leftKnee];
const RIGHT_LEG = [LM.rightShoulder, LM.rightHip, LM.rightKnee];

/** Midpoint of the visible shoulders, scaled by shoulder-to-hip length. */
function shoulderAnchor(p: Point[], aspect: number) {
  const shoulders = [p[LM.leftShoulder], p[LM.rightShoulder]].filter((q) => visibility(q) >= LEG_VIS) as Point[];
  const hips = [p[LM.leftHip], p[LM.rightHip]].filter((q) => visibility(q) >= LEG_VIS) as Point[];
  if (!shoulders.length || !hips.length) return null;
  const mid = (qs: Point[]) => ({ x: qs.reduce((t, q) => t + q.x, 0) / qs.length, y: qs.reduce((t, q) => t + q.y, 0) / qs.length });
  const s = mid(shoulders), h = mid(hips);
  const scale = distance({ ...s }, { ...h }, aspect);
  return scale && scale > 0.03 ? { x: s.x * aspect, y: s.y, scale } : null;
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
    joints: [LM.leftShoulder, LM.rightShoulder, LM.leftHip, LM.rightHip, LM.leftKnee, LM.rightKnee],
    signal: 'Hip angle',
    format: deg,
    measure: (p, a) => rightHipAngle(p, a) ?? leftHipAngle(p, a),
    sides: [{ joints: LEFT_LEG, measure: leftHipAngle }, { joints: RIGHT_LEG, measure: rightHipAngle }],
    anchor: shoulderAnchor,
    counter: { direction: 'either', scale: 'degrees', trigger: 15, release: 6, stableTolerance: 8, isValidRest: (r) => r >= 120 },
    setup: 'Phone on the floor a couple of meters away, side-on to you. Your whole body needs to be in frame, head included: the pose model can’t find you from legs alone.',
    steps: ['Start position', 'Lift', 'Lower back down'],
    text: {
      searching: 'Get your head, shoulders, hips and knees in view',
      position: 'Get into your start position',
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

/** Two sides moving together finish their reps within this window; count that once. */
const SAME_REP_MS = 900;
/** How far the anchor may drift (in shoulder-to-hip lengths) before we treat it as repositioning. */
const ANCHOR_DRIFT = 0.25;
/** A side is used when its joints are this visible; below it, only the clearest side counts. */
const BOTH_SIDES_VIS = 0.7;

const STATUS_RANK: Record<CounterOutput['status'], number> = {
  searching: 0, position: 1, calibrating: 2, ready: 3, moving: 4, returning: 5, bottom: 6,
};

export function createTracker(exercise: Exercise): Tracker {
  const def = EXERCISES[exercise];
  const sides = def.sides ?? [{ joints: def.joints, measure: def.measure }];
  const counters = sides.map(() => new CycleCounter(def.counter));
  const sideVis = sides.map(() => 0);
  let lastRepAt = -Infinity;
  let anchorAt: { x: number; y: number; scale: number } | null = null;
  const calibrated = (o: CounterOutput) => o.rest !== null;

  return {
    def,
    reset: () => { counters.forEach((c) => c.reset()); lastRepAt = -Infinity; anchorAt = null; },
    update(points, aspect, now) {
      const usable = !!points && Number.isFinite(aspect) && aspect > 0;

      // Repositioning check: if the anchor moved a lot since calibrating, start over.
      if (def.anchor && usable) {
        const a = def.anchor(points!, aspect);
        if (a && anchorAt && Math.hypot(a.x - anchorAt.x, a.y - anchorAt.y) > ANCHOR_DRIFT * anchorAt.scale) {
          counters.forEach((c) => c.reset());
          anchorAt = null;
        }
      }

      // Smoothed visibility per side, to decide which sides may count.
      sides.forEach((side, i) => {
        const v = usable ? Math.min(...side.joints.map((j) => visibility(points![j]))) : 0;
        sideVis[i] = sideVis[i]! * 0.8 + v * 0.2;
      });
      const clearest = sideVis.indexOf(Math.max(...sideVis));
      const allowed = sideVis.map((v, i) => i === clearest || v >= BOTH_SIDES_VIS);

      const outs = counters.map((c, i) => c.update(usable ? sides[i]!.measure(points!, aspect) : null, now));
      if (def.anchor && usable && !anchorAt && outs.some((o, i) => allowed[i] && calibrated(o))) {
        anchorAt = def.anchor(points!, aspect);
      }

      // Show the clearest side's state (or whichever allowed side is deepest into a rep).
      const candidates = outs.filter((_, i) => allowed[i]);
      const best = candidates.reduce((a, b) =>
        (b.progress > a.progress || (b.progress === a.progress && STATUS_RANK[b.status] > STATUS_RANK[a.status])) ? b : a);
      let counted = false;
      if (outs.some((o, i) => o.counted && allowed[i]) && now - lastRepAt > SAME_REP_MS) {
        counted = true;
        lastRepAt = now;
      }
      return { ...best, counted, text: counted ? 'Rep counted' : def.text[best.status] };
    },
  };
}
