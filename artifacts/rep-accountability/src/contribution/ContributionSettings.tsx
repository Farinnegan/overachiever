import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, HeartHandshake, RotateCcw, Trash2 } from 'lucide-react';
import {
  getListRepTrainingExamplesQueryKey, useDeleteRepTrainingExamples, useListRepTrainingExamples,
} from '@workspace/api-client-react';
import { contributorRequest, errorMessage, setContribution, useConsent } from './consent';
import { clearQueue } from './queue';

export function ContributionSettings() {
  const consent = useConsent();
  const qc = useQueryClient();
  const request = contributorRequest(consent.token);
  const list = useListRepTrainingExamples({ request, query: { enabled: !!consent.token, queryKey: getListRepTrainingExamplesQueryKey() } });
  const del = useDeleteRepTrainingExamples({ request });
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const toggle = () => {
    const next = !consent.enabled;
    const err = setContribution(next);
    if (err) { setMsg({ kind: 'err', text: err }); return; }
    if (!next) clearQueue();
    setMsg({ kind: 'ok', text: next ? 'Contribution is on. Nothing uploads until you label a sample.' : 'Contribution is off. Unlabeled samples were discarded.' });
  };
  const exportJson = () => {
    if (!list.data) return;
    const body = JSON.stringify({ exportedAt: new Date().toISOString(), examples: list.data.examples }, null, 2);
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'rep-training-examples.json'; a.click();
    URL.revokeObjectURL(url);
  };
  const remove = async () => {
    try {
      const r = await del.mutateAsync();
      setConfirming(false);
      setMsg({ kind: 'ok', text: `Deleted ${r.deletedCount} shared sample${r.deletedCount === 1 ? '' : 's'}.` });
      await qc.invalidateQueries({ queryKey: getListRepTrainingExamplesQueryKey() });
    } catch (e) { setMsg({ kind: 'err', text: errorMessage(e) }); }
  };
  const count = list.data?.examples.length ?? 0;

  return <section className="panel" style={{ padding: 21, marginTop: 13 }} data-testid="section-contribution">
    <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 38, height: 38, background: 'var(--brand-lime)', borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0 }}><HeartHandshake size={17} /></div>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Share training data (optional)</div>
        <p className="subtle" style={{ fontSize: 12, lineHeight: 1.65, margin: '7px 0 12px' }}>Off by default. When on, replay six joint coordinates and tag counted reps as correct or wrong, or flag and confirm a missed rep. These labels describe counting accuracy, not exercise form. Coordinates, visibility, movement phase, exercise, camera aspect ratio and your label are stored on the server only after you share. No video, images, audio or face landmarks are included here; training videos are a separate opt-in. Shared samples form a dataset for future analysis and training. Nothing retrains automatically.</p>
        <button role="switch" aria-checked={consent.enabled} onClick={toggle} className={consent.enabled ? 'primary-btn' : 'secondary-btn'} data-testid="switch-contribution">{consent.enabled ? 'On · tap to turn off' : 'Off · tap to turn on'}</button>
        {msg && <div role={msg.kind === 'err' ? 'alert' : 'status'} data-testid={`status-contribution-${msg.kind}`} style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 12, border: '1px solid var(--brand-black)', background: msg.kind === 'err' ? 'var(--brand-orange)' : 'var(--brand-lime)' }}>{msg.text}</div>}

        {consent.token && <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,.14)' }}>
          <div className="small-label">SAMPLES YOU HAVE SHARED</div>
          {list.isLoading ? <div className="subtle" style={{ fontSize: 12, marginTop: 8 }} data-testid="status-samples-loading">Loading…</div> :
            list.isError ? <div role="alert" data-testid="error-samples" style={{ marginTop: 8, fontSize: 12 }}>Could not load your samples. {errorMessage(list.error)}
              <div><button className="secondary-btn" style={{ marginTop: 8 }} onClick={() => void list.refetch()} data-testid="button-retry-samples"><RotateCcw size={13} /> Retry</button></div></div> :
              <div style={{ marginTop: 6 }}><span className="mono-value" style={{ fontSize: 31 }} data-testid="value-sample-count">{count}</span>
                <span className="subtle" style={{ fontSize: 11, marginLeft: 8 }} data-testid="text-samples-remaining">{list.data ? `${list.data.remaining} of ${list.data.limit} slots left` : ''}</span></div>}
          <p className="subtle" style={{ fontSize: 11, lineHeight: 1.6, margin: '10px 0 12px' }}>Ownership is tied only to an anonymous ID stored in this browser. If you clear browser storage you lose access to these samples, so export or delete them first.</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="secondary-btn" onClick={exportJson} disabled={!list.data || count === 0} data-testid="button-export-json"><Download size={14} /> Export JSON</button>
            {!confirming && <button className="secondary-btn danger-btn" onClick={() => setConfirming(true)} disabled={count === 0} data-testid="button-delete-shared"><Trash2 size={14} /> Delete all shared</button>}
          </div>
          {confirming && <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--brand-orange)', borderRadius: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.6 }}>Permanently delete all {count} shared samples from the server? This cannot be undone.</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button className="secondary-btn" onClick={() => setConfirming(false)} disabled={del.isPending} data-testid="button-cancel-delete-shared">Keep them</button>
              <button className="secondary-btn danger-btn" onClick={() => void remove()} disabled={del.isPending} data-testid="button-confirm-delete-shared">{del.isPending ? 'Deleting…' : 'Delete everything'}</button>
            </div></div>}
        </div>}
      </div>
    </div>
  </section>;
}
