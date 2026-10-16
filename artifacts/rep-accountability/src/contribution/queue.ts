import { useSyncExternalStore } from 'react';
import type { RepTrainingPoseFrame } from '@workspace/api-client-react';

export const MAX_QUEUE = 12;
export type ContribExercise = 'squat' | 'push-up' | 'bicep-curl';
export type Sample = { exercise: ContribExercise; frames: RepTrainingPoseFrame[]; aspectRatio: number; source: 'rep' | 'missed' };
export type QueueItem = Sample & { sessionId: string; trackerVersion: string; id: string; status: 'pending' | 'uploading' | 'error'; error?: string };

// In memory only: samples never survive a page reload or navigation away from the session.
let items: QueueItem[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const getQueue = () => items;
export const isFull = () => items.length >= MAX_QUEUE;

export function enqueue(sample: Sample & Pick<QueueItem, 'sessionId' | 'trackerVersion'>): boolean {
  if (isFull()) return false;
  items = [...items, { ...sample, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: 'pending' }];
  emit();
  return true;
}
export function patchItem(id: string, patch: Partial<QueueItem>) {
  items = items.map((i) => (i.id === id ? { ...i, ...patch } : i)); emit();
}
export function removeItem(id: string) { items = items.filter((i) => i.id !== id); emit(); }
export function clearQueue() { if (items.length) { items = []; emit(); } }
export const useQueue = () => useSyncExternalStore(subscribe, getQueue);
