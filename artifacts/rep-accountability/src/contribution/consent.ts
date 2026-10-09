import { useSyncExternalStore } from 'react';

const KEY = 'rep-accountability-contribution-v1';
export type ConsentState = { enabled: boolean; token: string | null; videoEnabled: boolean };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function read(): ConsentState {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || 'null') as Partial<ConsentState> | null;
    const ok = typeof p?.token === 'string' && UUID.test(p.token);
    return { enabled: p?.enabled === true && ok, token: ok ? (p!.token as string) : null, videoEnabled: p?.videoEnabled === true };
  } catch { return { enabled: false, token: null, videoEnabled: false }; }
}

function makeUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let state: ConsentState = read();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export const getConsent = () => state;

/** Returns an error message, or null on success. Nothing changes if storage fails. */
export function setContribution(enabled: boolean): string | null {
  try {
    const next: ConsentState = { ...state, enabled, token: state.token ?? (enabled ? makeUuid() : null) };
    localStorage.setItem(KEY, JSON.stringify(next));
    state = next;
    listeners.forEach((l) => l());
    return null;
  } catch {
    return 'This browser would not let us save your choice. Your previous setting is unchanged.';
  }
}

export const useConsent = () => useSyncExternalStore(subscribe, getConsent);

export const contributorRequest = (token: string | null) => ({
  headers: token ? { 'X-Contributor-Token': token } : ({} as Record<string, string>),
});

export function errorMessage(e: unknown): string {
  if (e && typeof e === 'object') {
    const o = e as { status?: number; message?: string };
    if (typeof o.status === 'number') return `The server answered ${o.status}${o.message ? `: ${o.message}` : ''}.`;
    if (o.message) return o.message;
  }
  return 'Request failed. Check your connection and try again.';
}

/** Separate, default-off opt-in for training videos. Never touches pose consent. */
export function setVideoEnabled(videoEnabled: boolean): string | null {
  try {
    const next: ConsentState = { ...state, videoEnabled };
    localStorage.setItem(KEY, JSON.stringify(next));
    state = next;
    listeners.forEach((l) => l());
    return null;
  } catch {
    return 'This browser would not let us save your choice. Your previous setting is unchanged.';
  }
}
