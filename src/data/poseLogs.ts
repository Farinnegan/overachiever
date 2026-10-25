import { useEffect, useState } from 'react';
import type { PoseLog } from '../tracking/replay.ts';
import type { Exercise, Point } from '../tracking/types.ts';

/**
 * Pose logs: the joint coordinates from a workout, kept on this phone in IndexedDB
 * (localStorage is too small). Export them from Settings and replay them with
 * `npm run replay -- file.json` to check tracker changes against real sessions.
 * No video or images, just numbers.
 */

/** Face (nose), arms, hips, knees, ankles: everything any tracker reads. */
export const LOG_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const FRAME_MS = 100; // 10 frames per second
const MAX_FRAMES = 6000; // 10 minutes
const MAX_LOGS = 30;

export class PoseLogger {
  private frames: PoseLog['frames'] = [];
  private flags: number[] = [];
  private start = 0;
  private lastT = -Infinity;

  begin(now: number) { this.frames = []; this.flags = []; this.start = now; this.lastT = -Infinity; }

  add(points: Point[] | undefined, now: number) {
    if (!points || now - this.lastT < FRAME_MS || this.frames.length >= MAX_FRAMES) return;
    this.lastT = now;
    const p: number[] = [];
    for (const i of LOG_JOINTS) {
      const pt = points[i];
      p.push(r3(pt?.x ?? 0), r3(pt?.y ?? 0), r3(pt?.visibility ?? 0));
    }
    this.frames.push({ t: Math.round(now - this.start), p });
  }

  flagMissed(now: number) { this.flags.push(Math.round(now - this.start)); }
  get flagCount() { return this.flags.length; }
  get frameCount() { return this.frames.length; }

  build(meta: Omit<PoseLog, 'joints' | 'frames' | 'missedFlags'>): PoseLog {
    return { ...meta, joints: LOG_JOINTS, frames: this.frames, missedFlags: this.flags };
  }
}
const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ---------- IndexedDB ----------

const DB = 'overachiever';
const STORE = 'poseLogs';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((resolve, reject) => {
    const req = run(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export async function listPoseLogs(): Promise<PoseLog[]> {
  const all = await tx<PoseLog[]>('readonly', (s) => s.getAll());
  return all.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function savePoseLog(log: PoseLog) {
  await tx('readwrite', (s) => s.put(log));
  const all = await listPoseLogs();
  for (const old of all.slice(MAX_LOGS)) await tx('readwrite', (s) => s.delete(old.id));
  changed();
}

export async function clearPoseLogs() {
  await tx('readwrite', (s) => s.clear());
  changed();
}

/** Summary of saved logs for the Settings page. */
export function usePoseLogSummary() {
  const [summary, setSummary] = useState<{ count: number; byExercise: Partial<Record<Exercise, number>> } | null>(null);
  useEffect(() => {
    const load = () => listPoseLogs()
      .then((logs) => {
        const byExercise: Partial<Record<Exercise, number>> = {};
        for (const l of logs) byExercise[l.exercise] = (byExercise[l.exercise] ?? 0) + 1;
        setSummary({ count: logs.length, byExercise });
      })
      .catch(() => setSummary({ count: 0, byExercise: {} }));
    load();
    listeners.add(load);
    return () => { listeners.delete(load); };
  }, []);
  return summary;
}
