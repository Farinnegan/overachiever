import { clamp, median, percentile } from './geometry.ts';

/**
 * How one exercise's movement signal behaves.
 *
 * Every exercise is reduced to a single number per frame (a joint angle or a
 * body-proportion ratio). The counter learns your personal starting value
 * ("rest") by watching you hold still, then counts one rep each time the value
 * moves far enough away from rest and comes back.
 */
export type CounterConfig = {
  /** Which way the value moves during a rep: 'down' (it shrinks) or 'up' (it grows). */
  direction: 'down' | 'up';
  /** 'degrees': trigger/release are absolute amounts. 'ratio': they are fractions of rest. */
  scale: 'degrees' | 'ratio';
  /** How far from rest counts as the bottom of the rep. */
  trigger: number;
  /** How close to rest counts as back at the start. */
  release: number;
  /** How much the value may wobble while you hold still to calibrate (same scale as trigger). */
  stableTolerance: number;
  /** Is this a believable starting position? e.g. a squat must start roughly standing. */
  isValidRest: (rest: number) => boolean;
  holdMs?: number;
  cooldownMs?: number;
  calibrateMs?: number;
  restWindowMs?: number;
  lostResetMs?: number;
};

export type CounterStatus =
  | 'searching' // body not visible enough
  | 'position' // visible, but not in a believable starting position
  | 'calibrating' // in position, holding still to learn rest
  | 'ready'
  | 'moving'
  | 'bottom'
  | 'returning';

export type CounterOutput = {
  counted: boolean;
  status: CounterStatus;
  value: number | null;
  rest: number | null;
  /** Value at which the bottom of a rep is reached. */
  bottomLine: number | null;
  /** Value at which you are considered back at the start. */
  releaseLine: number | null;
  /** 0 at rest, 1 at the bottom line. */
  progress: number;
};

const DEFAULTS = { holdMs: 100, cooldownMs: 450, calibrateMs: 500, restWindowMs: 4000, lostResetMs: 1500 };

export class CycleCounter {
  private cfg: Required<CounterConfig>;
  private raw: number[] = [];
  private smooth: number | null = null;
  private window: { t: number; v: number }[] = [];
  private rest: number | null = null;
  private calibrated = false;
  private stage: 'up' | 'down' = 'up';
  private holdSince: number | null = null;
  private lastSeen = -Infinity;
  private lastRepAt = -Infinity;

  constructor(config: CounterConfig) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  reset() {
    this.raw = [];
    this.smooth = null;
    this.window = [];
    this.rest = null;
    this.calibrated = false;
    this.stage = 'up';
    this.holdSince = null;
    this.lastSeen = -Infinity;
  }

  private amount(n: number, rest: number) {
    return this.cfg.scale === 'ratio' ? n * Math.abs(rest) : n;
  }

  update(value: number | null, now: number): CounterOutput {
    const c = this.cfg;
    if (value === null || !Number.isFinite(value)) {
      if (now - this.lastSeen > c.lostResetMs) this.reset();
      return this.output(false, 'searching', null);
    }
    if (now - this.lastSeen > c.lostResetMs) this.reset();
    this.lastSeen = now;

    // Light smoothing: median of the last 3 readings, then an exponential average.
    this.raw.push(value);
    if (this.raw.length > 3) this.raw.shift();
    const m = median(this.raw);
    this.smooth = this.smooth === null ? m : this.smooth + 0.6 * (m - this.smooth);
    const v = this.smooth;

    if (this.stage === 'up') {
      this.window.push({ t: now, v });
      while (this.window.length > 1 && now - this.window[0]!.t > c.restWindowMs) this.window.shift();
    }

    if (!this.calibrated) {
      const recent = this.window.filter((s) => now - s.t <= c.calibrateMs);
      const values = recent.map((s) => s.v);
      const center = median(values);
      if (!c.isValidRest(center)) {
        this.rest = null;
        return this.output(false, 'position', v);
      }
      const spread = Math.max(...values) - Math.min(...values);
      const span = now - recent[0]!.t;
      if (spread > this.amount(c.stableTolerance, center) || span < c.calibrateMs * 0.8) {
        this.rest = null;
        return this.output(false, 'calibrating', v);
      }
      this.calibrated = true;
      this.window = recent;
      this.rest = center;
      return this.output(false, 'ready', v);
    }

    if (this.stage === 'up') {
      this.rest = percentile(this.window.map((s) => s.v), c.direction === 'down' ? 0.85 : 0.15);
      if (!c.isValidRest(this.rest)) {
        // You left the starting position (stood up, sat down, walked away). Learn it again.
        this.calibrated = false;
        this.window = this.window.filter((s) => now - s.t <= c.calibrateMs);
        this.rest = null;
        return this.output(false, 'position', v);
      }
    }

    const rest = this.rest!;
    const dir = c.direction === 'down' ? 1 : -1;
    const dev = (rest - v) * dir; // positive = moving into the rep
    const trigger = this.amount(c.trigger, rest);
    const release = this.amount(c.release, rest);

    if (this.stage === 'up') {
      if (dev >= trigger) {
        this.holdSince ??= now;
        if (now - this.holdSince >= c.holdMs) {
          this.stage = 'down';
          this.holdSince = null;
        }
        return this.output(false, 'bottom', v);
      }
      this.holdSince = null;
      return this.output(false, dev > release ? 'moving' : 'ready', v);
    }

    if (dev <= release) {
      this.holdSince ??= now;
      if (now - this.holdSince >= c.holdMs && now - this.lastRepAt >= c.cooldownMs) {
        this.stage = 'up';
        this.holdSince = null;
        this.lastRepAt = now;
        return this.output(true, 'ready', v);
      }
      return this.output(false, 'returning', v);
    }
    this.holdSince = null;
    return this.output(false, dev >= trigger ? 'bottom' : 'returning', v);
  }

  private output(counted: boolean, status: CounterStatus, value: number | null): CounterOutput {
    const rest = this.rest;
    if (rest === null || value === null) {
      return { counted, status, value, rest: null, bottomLine: null, releaseLine: null, progress: 0 };
    }
    const dir = this.cfg.direction === 'down' ? 1 : -1;
    const trigger = this.amount(this.cfg.trigger, rest);
    const release = this.amount(this.cfg.release, rest);
    return {
      counted,
      status,
      value,
      rest,
      bottomLine: rest - dir * trigger,
      releaseLine: rest - dir * release,
      progress: clamp(((rest - value) * dir) / trigger, 0, 1),
    };
  }
}
