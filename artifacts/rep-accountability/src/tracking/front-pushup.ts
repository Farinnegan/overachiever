import type { Point, PosePhase } from './classifier';

type TrackResult = {
  counted: boolean;
  phase: PosePhase;
  text: string;
  confidence: number;
};

type ArmAngle = { degrees: number; visibility: number };

const MIN_JOINT_VISIBILITY = 0.45;
const MIN_FACE_VISIBILITY = 0.25;
const MIN_EXTENDED_ANGLE = 125;
const CALIBRATION_HOLD_MS = 600;
const DOWN_HOLD_MS = 120;
const RETURN_HOLD_MS = 120;
const SMOOTHING_SAMPLES = 5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function toVector(point: Point, aspect: number): [number, number, number] {
  return [point.x * aspect, point.y, (point.z ?? 0) * aspect];
}

function elbowAngle(shoulder: Point, elbow: Point, wrist: Point, aspect: number): number {
  const a = toVector(shoulder, aspect).map((n, i) => n - toVector(elbow, aspect)[i]!);
  const c = toVector(wrist, aspect).map((n, i) => n - toVector(elbow, aspect)[i]!);
  const dot = a.reduce((sum, n, i) => sum + n * c[i]!, 0);
  const lengths = Math.hypot(...a) * Math.hypot(...c);
  if (lengths < 1e-8) return NaN;
  return Math.acos(clamp(dot / lengths, -1, 1)) * 180 / Math.PI;
}

function armMeasurement(points: Point[], aspect: number): ArmAngle | null {
  const sides = [[11, 13, 15], [12, 14, 16]];
  const angles = sides.flatMap(([shoulderIndex, elbowIndex, wristIndex]) => {
    const shoulder = points[shoulderIndex]!;
    const elbow = points[elbowIndex]!;
    const wrist = points[wristIndex]!;
    const joints = [shoulder, elbow, wrist];
    if (joints.some(point => (point.visibility ?? 0) < MIN_JOINT_VISIBILITY)) return [];
    const degrees = elbowAngle(shoulder, elbow, wrist, aspect);
    if (!Number.isFinite(degrees)) return [];
    return [{
      degrees,
      visibility: Math.min(...joints.map(point => point.visibility ?? 0)),
    }];
  });
  if (angles.length === 0) return null;
  return {
    degrees: angles.reduce((sum, item) => sum + item.degrees, 0) / angles.length,
    visibility: angles.reduce((sum, item) => sum + item.visibility, 0) / angles.length,
  };
}

/**
 * Front-facing push-up tracker. It uses the visible face landmark and upper-arm
 * joints only, so a full-body or side-profile pose is not required. The user
 * calibrates their extended-arm angle in a high plank, then reps are an
 * extended → bent → extended cycle.
 */
export class FrontPushupTracker {
  private lastSeen = -Infinity;
  private angleWindow: number[] = [];
  private calibrationStartedAt: number | null = null;
  private calibrationAngles: number[] = [];
  private baseline: number | null = null;
  private stage: 'up' | 'down' | null = null;
  private downStartedAt: number | null = null;
  private returnStartedAt: number | null = null;

  reset() {
    this.lastSeen = -Infinity;
    this.angleWindow = [];
    this.calibrationStartedAt = null;
    this.calibrationAngles = [];
    this.baseline = null;
    this.stage = null;
    this.downStartedAt = null;
    this.returnStartedAt = null;
  }

  update(points: Point[] | undefined, aspect: number, now: number): TrackResult {
    if (now - this.lastSeen > 500) this.reset();

    const faceVisible = points?.length === 33 &&
      (points[0]?.visibility ?? 0) >= MIN_FACE_VISIBILITY;
    const measurement = points?.length === 33 && Number.isFinite(aspect) && aspect > 0
      ? armMeasurement(points, aspect)
      : null;
    if (!faceVisible || !measurement) {
      return {
        counted: false,
        phase: 'unknown',
        text: 'Keep your face, shoulders, elbows, and wrists in view',
        confidence: 0,
      };
    }

    this.lastSeen = now;
    this.angleWindow.push(measurement.degrees);
    if (this.angleWindow.length > SMOOTHING_SAMPLES) this.angleWindow.shift();
    const angle = this.angleWindow.reduce((sum, value) => sum + value, 0) / this.angleWindow.length;
    const confidence = clamp(measurement.visibility, 0, 1);

    if (this.baseline === null) {
      if (angle < MIN_EXTENDED_ANGLE) {
        this.calibrationStartedAt = null;
        this.calibrationAngles = [];
        return {
          counted: false,
          phase: 'unknown',
          text: 'Face the camera and hold a high plank with arms extended to calibrate',
          confidence,
        };
      }
      if (this.calibrationStartedAt === null) this.calibrationStartedAt = now;
      this.calibrationAngles.push(angle);
      if (now - this.calibrationStartedAt < CALIBRATION_HOLD_MS) {
        return {
          counted: false,
          phase: 'unknown',
          text: 'Hold your front-facing high plank to calibrate',
          confidence,
        };
      }
      this.baseline = this.calibrationAngles.reduce((sum, value) => sum + value, 0) / this.calibrationAngles.length;
      this.stage = 'up';
      return { counted: false, phase: 'stand', text: 'Ready · high plank detected', confidence };
    }

    const downThreshold = this.baseline - 25;
    const returnThreshold = this.baseline - 10;

    if (this.stage === 'up') {
      if (angle <= downThreshold) {
        if (this.downStartedAt === null) this.downStartedAt = now;
        if (now - this.downStartedAt >= DOWN_HOLD_MS) {
          this.stage = 'down';
          this.downStartedAt = null;
        }
      } else {
        this.downStartedAt = null;
      }
      return {
        counted: false,
        phase: angle <= downThreshold ? 'lower' : 'stand',
        text: angle <= downThreshold ? 'Lower your chest' : 'High plank · ready',
        confidence,
      };
    }

    if (angle >= returnThreshold) {
      if (this.returnStartedAt === null) this.returnStartedAt = now;
      if (now - this.returnStartedAt >= RETURN_HOLD_MS) {
        this.stage = 'up';
        this.returnStartedAt = null;
        this.downStartedAt = null;
        return { counted: true, phase: 'stand', text: 'Rep counted · high plank', confidence };
      }
      return { counted: false, phase: 'return', text: 'Push back to high plank', confidence };
    }

    this.returnStartedAt = null;
    return {
      counted: false,
      phase: angle <= downThreshold ? 'bottom' : 'return',
      text: angle <= downThreshold ? 'Push back up' : 'Return to high plank',
      confidence,
    };
  }
}
