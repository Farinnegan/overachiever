/**
 * Replay saved pose data through the current trackers and compare with what you actually did.
 *
 *   npm run replay -- overachiever-pose-logs-2026-10-25.json
 *   npm run replay                      (defaults to data/training/rep_training_examples.json)
 *
 * Workflow for improving counting: export pose data from the app's Settings page,
 * change a threshold in src/tracking/exercises.ts, run this, and keep the change
 * only if more sessions match the actual count.
 */
import { readFileSync } from 'node:fs';
import { fromLegacyRecord, fromPoseLog, replayCount, type LegacyRecord, type PoseLog } from '../src/tracking/replay.ts';
import { EXERCISE_IDS, type Exercise } from '../src/tracking/types.ts';

const file = process.argv[2] ?? 'data/training/rep_training_examples.json';
const json = JSON.parse(readFileSync(file, 'utf8'));

type Row = { id: string; exercise: string; counted: number; actual: number | null; note: string };
const rows: Row[] = [];

if (Array.isArray(json.logs)) {
  for (const log of json.logs as PoseLog[]) {
    const { counted } = replayCount(log.exercise, fromPoseLog(log), log.aspect);
    rows.push({ id: log.startedAt.slice(0, 16), exercise: log.exercise, counted, actual: log.actualReps, note: `saved count ${log.countedReps}, ${log.placement}` });
  }
} else if (Array.isArray(json.records)) {
  for (const r of json.records as LegacyRecord[]) {
    if (!EXERCISE_IDS.includes(r.exercise as Exercise)) continue;
    const { counted } = replayCount(r.exercise as Exercise, fromLegacyRecord(r), r.aspectRatio);
    rows.push({ id: r.recordId, exercise: r.exercise, counted, actual: null, note: `${r.source} rep, labelled ${r.label}` });
  }
} else {
  console.error('Not a pose-log export or legacy training file.');
  process.exit(1);
}

const pad = (s: string, n: number) => s.padEnd(n);
console.log(pad('session', 18), pad('exercise', 15), pad('counted', 8), pad('actual', 7), 'note');
for (const r of rows) {
  const mark = r.actual === null ? ' ' : r.actual === r.counted ? '✓' : '✗';
  console.log(pad(r.id, 18), pad(r.exercise, 15), pad(String(r.counted), 8), pad(r.actual === null ? '-' : String(r.actual), 7), `${mark} ${r.note}`);
}
const judged = rows.filter((r) => r.actual !== null);
if (judged.length) {
  const exact = judged.filter((r) => r.actual === r.counted).length;
  const off = judged.reduce((s, r) => s + Math.abs(r.counted - r.actual!), 0);
  console.log(`\n${exact}/${judged.length} sessions exact · ${off} reps off in total`);
}
