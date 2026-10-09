import type { RepTrainingPoseFrame } from '@workspace/api-client-react';

/** Interpolation is display-only; original samples and upload payloads are never changed. */
export function replayPose(frames: RepTrainingPoseFrame[], timeMs: number) {
  if (!frames.length) return null;
  const end = frames[frames.length - 1]!;
  const time = Math.max(frames[0]!.offsetMs, Math.min(end.offsetMs, timeMs));
  let index = 0;
  while (index < frames.length - 1 && frames[index + 1]!.offsetMs <= time) index++;
  const before = frames[index]!;
  const after = frames[index + 1] ?? before;
  const duration = after.offsetMs - before.offsetMs;
  const fraction = duration > 0 ? (time - before.offsetMs) / duration : 0;
  return {
    index,
    phase: before.phase,
    landmarks: before.landmarks.map((p) => {
      const next = after.landmarks.find((q) => q.index === p.index) ?? p;
      return { ...p, x: p.x + (next.x - p.x) * fraction, y: p.y + (next.y - p.y) * fraction,
        visibility: p.visibility + (next.visibility - p.visibility) * fraction };
    }),
  };
}
