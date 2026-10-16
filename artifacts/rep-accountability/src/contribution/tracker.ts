import { useSyncExternalStore } from "react";
import { BASELINE_RULES, BASELINE_VERSION, type Rules } from "@workspace/rep-tracker";

const STORAGE_KEY = "rep-accountability-active-tracker-v1";
type ActiveTracker = { version: string; rules: Rules };
const listeners = new Set<() => void>();
let current = { version: BASELINE_VERSION, rules: BASELINE_RULES };
let initialized = false;

function readStored(): ActiveTracker | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as Partial<ActiveTracker> | null;
    if (!value || typeof value.version !== "string" || !value.rules) return null;
    for (const exercise of ["squat", "bicep-curl", "push-up"] as const) {
      const rule = value.rules[exercise];
      if (!rule || !Number.isFinite(rule.extended) || !Number.isFinite(rule.bent) ||
        !Number.isFinite(rule.visibility) || !Number.isFinite(rule.cooldownMs)) return null;
    }
    return value as ActiveTracker;
  } catch { return null; }
}

export function getActiveTracker(): ActiveTracker {
  if (!initialized) {
    current = readStored() ?? current;
    initialized = true;
  }
  return current;
}

export function setActiveTracker(version: string, rules: Rules) {
  current = { version, rules };
  initialized = true;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* In-memory inference remains available. */ }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
  if (event.key === STORAGE_KEY) {
    current = readStored() ?? { version: BASELINE_VERSION, rules: BASELINE_RULES };
    initialized = true;
    listeners.forEach(listener => listener());
  }
});
export const useActiveTracker = () => useSyncExternalStore(subscribe, getActiveTracker, () => current);
