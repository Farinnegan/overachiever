/*
 * Adapted from Google ML Kit PoseEmbedding, PoseClassifier, and EMASmoothing.
 * Copyright 2020 Google LLC. Licensed under the Apache License, Version 2.0.
 * https://www.apache.org/licenses/LICENSE-2.0
 * See public/pose/NOTICE.md and LICENSE for provenance and modifications.
 */
export type Exercise = 'squat' | 'push-up';
export type Point = { x: number; y: number; z?: number; visibility?: number };
export type PoseClass = 'squats_up' | 'squats_down' | 'pushups_up' | 'pushups_down';
export type Scores = Record<PoseClass, number>;
export type PosePhase = 'stand' | 'lower' | 'bottom' | 'return' | 'unknown';
type V = [number, number, number];
export type Reference = { name: string; label: PoseClass; points: Point[]; embedding: number[] };
const CLASSES: PoseClass[] = ['squats_up', 'squats_down', 'pushups_up', 'pushups_down'];
const zero = (): Scores => ({ squats_up: 0, squats_down: 0, pushups_up: 0, pushups_down: 0 });
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const avg = (a: V, b: V): V => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const PAIRS = [[11, 13], [12, 14], [13, 15], [14, 16], [23, 25], [24, 26], [25, 27], [26, 28],
  [11, 15], [12, 16], [23, 27], [24, 28], [23, 15], [24, 16], [11, 27], [12, 28],
  [23, 15], [24, 16], [13, 14], [25, 26], [15, 16], [27, 28]];

/** Hip-centered, body-size-normalized pairwise 3D vectors, matching Google's embedding. */
export function embedding(points: Point[]): number[] {
  if (points.length !== 33 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z ?? 0))) {
    throw new Error('Expected 33 finite pose landmarks.');
  }
  const raw: V[] = points.map(p => [p.x, p.y, p.z ?? 0]);
  const hips = avg(raw[23]!, raw[24]!);
  const shoulders = avg(raw[11]!, raw[12]!);
  const torso = sub(shoulders, hips);
  const size = Math.max(Math.hypot(torso[0], torso[1]) * 2.5,
    ...raw.map(p => Math.hypot(p[0] - hips[0], p[1] - hips[1])));
  if (size < 1e-8) throw new Error('Degenerate pose.');
  const lm: V[] = raw.map(p => sub(p, hips).map(n => n * 100 / size) as V);
  return [sub(avg(lm[23]!, lm[24]!), avg(lm[11]!, lm[12]!)), ...PAIRS.map(([a, b]) => sub(lm[a!]!, lm[b!]!))].flat();
}

export function parseReferences(csv: string): Reference[] {
  const refs = csv.trim().split(/\r?\n/).map(line => {
    const [name, label, ...coords] = line.split(',');
    if (!name || !CLASSES.includes(label as PoseClass) || coords.length !== 99) throw new Error('Invalid pose reference data.');
    const numbers = coords.map(Number);
    if (numbers.some(n => !Number.isFinite(n))) throw new Error('Invalid reference coordinates.');
    const points = Array.from({ length: 33 }, (_, i) => ({ x: numbers[i * 3]!, y: numbers[i * 3 + 1]!, z: numbers[i * 3 + 2]! }));
    return { name, label: label as PoseClass, points, embedding: embedding(points) };
  });
  for (const label of CLASSES) if (refs.filter(r => r.label === label).length < 10) throw new Error(`Missing references for ${label}.`);
  return refs;
}

