import type { Point } from '../tracking/types.ts';

export type Landmarker = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: Point[][] };
  close: () => void;
};

const VERSION = '0.10.35'; // keep in sync with @mediapipe/tasks-vision in package.json
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** Load MediaPipe Pose Landmarker. Runs fully on the phone; tries the GPU first, then CPU. */
export async function loadPoseModel(): Promise<Landmarker> {
  const vision = await import('@mediapipe/tasks-vision');
  const fileset = await vision.FilesetResolver.forVisionTasks(WASM);
  const options = {
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    return await vision.PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: MODEL, delegate: 'GPU' } });
  } catch {
    return await vision.PoseLandmarker.createFromOptions(fileset, { ...options, baseOptions: { modelAssetPath: MODEL, delegate: 'CPU' } });
  }
}
