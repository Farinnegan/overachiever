import { useState } from 'react';
import { CloudUpload, ExternalLink, Unplug } from 'lucide-react';
import { Link } from 'wouter';
import { usePoseLogIds } from './data/poseLogs.ts';
import { connect, DEFAULT_REPO, disconnect, uploadPending, useSyncConfig, useSyncStatus, useUploadedIds } from './data/sync.ts';

const TOKEN_PAGE = 'https://github.com/settings/personal-access-tokens/new';

export function SyncSettings() {
  const cfg = useSyncConfig();
  const status = useSyncStatus();
  const uploadedIds = useUploadedIds();
  const ids = usePoseLogIds();
  const [token, setToken] = useState('');
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = new Set(uploadedIds);
  const waiting = ids?.filter((id) => !done.has(id)).length ?? 0;

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
        <p className="subtle setting-text">Every workout’s joint positions upload to <b>{cfg.repo}</b> in <span className="mono-value">data/sessions/</span> the moment you save it, and retry on their own if the connection drops. Videos never upload.</p>
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

/** Today-screen reminder: is every saved workout on GitHub? Says why not if it isn't. */
export function SyncBanner() {
  const cfg = useSyncConfig();
  const status = useSyncStatus();
  const uploadedIds = useUploadedIds();
  const ids = usePoseLogIds();
  if (!cfg) {
    return <div className="notice bad" style={{ marginTop: 14 }}>
      GitHub sync is off, so workouts stay on this phone only. <Link href="/settings" className="text-link">Connect it in Settings</Link> and every set uploads right after you save it.
    </div>;
  }
  const done = new Set(uploadedIds);
  const waiting = ids?.filter((id) => !done.has(id)).length ?? 0;
  if (waiting === 0 && !status.busy) return null;
  return <div className={`notice${status.bad ? ' bad' : ''}`} style={{ marginTop: 14 }}>
    {status.busy ? status.message : `${waiting} session${waiting === 1 ? '' : 's'} not uploaded yet. ${status.message ?? ''}`}
    {!status.busy && <> <button className="text-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }} onClick={() => void uploadPending()}>Retry now</button></>}
  </div>;
}
