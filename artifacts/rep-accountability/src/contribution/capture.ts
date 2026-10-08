import type { RepTrainingPoseFrame } from '@workspace/api-client-react';
import type { ContribExercise, Sample } from './queue';

type Phase = 'stand' | 'lower' | 'bottom' | 'return';
type Pt = { x: number; y: number; visibility?: number };
type Raw = { t: number; phase: Phase; landmarks: RepTrainingPoseFrame['landmarks'] };

const INDICES: Record<ContribExercise, number[]> = {
  squat: [23, 24, 25, 26, 27, 28],
  'bicep-curl': [11, 12, 13, 14, 15, 16],
};
const INTERVAL_MS = 250; // about 4 fps
const MAX_FRAMES = 40;
const MIN_FRAMES = 3;
const MAX_SPAN = 12000;
const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

function toFrames(list: Raw[]): RepTrainingPoseFrame[] {
  const base = list[0]!.t;
  return list.map((r) => ({ offsetMs: Math.min(MAX_SPAN, Math.max(0, Math.round(r.t - base))), phase: r.phase, landmarks: r.landmarks }));
}

/** Stores only six joint coordinates per frame. No pixels, audio or face data ever pass through here. */
export class RepCapture {
  private cycle: Raw[] = [];
  private recent: Raw[] = [];
  private lastT = -Infinity;
  private phase: Phase | null = null;
  private overflow = false;
  private aspect = 1;

  reset() { this.cycle = []; this.recent = []; this.lastT = -Infinity; this.phase = null; this.overflow = false; }

  observe(landmarks: Pt[], exercise: ContribExercise, measure: number, extended: number, bent: number, now: number, aspectRatio: number) {
    if (Number.isFinite(aspectRatio)) this.aspect = Math.min(5, Math.max(0.2, aspectRatio));
    const pts = INDICES[exercise].map((i) => ({ i, p: landmarks[i] }));
    if (pts.some(({ p }) => !p)) { this.reset(); return; }
    let phase: Phase;
    if (measure > extended) phase = 'stand';
    else if (measure < bent) phase = 'bottom';
    else phase = this.phase === 'bottom' || this.phase === 'return' ? 'return' : 'lower';
    const changed = phase !== this.phase;
    this.phase = phase;
    if (!changed && now - this.lastT < INTERVAL_MS) return;
    this.lastT = now;
    const frame: Raw = {
      t: now, phase,
      landmarks: pts.map(({ i, p }) => ({ index: i as RepTrainingPoseFrame['landmarks'][number]['index'], x: clamp01(p!.x), y: clamp01(p!.y), visibility: clamp01(p!.visibility ?? 0) })),
    };
    this.recent.push(frame);
    while (this.recent.length > MAX_FRAMES || (this.recent.length > 1 && frame.t - this.recent[0]!.t > MAX_SPAN)) this.recent.shift();
    if (phase === 'stand') {
      if (this.overflow || this.cycle.every((f) => f.phase === 'stand')) { this.cycle = [frame]; this.overflow = false; return; }
    } else if (this.overflow) return;
    this.cycle.push(frame);
    if (this.cycle.length > MAX_FRAMES) { this.cycle = []; this.overflow = true; }
  }

  /** Call right after the app counts a rep. Returns a sample only for a short, complete cycle. */
  finishRep(exercise: ContribExercise): Sample | null {
    const c = this.cycle;
    const last = c[c.length - 1];
    const ok = c.length >= MIN_FRAMES && c.length <= MAX_FRAMES && c[0]!.phase === 'stand' && last!.phase === 'stand' &&
      c.some((f) => f.phase === 'bottom') && last!.t - c[0]!.t <= MAX_SPAN;
    this.cycle = last ? [last] : [];
    return ok ? { exercise, frames: toFrames(c), source: 'rep', aspectRatio: this.aspect } : null;
  }

  /** Snapshot of the last few seconds, for a rep the counter missed. */
  snapshotMissed(exercise: ContribExercise): Sample | null {
    const r = this.recent;
    if (r.length < MIN_FRAMES) return null;
    return { exercise, frames: toFrames(r.slice(-MAX_FRAMES)), source: 'missed', aspectRatio: this.aspect };
  }
}
