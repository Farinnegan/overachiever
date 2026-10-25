import { useSyncExternalStore } from 'react';
import type { Exercise } from '../tracking/types.ts';

/** A tiny localStorage-backed store that React components can subscribe to. */
function createStore<T>(key: string, fallback: T, parse: (raw: unknown) => T) {
  const listeners = new Set<() => void>();
  let state: T = fallback;
  try { state = parse(JSON.parse(localStorage.getItem(key) || 'null')); } catch { /* use fallback */ }
  return {
    get: () => state,
    set(next: T | ((current: T) => T)) {
      state = typeof next === 'function' ? (next as (c: T) => T)(state) : next;
      try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage full or blocked: keep in memory */ }
      listeners.forEach((l) => l());
    },
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
  };
}

// ---------- Workout history ----------

/** 'bicep-curl' only exists in old history from the first version of the app. */
export type HistoryExercise = Exercise | 'bicep-curl';
export type WorkoutSession = {
  id: string;
  exercise: HistoryExercise;
  /** Reps you say you did (defaults to what the camera counted). */
  reps: number;
  /** What the camera counted, when different. */
  countedReps?: number;
  startedAt: string;
  durationSeconds: number;
};
export type AppData = { sessions: WorkoutSession[]; weeklyWorkoutGoal: number };

const KNOWN: HistoryExercise[] = ['squat', 'push-up', 'side-leg-raise', 'bicep-curl'];

export function parseAppData(raw: unknown): AppData {
  const p = (raw ?? {}) as Partial<AppData>;
  const sessions = Array.isArray(p.sessions) ? p.sessions.filter((s): s is WorkoutSession =>
    !!s && typeof s.id === 'string' && KNOWN.includes(s.exercise) && Number.isFinite(s.reps) && typeof s.startedAt === 'string') : [];
  const goal = Number(p.weeklyWorkoutGoal);
  return { sessions, weeklyWorkoutGoal: Number.isFinite(goal) ? Math.max(1, Math.min(7, Math.round(goal))) : 3 };
}

// Same key as the Replit version, so the data format stays compatible with exports from it.
export const appData = createStore<AppData>('rep-accountability-v1', { sessions: [], weeklyWorkoutGoal: 3 }, parseAppData);
export const useAppData = () => useSyncExternalStore(appData.subscribe, appData.get);

export const saveSession = (s: WorkoutSession) => appData.set((d) => ({ ...d, sessions: [s, ...d.sessions] }));
export const setGoal = (weeklyWorkoutGoal: number) => appData.set((d) => ({ ...d, weeklyWorkoutGoal }));
export const clearSessions = () => appData.set((d) => ({ ...d, sessions: [] }));

/** Merge imported history, skipping sessions already present. Returns how many were added. */
export function importAppData(raw: unknown): number {
  const incoming = parseAppData(raw);
  let added = 0;
  appData.set((d) => {
    const ids = new Set(d.sessions.map((s) => s.id));
    const fresh = incoming.sessions.filter((s) => !ids.has(s.id));
    added = fresh.length;
    return { ...d, sessions: [...d.sessions, ...fresh].sort((a, b) => b.startedAt.localeCompare(a.startedAt)) };
  });
  return added;
}

// ---------- Settings ----------

export type RepSound = 'voice' | 'beep' | 'off';
export type Settings = { keepPoseData: boolean; repSound: RepSound; showTracking: boolean };

export const settings = createStore<Settings>('overachiever-settings-v1', { keepPoseData: true, repSound: 'voice', showTracking: true }, (raw) => {
  const p = (raw ?? {}) as Partial<Settings>;
  return {
    keepPoseData: p.keepPoseData !== false,
    repSound: p.repSound === 'beep' || p.repSound === 'off' ? p.repSound : 'voice',
    showTracking: p.showTracking !== false,
  };
});
export const useSettings = () => useSyncExternalStore(settings.subscribe, settings.get);
export const updateSettings = (patch: Partial<Settings>) => settings.set((s) => ({ ...s, ...patch }));

// ---------- Helpers ----------

export function downloadJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
