import { useState } from 'react';
import { CloudUpload, ExternalLink, Unplug } from 'lucide-react';
import { usePoseLogSummary } from './data/poseLogs.ts';
import { connect, DEFAULT_REPO, disconnect, uploadPending, useSyncConfig, useSyncStatus, useUploadedIds } from './data/sync.ts';

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

export function SyncSettings() {
  const cfg = useSyncConfig();
  const status = useSyncStatus();
  const uploadedIds = useUploadedIds();
  const logs = usePoseLogSummary();
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = new Set(uploadedIds);
  const waiting = logs?.ids.filter((id) => !done.has(id)).length ?? 0;

  const submit = async () => {
    setBusy(true); setError(null);
    const err = await connect(token, repo);
    setBusy(false);
    if (err) setError(err); else setToken('');
  };

  return <section className="panel setting">
    <div className="icon-tile"><CloudUpload size={18} /></div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="setting-title">Send pose data to GitHub</div>
      {cfg ? <>
        <p className="subtle setting-text">Each workout’s joint positions upload to <b>{cfg.repo}</b> in <span className="mono-value">data/sessions/</span> right after you save it. Videos never upload.</p>
        <div style={{ fontSize: 12 }}>
          {waiting === 0 ? 'Everything is uploaded.' : `${waiting} session${waiting === 1 ? '' : 's'} waiting to upload.`}
        </div>
        {status.message && <div className={`notice${status.bad ? ' bad' : ''}`}>{status.message}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="secondary-btn" disabled={status.busy || waiting === 0} onClick={() => void uploadPending()}><CloudUpload size={14} /> {status.busy ? 'Uploading…' : 'Upload now'}</button>
          <button className="secondary-btn" onClick={disconnect}><Unplug size={14} /> Disconnect</button>
        </div>
      </> : <>
        <p className="subtle setting-text">Upload each workout’s joint positions to your repo so they can be analyzed without exporting files. Videos stay on the phone. The repo is public, so the coordinates are too.</p>
        <ol className="subtle" style={{ fontSize: 12, lineHeight: 1.7, paddingLeft: 18, margin: '0 0 12px' }}>
          <li><a href={TOKEN_PAGE} target="_blank" rel="noreferrer" style={{ color: '#000', fontWeight: 800 }}>Create a fine-grained token <ExternalLink size={11} style={{ verticalAlign: 'middle' }} /></a></li>
          <li>Expiration: 1 year (or no expiration)</li>
          <li>Repository access: <b>Only select repositories</b> → overachiever</li>
          <li>Permissions → Repository → <b>Contents: Read and write</b></li>
          <li>Generate, copy it, and paste it below</li>
        </ol>
        <input className="field mono-value" type="password" autoComplete="off" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
        <input className="field mono-value" style={{ marginTop: 8 }} aria-label="Repository" value={repo} onChange={(e) => setRepo(e.target.value)} />
        <button className="primary-btn" style={{ marginTop: 10 }} disabled={busy || !token.trim()} onClick={() => void submit()}>{busy ? 'Checking…' : 'Connect'}</button>
        {error && <div className="notice bad">{error}</div>}
      </>}
    </div>
  </section>;
}
