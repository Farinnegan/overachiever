import type { Point } from './types.ts';

export const visibility = (p: Point | undefined) => p?.visibility ?? 0;

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const finite = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);

/** Angle between two 2D vectors, in degrees (0..180). */
export function vectorAngle(u: [number, number], v: [number, number]): number {
  const lengths = Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]);
  if (lengths < 1e-9) return NaN;
  const cos = clamp((u[0] * v[0] + u[1] * v[1]) / lengths, -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Angle at joint b formed by a-b-c, in degrees, using screen (2D) coordinates.
 * x is scaled by the frame aspect ratio so angles are not stretched.
 */
export function angleAt(a: Point | undefined, b: Point | undefined, c: Point | undefined, aspect: number): number | null {
  if (!finite(a) || !finite(b) || !finite(c)) return null;
  const deg = vectorAngle([(a.x - b.x) * aspect, a.y - b.y], [(c.x - b.x) * aspect, c.y - b.y]);
  return Number.isFinite(deg) ? deg : null;
}

export function distance(a: Point | undefined, b: Point | undefined, aspect: number): number | null {
  if (!finite(a) || !finite(b)) return null;
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

export function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function percentile(values: number[], q: number): number {
  const s = [...values].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}
