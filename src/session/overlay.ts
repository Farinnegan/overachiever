import type { Point } from '../tracking/types.ts';

const BONES: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];
const MIN_VIS = 0.5;

/**
 * Draw the detected skeleton over the camera preview. The joints the current exercise
 * reads are drawn big and lime, so you can see straight away if one is missing.
 * The video uses object-fit: cover, so the same crop is applied here.
 */
export function drawPose(canvas: HTMLCanvasElement, video: HTMLVideoElement, points: Point[] | undefined, highlight: number[], active: boolean) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (!points || !video.videoWidth) return;

  const scale = Math.max(w / video.videoWidth, h / video.videoHeight);
  const dx = (w - video.videoWidth * scale) / 2;
  const dy = (h - video.videoHeight * scale) / 2;
  const at = (p: Point) => [p.x * video.videoWidth * scale + dx, p.y * video.videoHeight * scale + dy] as const;
  const seen = (i: number) => (points[i]?.visibility ?? 0) >= MIN_VIS;
  const hot = new Set(highlight);

  ctx.lineCap = 'round';
  for (const [a, b] of BONES) {
    const pa = points[a], pb = points[b];
    if (!pa || !pb) continue;
    const both = seen(a) && seen(b);
    const important = hot.has(a) && hot.has(b);
    ctx.strokeStyle = important ? (active ? '#ff6600' : '#d4ff00') : 'rgba(255,255,255,.55)';
    ctx.globalAlpha = both ? 1 : 0.25;
    ctx.lineWidth = important ? 5 : 2.5;
    ctx.setLineDash(both ? [] : [6, 6]);
    const [x1, y1] = at(pa), [x2, y2] = at(pb);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const i of hot) {
    const p = points[i];
    if (!p) continue;
    const [x, y] = at(p);
    ctx.globalAlpha = seen(i) ? 1 : 0.35;
    ctx.fillStyle = seen(i) ? '#d4ff00' : '#ff6600';
    ctx.beginPath(); ctx.arc(x, y, seen(i) ? 7 : 9, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#000'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
