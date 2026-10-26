/**
 * Replay saved pose data through the current trackers and compare with what you actually did.
 *
 *   npm run replay                         every uploaded session in data/sessions/
 *   npm run replay -- data/sessions/2026-10-26_1302_side-leg-raise_123.json --trace
 *   npm run replay -- overachiever-pose-logs-2026-10-25.json     (Settings export)
 *   npm run replay -- data/training/rep_training_examples.json   (old Replit samples)
 *
 * --trace prints the tracked value and counter state over time, to see why reps were missed.
 *
 * Workflow: change a threshold in src/tracking/exercises.ts, run this, and keep the change
 * only if more sessions match the actual count.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createTracker, EXERCISES } from '../src/tracking/exercises.ts';
import { fromLegacyRecord, fromPoseLog, type LegacyRecord, type PoseLog, type ReplayFrame } from '../src/tracking/replay.ts';
import { EXERCISE_IDS, type Exercise } from '../src/tracking/types.ts';

const args = process.argv.slice(2);
const trace = args.includes('--trace');
const target = args.find((a) => !a.startsWith('--')) ?? 'data/sessions';

type Item = { id: string; exercise: Exercise; frames: ReplayFrame[]; aspect: number; actual: number | null; note: string };

function load(path: string): Item[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path).filter((f) => f.endsWith('.json')).sort().flatMap((f) => load(join(path, f)));
  }
  const json = JSON.parse(readFileSync(path, 'utf8'));
  const fromLog = (log: PoseLog): Item => ({
    id: log.startedAt.slice(0, 16).replace('T', ' '), exercise: log.exercise, frames: fromPoseLog(log), aspect: log.aspect,
    actual: log.actualReps, note: `app counted ${log.countedReps} (${log.trackerVersion}), phone ${log.placement}, ${log.frames.length} frames${log.missedFlags.length ? `, ${log.missedFlags.length} missed flags` : ''}`,
  });
  if (Array.isArray(json.frames) && Array.isArray(json.joints)) return [fromLog(json as PoseLog)];
  if (Array.isArray(json.logs)) return (json.logs as PoseLog[]).map(fromLog);
  if (Array.isArray(json.records)) {
    return (json.records as LegacyRecord[]).filter((r) => EXERCISE_IDS.includes(r.exercise as Exercise)).map((r) => ({
      id: r.recordId, exercise: r.exercise as Exercise, frames: fromLegacyRecord(r), aspect: r.aspectRatio,
      actual: null, note: `${r.source} rep, labelled ${r.label}`,
    }));
  }
  console.error(`Skipping ${path}: not a pose log.`);
  return [];
}

if (!existsSync(target)) {
  console.error(`${target} not found. Pull the latest data first: git pull`);
  process.exit(1);
}
const items = load(target);
const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad('session', 18), pad('exercise', 15), pad('counted', 8), pad('actual', 7), 'note');

let judged = 0, exact = 0, off = 0;
for (const item of items) {
  const def = EXERCISES[item.exercise];
  const tracker = createTracker(item.exercise);
  let counted = 0;
  const lines: string[] = [];
  let last = '';
  for (const f of item.frames) {
    const o = tracker.update(f.points, item.aspect, f.t);
    if (o.counted) counted++;
    if (trace) {
      const v = o.value === null ? '–' : def.format(o.value);
      const r = o.rest === null ? '' : ` start ${def.format(o.rest)} bottom ${o.bottomLine === null ? '–' : def.format(o.bottomLine)}`;
      const key = `${o.status}${o.counted}`;
      if (key !== last || f.t % 1000 < 100) lines.push(`  ${(f.t / 1000).toFixed(1).padStart(6)}s  ${pad(o.status, 11)} ${pad(v, 6)}${r}${o.counted ? `   ← rep ${counted}` : ''}`);
      last = key;
    }
  }
  const mark = item.actual === null ? ' ' : item.actual === counted ? '✓' : '✗';
  console.log(pad(item.id, 18), pad(item.exercise, 15), pad(String(counted), 8), pad(item.actual === null ? '-' : String(item.actual), 7), `${mark} ${item.note}`);
  if (trace) console.log(lines.join('\n') + '\n');
  if (item.actual !== null) { judged++; if (item.actual === counted) exact++; off += Math.abs(item.actual - counted); }
}
if (judged) console.log(`\n${exact}/${judged} sessions exact · ${off} reps off in total`);
