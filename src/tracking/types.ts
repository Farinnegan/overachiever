/** One MediaPipe pose landmark. x and y are 0..1 of the video frame. */
export type Point = { x: number; y: number; z?: number; visibility?: number };

export type Exercise = 'squat' | 'push-up' | 'side-leg-raise';

export const EXERCISE_IDS: Exercise[] = ['squat', 'push-up', 'side-leg-raise'];

/** MediaPipe pose landmark indices used by the app. */
export const LM = {
  nose: 0,
  leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16,
  leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26,
  leftAnkle: 27, rightAnkle: 28,
} as const;
