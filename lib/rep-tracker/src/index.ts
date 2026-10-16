export type Exercise = "squat" | "bicep-curl" | "push-up";
export type Rule = { extended: number; bent: number; visibility: number; cooldownMs: number };
export type Rules = Record<Exercise, Rule>;
export const BASELINE_VERSION = "mediapipe-lite-0.10.35/rules-v1";
export const BASELINE_RULES: Rules = {
  squat: { extended: 155, bent: 110, visibility: .65, cooldownMs: 850 },
  "bicep-curl": { extended: 150, bent: 75, visibility: .65, cooldownMs: 850 },
  "push-up": { extended: 150, bent: 90, visibility: .65, cooldownMs: 850 },
};
export type Landmark = { x: number; y: number; visibility?: number };
export type PoseFrame = {
  offsetMs: number;
  landmarks: (Landmark & { index: number })[];
};
export type TrackerState = { phase: "unarmed" | "ready" | "low"; lastRepAt: number };
export const initialState = (): TrackerState => ({ phase: "unarmed", lastRepAt: -Infinity });

/** Identical geometry and visibility selection for on-device inference and offline replay. */
export function chooseAngle(landmarks: (Landmark | undefined)[], exercise: Exercise, aspect: number, visibility = .65): number | null {
  const indices = exercise === "squat" ? [[23, 25, 27], [24, 26, 28]] : [[11, 13, 15], [12, 14, 16]];
  const sides = indices.map(side => side.map(i => landmarks[i]));
  const confidence = (side: (Landmark | undefined)[]) => Math.min(...side.map(p => p?.visibility ?? 0));
  const side = confidence(sides[0]!) >= confidence(sides[1]!) ? sides[0]! : sides[1]!;
  if (confidence(side) < visibility || side.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const [a, b, c] = side.map(p => ({ x: p!.x * aspect, y: p!.y }));
  const radians = Math.atan2(c!.y - b!.y, c!.x - b!.x) - Math.atan2(a!.y - b!.y, a!.x - b!.x);
  const degrees = Math.abs(radians * 180 / Math.PI);
  return degrees > 180 ? 360 - degrees : degrees;
}

export function step(state: TrackerState, measure: number | null, now: number, rule: Rule): boolean {
  if (measure === null) { state.phase = "unarmed"; return false; }
  if (measure > rule.extended) {
    const counted = state.phase === "low" && now - state.lastRepAt > rule.cooldownMs;
    if (counted) state.lastRepAt = now;
    state.phase = "ready";
    return counted;
  }
  if (measure < rule.bent && state.phase !== "unarmed") state.phase = "low";
  return false;
}

export function replay(frames: PoseFrame[], exercise: Exercise, aspect: number, rule: Rule): number {
  const state = initialState();
  let reps = 0;
  for (const frame of frames) {
    const points: (Landmark | undefined)[] = [];
    for (const p of frame.landmarks) points[p.index] = p;
    if (step(state, chooseAngle(points, exercise, aspect, rule.visibility), frame.offsetMs, rule)) reps++;
  }
  return reps;
}
