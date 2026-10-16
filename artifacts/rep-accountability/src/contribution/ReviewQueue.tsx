import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Flag, Trash2 } from 'lucide-react';
import { getListRepTrainingExamplesQueryKey, useCreateRepTrainingExample } from '@workspace/api-client-react';
import { contributorRequest, errorMessage, useConsent } from './consent';
import { MAX_QUEUE, type QueueItem, patchItem, removeItem, useQueue } from './queue';
import { PoseReplay } from './PoseReplay';

type Props = { canFlag: boolean; onFlagMissed: () => string | null };

export function ReviewQueue({ canFlag, onFlagMissed }: Props) {
  const consent = useConsent();
  const queue = useQueue();
  const qc = useQueryClient();
  const create = useCreateRepTrainingExample({ request: contributorRequest(consent.token) });
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmWrongId, setConfirmWrongId] = useState<string | null>(null);
  const [actualCounts, setActualCounts] = useState<Record<string, string>>({});

  const upload = async (item: QueueItem, label: 'correct' | 'incorrect') => {
    if (!consent.enabled || !consent.token) return;
    const rawCount = item.source === 'rep' && label === 'correct' ? '1' : (actualCounts[item.id] ?? '');
    const expectedCount = Number(rawCount);
    if (!/^\d+$/.test(rawCount) || !Number.isInteger(expectedCount) ||
      expectedCount < (item.source === 'missed' ? 1 : 0) || expectedCount > 20 ||
      (item.source === 'rep' && ((label === 'correct' && expectedCount !== 1) || (label === 'incorrect' && expectedCount !== 0)))) {
      setNotice({ kind: 'err', text: item.source === 'missed'
        ? 'Enter how many reps were actually in this missed-rep clip (1–20).'
        : 'This sample contains one counted cycle: confirm 1 rep as correct, or enter 0 for a false count.' });
      return;
    }
    patchItem(item.id, { status: 'uploading', error: undefined });
    setNotice(null);
    try {
      const receipt = await create.mutateAsync({ data: { exercise: item.exercise, label, source: item.source === 'missed' ? 'missed' : 'counted', consent: true, aspectRatio: item.aspectRatio, frames: item.frames, sessionId: item.sessionId, expectedCount, trackerVersion: item.trackerVersion } });
      if (!receipt.accepted) throw new Error('The server did not accept this sample.');
      removeItem(item.id);
      setConfirmWrongId(null);
      setNotice({ kind: 'ok', text: item.source === 'missed' ? 'Shared a missed-rep report. Joint coordinates only.' : label === 'correct' ? 'Shared a correctly counted rep. Joint coordinates only.' : 'Shared an incorrect count. Joint coordinates only.' });
      void qc.invalidateQueries({ queryKey: getListRepTrainingExamplesQueryKey() });
    } catch (e) {
      const msg = errorMessage(e);
      patchItem(item.id, { status: 'error', error: msg });
      setNotice({ kind: 'err', text: msg });
    }
  };

  if (!consent.enabled) {
    return <div className="panel" style={{ padding: 17, marginTop: 13 }} data-testid="panel-contribution-off">
      <div className="small-label">TRAINING DATA · OFF</div>
      <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, margin: '8px 0 12px' }}>No pose samples are saved or shared. You can choose to share labeled joint-coordinate samples from Settings.</p>
      <Link href="/settings" className="secondary-btn" data-testid="link-contribution-settings">Review the option</Link>
    </div>;
  }
  const full = queue.length >= MAX_QUEUE;
  const flag = () => { const err = onFlagMissed(); setNotice(err ? { kind: 'err', text: err } : null); };
  return <div className="panel" style={{ padding: 17, marginTop: 13 }} data-testid="panel-review-queue">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div><div className="small-label">TRAINING DATA · ON</div>
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 5 }} data-testid="text-queue-count">{queue.length} of {MAX_QUEUE} waiting for a label</div></div>
      <button className="secondary-btn" onClick={flag} disabled={!canFlag || full} data-testid="button-flag-missed"><Flag size={14} /> Flag a missed rep</button>
    </div>
    <p className="subtle" style={{ fontSize: 11, lineHeight: 1.6, margin: '9px 0 0' }}>Replay a counted rep, then tag whether the count was correct or wrong. If you completed a rep but nothing counted, flag it immediately and confirm the missed rep. These labels judge counting accuracy, not exercise form. Nothing uploads until you choose to share.</p>
    {full && <div role="status" data-testid="status-queue-full" style={{ marginTop: 10, padding: '10px 12px', borderLeft: '3px solid var(--brand-orange)', fontSize: 12 }}>Sample collection is paused. Label or discard a sample to resume.</div>}
    {notice && <div role={notice.kind === 'err' ? 'alert' : 'status'} data-testid={`status-upload-${notice.kind}`} style={{ marginTop: 10, padding: '10px 12px', borderRadius: 10, fontSize: 12, background: notice.kind === 'err' ? 'var(--brand-orange)' : 'var(--brand-lime)', border: '1px solid var(--brand-black)' }}>{notice.text}</div>}
    {queue.length === 0 ? <div className="subtle" style={{ fontSize: 12, marginTop: 12 }} data-testid="empty-queue">No samples yet. Complete a rep and it will appear here.</div> :
      <div style={{ display: 'grid', gap: 9, marginTop: 12 }}>{queue.map((item, i) => {
        const span = item.frames[item.frames.length - 1]!.offsetMs;
        const busy = item.status === 'uploading';
        return <div key={item.id} data-testid={`row-sample-${item.id}`} style={{ border: '1px solid rgba(0,0,0,.2)', borderRadius: 12, padding: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 800 }}>#{i + 1} · {item.exercise === 'squat' ? 'Squat' : item.exercise === 'push-up' ? 'Push-up' : 'Bicep curl'} · {item.source === 'missed' ? 'flagged missed rep' : 'counted rep'}</div>
          <div className="subtle mono-value" style={{ fontSize: 10, marginTop: 4 }}>{item.frames.length} frames · {(span / 1000).toFixed(1)}s</div>
          <PoseReplay sample={item} sampleId={item.id} />
          <label style={{ display: 'grid', gap: 4, maxWidth: 280, fontSize: 10, fontWeight: 700, marginTop: 9 }}>
            {item.source === 'missed' ? 'How many reps were actually in this clip? (1–20)' : 'Actual reps in this single counted cycle (0 or 1)'}
            <input aria-label={`Actual reps in sample ${i + 1}`} className="field" type="number" min={item.source === 'missed' ? 1 : 0} max={item.source === 'missed' ? 20 : 1} step={1}
              value={item.source === 'rep' ? (actualCounts[item.id] ?? '1') : (actualCounts[item.id] ?? '')}
              onChange={(e) => setActualCounts((current) => ({ ...current, [item.id]: e.target.value }))}
              disabled={busy} />
          </label>
          {item.source === 'rep' && <div className="subtle" style={{ fontSize: 10, marginTop: 4 }}>“Count was correct” confirms exactly 1. For an incorrect count, enter the actual number in this clip.</div>}
          {item.error && <div role="alert" data-testid={`error-sample-${item.id}`} style={{ fontSize: 11, marginTop: 6 }}>Upload failed: {item.error} Tap share or confirm to retry.</div>}
          <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="primary-btn" disabled={busy} onClick={() => void upload(item, item.source === 'missed' ? 'incorrect' : 'correct')} data-testid={`${item.source === 'missed' ? 'button-confirm-missed' : 'button-share-reference'}-${item.id}`} style={{ padding: '9px 12px', fontSize: 11 }}><Check size={13} /> {item.source === 'missed' ? 'Confirm missed rep' : 'Count was correct'}</button>
            {item.source !== 'missed' && <button className="secondary-btn" disabled={busy} onClick={() => setConfirmWrongId(item.id)} data-testid={`button-count-wrong-${item.id}`} style={{ padding: '9px 12px', fontSize: 11, background: 'var(--brand-orange)' }}>Count was wrong</button>}
            <button className="secondary-btn" disabled={busy} onClick={() => removeItem(item.id)} data-testid={`button-discard-${item.id}`}><Trash2 size={13} /> {busy ? 'Sending…' : 'Discard'}</button>
          </div>
          {confirmWrongId === item.id && item.source !== 'missed' && <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--brand-orange)', borderRadius: 10, fontSize: 12 }} data-testid={`confirm-count-wrong-${item.id}`}>
            Enter the actual number of reps in the clip before sharing this incorrect count.
            <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="secondary-btn" disabled={busy} onClick={() => setConfirmWrongId(null)} data-testid={`button-cancel-wrong-${item.id}`}>Cancel</button>
              <button className="secondary-btn" disabled={busy} onClick={() => void upload(item, 'incorrect')} data-testid={`button-confirm-wrong-${item.id}`} style={{ background: 'var(--brand-orange)' }}>{busy ? 'Sending…' : 'Share incorrect count'}</button>
            </div>
          </div>}
        </div>;
      })}</div>}
  </div>;
}