export class PoseClassifier {
  readonly references: Reference[];
  constructor(references: Reference[]) { this.references = references; }
  classify(points: Point[]): Scores {
    const input = embedding(points);
    const mirror = input.map((n, i) => i % 3 === 0 ? -n : n);
    const distance = (sample: number[], mean: boolean) => {
      let original = 0, flipped = 0;
      for (let i = 0; i < input.length; i++) {
        const weight = i % 3 === 2 ? .2 : 1;
        const a = Math.abs(input[i]! - sample[i]!) * weight;
        const b = Math.abs(mirror[i]! - sample[i]!) * weight;
        original = mean ? original + a : Math.max(original, a);
        flipped = mean ? flipped + b : Math.max(flipped, b);
      }
      return Math.min(original, flipped);
    };
    const top = this.references.map(r => ({ r, distance: distance(r.embedding, false) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 30);
    const nearest = top.map(({ r }) => ({ r, distance: distance(r.embedding, true) }))
      .sort((a, b) => a.distance - b.distance).slice(0, 10);
    const scores = zero();
    for (const { r } of nearest) scores[r.label] += 1 / nearest.length;
    return scores;
  }
}

export class PoseSmoothing {
  private window: Scores[] = [];
  reset() { this.window = []; }
  add(input: Scores): Scores {
    this.window.unshift(input);
    this.window = this.window.slice(0, 10);
    const output = zero();
    let weight = 1, total = 0;
    for (const scores of this.window) {
      for (const label of CLASSES) output[label] += scores[label] * weight;
      total += weight;
      weight *= .8;
    }
    for (const label of CLASSES) output[label] /= total;
    return output;
  }
}

/** Google-style hysteresis with an explicit up→down→up safeguard for complete reps. */
export class ExerciseCounter {
  private stage: 'unarmed' | 'up' | 'down' = 'unarmed';
  reset() { this.stage = 'unarmed'; }
  update(scores: Scores, exercise: Exercise): { counted: boolean; phase: PosePhase; text: string; confidence: number } {
    const prefix = exercise === 'squat' ? 'squats' : 'pushups';
    const up = scores[`${prefix}_up`];
    const down = scores[`${prefix}_down`];
    const confidence = Math.max(up, down);
    let counted = false;
    if (this.stage === 'unarmed') {
      if (up > .6 + 1e-9) this.stage = 'up';
    } else if (this.stage === 'up') {
      if (down > .6 + 1e-9) this.stage = 'down';
    } else if (down < .4 - 1e-9 && up > .6 + 1e-9) {
      counted = true; this.stage = 'up';
    }
    const phase: PosePhase = this.stage === 'unarmed' ? 'unknown' :
      this.stage === 'down' ? (down > .6 + 1e-9 ? 'bottom' : 'return') : up > .6 + 1e-9 ? 'stand' : 'lower';
    const text = phase === 'unknown' ? (exercise === 'squat' ? 'Start standing tall · full body in view' : 'Start in a high plank · full body in view') :
      phase === 'stand' ? (exercise === 'squat' ? 'Up · ready to squat' : 'High plank · arms extended') :
      phase === 'bottom' ? (exercise === 'squat' ? 'Down · return to standing' : 'Lowered · push back up') :
      phase === 'return' ? 'Return to your starting position' : 'Lower with control';
    return { counted, phase, text, confidence };
  }
}

export class ExerciseTracker {
  private smooth = new PoseSmoothing();
  private counter = new ExerciseCounter();
  private last = -Infinity;
  readonly classifier: PoseClassifier;
  readonly exercise: Exercise;
  constructor(classifier: PoseClassifier, exercise: Exercise) { this.classifier = classifier; this.exercise = exercise; }
  reset() { this.smooth.reset(); this.counter.reset(); this.last = -Infinity; }
  update(points: Point[] | undefined, aspect: number, now: number) {
    const limbs = this.exercise === 'squat' ? [[11, 23, 25, 27], [12, 24, 26, 28]] :
      [[11, 13, 15, 23, 27], [12, 14, 16, 24, 28]];
    const visible = points?.length === 33 && limbs.some(side => side.every(i => (points[i]?.visibility ?? 0) >= .5));
    if (!visible || !Number.isFinite(aspect) || aspect <= 0) {
      this.reset();
      return { counted: false, phase: 'unknown' as const, text: 'Keep your full body clearly in view', confidence: 0 };
    }
    if (now - this.last > 500) { this.smooth.reset(); this.counter.reset(); }
    this.last = now;
    try {
      // MediaPipe x/z use image width, y uses height. Match the reference pixel geometry.
      const pixels = points!.map(p => ({ x: p.x * aspect, y: p.y, z: (p.z ?? 0) * aspect }));
      return this.counter.update(this.smooth.add(this.classifier.classify(pixels)), this.exercise);
    } catch {
      this.reset();
      return { counted: false, phase: 'unknown' as const, text: 'Tracking uncertain · adjust your camera', confidence: 0 };
    }
  }
}

let cached: Promise<PoseClassifier> | null = null;
export function loadClassifier(): Promise<PoseClassifier> {
  if (!cached) cached = fetch(`${import.meta.env.BASE_URL}pose/fitness_pose_samples.csv`).then(async res => {
    if (!res.ok) throw new Error('Exercise reference samples could not load.');
    return new PoseClassifier(parseReferences(await res.text()));
  }).catch(error => { cached = null; throw error; });
  return cached;
}
