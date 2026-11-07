import { useSyncExternalStore } from 'react';
import { createStore } from './store.ts';
import { getPoseLog, listPoseLogIds } from './poseLogs.ts';
import type { PoseLog } from '../tracking/replay.ts';

/**
 * Upload pose logs into the GitHub repo (data/sessions/), using a fine-grained
 * personal access token kept on this phone. No server needed: the browser talks
 * to the GitHub API directly. Videos are never uploaded.
 */

export const DEFAULT_REPO = 'Farinnegan/overachiever';
export const SESSIONS_DIR = 'data/sessions';

export type SyncConfig = { token: string; repo: string } | null;
type Status = { busy: boolean; message: string | null; bad: boolean };

const config = createStore<SyncConfig>('overachiever-sync-v1', null, (raw) => {
  const p = raw as { token?: unknown; repo?: unknown } | null;
  return p && typeof p.token === 'string' && p.token && typeof p.repo === 'string' && p.repo ? { token: p.token, repo: p.repo } : null;
});
const uploaded = createStore<string[]>('overachiever-uploaded-v1', [], (raw) =>
  Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
const status = createStore<Status>('overachiever-sync-status-v1', { busy: false, message: null, bad: false }, (raw) => {
  const p = raw as Partial<Status> | null;
  return { busy: false, message: typeof p?.message === 'string' ? p.message : null, bad: p?.bad === true };
});

export const useSyncConfig = () => useSyncExternalStore(config.subscribe, config.get);
export const useUploadedIds = () => useSyncExternalStore(uploaded.subscribe, uploaded.get);
export const useSyncStatus = () => useSyncExternalStore(status.subscribe, status.get);
export const isSyncConfigured = () => config.get() !== null;

function api(cfg: NonNullable<SyncConfig>, path: string, init?: RequestInit) {
  return fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${cfg.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}

function explain(res: Response): string {
  if (res.status === 401) return 'GitHub rejected the token (401). It may be mistyped or expired. Make a new one in Settings.';
  if (res.status === 403 || res.status === 404) return `The token can’t write to this repo (${res.status}). Make sure it includes this repository with Contents: Read and write.`;
  return `GitHub answered ${res.status}. It will try again.`;
}

/** UTF-8 safe base64, chunked so long sessions don't overflow the call stack. */
export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** e.g. data/sessions/2026-10-26_1302_push-up_1793001234567.json (phone's local time) */
export function logPath(log: PoseLog): string {
  const d = new Date(log.startedAt);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${SESSIONS_DIR}/${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}_${log.exercise}_${log.id}.json`;
}

async function uploadOnce(cfg: NonNullable<SyncConfig>, log: PoseLog): Promise<{ error: string | null; retry: boolean }> {
  const content = toBase64(JSON.stringify({ format: 'overachiever-pose-log-v1', ...log }));
  const message = `Pose data: ${log.exercise}, ${log.actualReps ?? '?'} reps (camera counted ${log.countedReps})`;
  const res = await api(cfg, `/contents/${logPath(log)}`, { method: 'PUT', body: JSON.stringify({ message, content }) });
  if (res.ok) return { error: null, retry: false };
  if (res.status === 422) {
    // Already uploaded (GitHub wants a sha to overwrite an existing file).
    const body = await res.json().catch(() => ({})) as { message?: string };
    if (/sha/i.test(body.message ?? '')) return { error: null, retry: false };
  }
  // 409 means another write to the repo landed at the same moment; 5xx is GitHub having a moment.
  return { error: explain(res), retry: res.status === 409 || res.status >= 500 };
}

async function uploadOne(cfg: NonNullable<SyncConfig>, log: PoseLog): Promise<string | null> {
  let last: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1000 * attempt));
    const r = await uploadOnce(cfg, log);
    if (!r.error) return null;
    last = r.error;
    if (!r.retry) break;
  }
  return last;
}

/** One pass over everything saved but not uploaded yet. Returns false if it hit a problem. */
async function uploadRound(): Promise<boolean> {
  const cfg = config.get();
  if (!cfg) return true;
  try {
    const done = new Set(uploaded.get());
    // Ids are the start time in ms, so sorting numerically uploads the oldest first.
    const pending = (await listPoseLogIds()).filter((id) => !done.has(id)).sort((a, b) => Number(a) - Number(b));
    if (!pending.length) return true;
    status.set({ busy: true, message: `Uploading ${pending.length} session${pending.length === 1 ? '' : 's'}…`, bad: false });
    let n = 0;
    for (const id of pending) {
      const log = await getPoseLog(id);
      if (!log) continue; // deleted in the meantime
      const err = await uploadOne(cfg, log);
      if (err) { status.set({ busy: false, message: err, bad: true }); return false; }
      uploaded.set((ids) => [...ids, id]);
      n++;
    }
    status.set({ busy: false, message: `Uploaded ${n} session${n === 1 ? '' : 's'} to GitHub.`, bad: false });
    return true;
  } catch {
    status.set({ busy: false, message: 'Couldn’t reach GitHub. It will try again when you’re back online.', bad: true });
    return false;
  }
}

let running: Promise<void> | null = null;
let again = false;

/**
 * Upload every saved pose log that isn't on GitHub yet. Safe to call any time. If it is called
 * while an upload is already running (say, right after saving a new session), the running one
 * does another pass when it finishes, so the new session isn't left behind.
 */
export function uploadPending(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    let ok = true;
    do { again = false; ok = await uploadRound(); } while (again && ok);
  })().finally(() => { running = null; });
  return running;
}

let watching = false;

/** Retry on its own when the phone comes back online, the app is reopened, and once a minute. */
export function startSyncWatchers() {
  if (watching) return;
  watching = true;
  const retry = () => { if (config.get()) void uploadPending(); };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') retry(); });
  window.setInterval(retry, 60_000);
  retry();
}

/** Check the token can see the repo, save it, and upload anything waiting. Returns an error or null. */
export async function connect(token: string, repo: string): Promise<string | null> {
  const cfg = { token: token.trim(), repo: repo.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '') };
  if (!cfg.token) return 'Paste the token first.';
  if (!/^[\w.-]+\/[\w.-]+$/.test(cfg.repo)) return 'Repo should look like owner/name.';
  try {
    const res = await api(cfg, '');
    if (!res.ok) return explain(res);
  } catch {
    return 'Couldn’t reach GitHub. Check your connection.';
  }
  config.set(cfg);
  status.set({ busy: false, message: 'Connected.', bad: false });
  void uploadPending();
  return null;
}

export function disconnect() {
  config.set(null);
  status.set({ busy: false, message: null, bad: false });
}
