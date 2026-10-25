import { createTracker } from './exercises.ts';
import type { Exercise, Point } from './types.ts';

/**
 * Offline replay: run saved pose data back through the current trackers.
 * This is the "training" loop for this app. Instead of training a model,
 * you change thresholds in exercises.ts and replay your saved sessions to
 * check the counts got closer to what you actually did.
 */

export type ReplayFrame = { t: number; points: Point[] };

/** Saved session pose log (what the app exports from Settings). */
export type PoseLog = {
  id: string;
  exercise: Exercise;
  startedAt: string;
  aspect: number;
  trackerVersion: string;
  countedReps: number;
  actualReps: number | null;
  placement: string;
  joints: number[];
  /** Each frame: t = ms since start, p = [x, y, visibility] for each joint, in `joints` order. */
  frames: { t: number; p: number[] }[];
  missedFlags: number[];
};

export function fromPoseLog(log: PoseLog): ReplayFrame[] {
  return log.frames.map((f) => {
    const points: Point[] = [];
    log.joints.forEach((index, j) => {
      points[index] = { x: f.p[j * 3]!, y: f.p[j * 3 + 1]!, visibility: f.p[j * 3 + 2]! };
    });
    return { t: f.t, points };
  });
}

/** Records in data/training/rep_training_examples.json (exported from the old Replit app). */
export type LegacyRecord = {
  recordId: string;
  exercise: string;
  label: string;
  source: string;
  aspectRatio: number;
  frames: { offsetMs: number; landmarks: { index: number; x: number; y: number; visibility: number }[] }[];
};

/**
 * Legacy samples were saved at about 4 frames per second and were cut exactly at the
 * start and end of the rep. Replay them at the live loop's ~15 fps (repeating each frame
 * until the next one), holding the first frame for `leadInMs` and the last for
 * `leadOutMs`, like standing still before and after.
 */
export function fromLegacyRecord(record: LegacyRecord, leadInMs = 1000, leadOutMs = 600, stepMs = 66): ReplayFrame[] {
  const toPoints = (f: LegacyRecord['frames'][number]) => {
    const points: Point[] = [];
    for (const l of f.landmarks) points[l.index] = { x: l.x, y: l.y, visibility: l.visibility };
    return points;
  };
  const out: ReplayFrame[] = [];
  const first = record.frames[0];
  if (!first) return out;
  for (let t = 0; t < leadInMs; t += stepMs) out.push({ t, points: toPoints(first) });
  record.frames.forEach((f, i) => {
    const end = record.frames[i + 1]?.offsetMs ?? f.offsetMs + leadOutMs;
    for (let t = f.offsetMs; t < end; t += stepMs) out.push({ t: leadInMs + t, points: toPoints(f) });
  });
  return out;
}

export function replayCount(exercise: Exercise, frames: ReplayFrame[], aspect: number) {
  const tracker = createTracker(exercise);
  const repTimes: number[] = [];
  for (const f of frames) {
    if (tracker.update(f.points, aspect, f.t).counted) repTimes.push(f.t);
  }
  return { counted: repTimes.length, repTimes };
}
