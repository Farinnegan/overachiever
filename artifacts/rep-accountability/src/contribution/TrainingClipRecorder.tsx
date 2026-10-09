import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Circle, LogIn, RotateCcw, Square, Trash2, Upload, Video } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import {
  getListTrainingVideosQueryKey, useCompleteTrainingVideoUpload, useDeleteTrainingVideo,
  useRequestTrainingVideoUpload,
} from '@workspace/api-client-react';
import { errorMessage, getConsent, useConsent } from './consent';

const MAX_MS = 15000;
const MAX_BYTES = 20 * 1024 * 1024;
const CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
type Exercise = 'squat' | 'push-up';
type Placement = 'floor' | 'body-level' | 'other';
type Clip = { blob: Blob; base: 'video/mp4' | 'video/webm'; durationMs: number; countedReps: number; exercise: Exercise };
type Draft = { id: string; uploadURL: string; uploaded: boolean };

function pickMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  return CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}
const baseOf = (m: string) => m.split(';')[0]!.trim().toLowerCase();
const box = (bad: boolean) => ({ marginTop: 10, padding: '10px 12px', borderRadius: 10, fontSize: 12, lineHeight: 1.5, border: '1px solid var(--brand-black)', background: bad ? 'var(--brand-orange)' : 'var(--brand-lime)' });

export function TrainingClipRecorder({ exercise, cameraActive, getStream, getReps, onPendingChange }: {
  exercise: Exercise; cameraActive: boolean; getStream: () => MediaStream | null; getReps: () => number; onPendingChange: (pending: boolean) => void;
}) {
  const consent = useConsent();
  const auth = useAuth();
  const qc = useQueryClient();
  const requestUpload = useRequestTrainingVideoUpload();
  const complete = useCompleteTrainingVideoUpload();
  const del = useDeleteTrainingVideo();
  const delRef = useRef(del.mutateAsync); delRef.current = del.mutateAsync;
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [expected, setExpected] = useState('');
  const [placement, setPlacement] = useState<Placement>('body-level');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const bytesRef = useRef(0);
  const startRef = useRef(0);
  const startRepsRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const tickRef = useRef<number | null>(null);
  const overRef = useRef(false);
  const draftRef = useRef<Draft | null>(null);
  const uploadAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const failedRef = useRef(false);
  const supported = pickMime() !== null;
  const pending = recording || clip !== null;
  const onPendingRef = useRef(onPendingChange); onPendingRef.current = onPendingChange;
  useEffect(() => { onPendingRef.current(pending); }, [pending]);

  useEffect(() => {
    if (!clip) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(clip.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);

  useEffect(() => {
    if (!pending) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [pending]);

  const clearTimers = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    if (tickRef.current !== null) window.clearInterval(tickRef.current);
    timerRef.current = null; tickRef.current = null;
  };
  const stopRecording = useCallback(() => {
    clearTimers();
    const r = recRef.current;
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* already stopped */ } }
  }, []);

  // Stop (never the camera tracks) when the camera ends or the setting is turned off.
  useEffect(() => { if ((!cameraActive || !consent.videoEnabled) && recRef.current) stopRecording(); }, [cameraActive, consent.videoEnabled, stopRecording]);
  useEffect(() => {
    if (consent.videoEnabled) return;
    uploadAbort.current?.abort();
    setClip(null);
    chunksRef.current = [];
    const d = draftRef.current;
    draftRef.current = null;
    if (d) void delRef.current({ id: d.id }).catch(() => undefined);
  }, [consent.videoEnabled]);
  useEffect(() => () => {
    mounted.current = false;
    uploadAbort.current?.abort();
    const r = recRef.current;
    if (r) { r.ondataavailable = null; r.onstop = null; r.onerror = null; }
    clearTimers();
    if (r && r.state !== 'inactive') { try { r.stop(); } catch { /* noop */ } }
    const d = draftRef.current;
    if (d) void delRef.current({ id: d.id }).catch(() => undefined);
  }, []);

  const start = () => {
    setError(null); setDone(false);
    const mime = pickMime();
    const stream = getStream();
    if (!mime) { setError('This browser cannot record video clips. Rep counting still works.'); return; }
    const tracks = stream?.getVideoTracks().filter((t) => t.readyState === 'live') ?? [];
    if (!stream || tracks.length === 0) { setError('Start the camera first, then record a clip.'); return; }
    try {
      const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 1_500_000 });
      chunksRef.current = []; bytesRef.current = 0; overRef.current = false; failedRef.current = false;
      rec.ondataavailable = (e) => {
        if (!e.data.size) return;
        chunksRef.current.push(e.data); bytesRef.current += e.data.size;
        if (bytesRef.current > MAX_BYTES) { overRef.current = true; stopRecording(); }
      };
      rec.onerror = () => { failedRef.current = true; setError('Recording failed. Try again.'); chunksRef.current = []; stopRecording(); };
      rec.onstop = () => {
        clearTimers(); recRef.current = null; setRecording(false);
        const durationMs = Math.min(MAX_MS, Math.round(performance.now() - startRef.current));
        const countedReps = Math.max(0, getReps() - startRepsRef.current);
        const type = baseOf(rec.mimeType || mime);
        const chunks = chunksRef.current; chunksRef.current = [];
        if (failedRef.current || !getConsent().videoEnabled) return;
        if (overRef.current || bytesRef.current > MAX_BYTES) { setError('That clip went over 20 MB. Try again; it stops at 15 seconds.'); return; }
        if (type !== 'video/mp4' && type !== 'video/webm') { setError(`This browser recorded ${type || 'an unknown format'}, which is not accepted. Clip discarded.`); return; }
        if (chunks.length === 0 || durationMs < 1000) { setError('Clip too short. Record at least one second.'); return; }
        setClip({ blob: new Blob(chunks, { type: rec.mimeType || mime }), base: type, durationMs, countedReps, exercise });
        setExpected('');
      };
      recRef.current = rec; startRef.current = performance.now(); startRepsRef.current = getReps();
      rec.start(1000);
      setRecording(true); setElapsed(0);
      tickRef.current = window.setInterval(() => setElapsed(Math.min(MAX_MS, performance.now() - startRef.current)), 200);
      timerRef.current = window.setTimeout(stopRecording, MAX_MS);
    } catch {
      recRef.current = null; setRecording(false);
      setError('Could not start recording on this camera stream.');
    }
  };

  const dropDraft = async () => {
    const d = draftRef.current; draftRef.current = null;
    if (d) { try { await del.mutateAsync({ id: d.id }); } catch { /* best effort */ } }
  };
  const discard = async () => { setClip(null); setError(null); await dropDraft(); };

  const exp = expected.trim() === '' ? NaN : Number(expected);
  const expValid = Number.isInteger(exp) && exp >= 0 && exp <= 100;
  const upload = async () => {
    if (!clip || !expValid || !auth.isAuthenticated || !getConsent().videoEnabled) return;
    setUploading(true); setError(null);
    const abort = new AbortController();
    uploadAbort.current = abort;
    try {
      if (!draftRef.current) {
        const r = await requestUpload.mutateAsync({ data: { consent: true, exercise: clip.exercise, expectedReps: exp, countedReps: Math.min(100, clip.countedReps), placement, durationMs: Math.max(1000, Math.min(MAX_MS, clip.durationMs)), size: clip.blob.size, contentType: clip.base } });
        draftRef.current = { id: r.id, uploadURL: r.uploadURL, uploaded: false };
      }
      if (abort.signal.aborted || !mounted.current || !getConsent().videoEnabled) {
        await dropDraft(); return;
      }
      const d = draftRef.current;
      if (!d.uploaded) {
        const res = await fetch(d.uploadURL, { method: 'PUT', headers: { 'Content-Type': clip.base }, body: clip.blob, signal: abort.signal });
        if (!res.ok) throw new Error(`Storage answered ${res.status}.`);
        d.uploaded = true;
      }
      if (abort.signal.aborted || !mounted.current || !getConsent().videoEnabled) { await dropDraft(); return; }
      await complete.mutateAsync({ id: d.id });
      draftRef.current = null;
      await qc.invalidateQueries({ queryKey: getListTrainingVideosQueryKey() });
      setClip(null); setDone(true);
    } catch (e) {
      setError(`Upload did not finish. ${errorMessage(e)} Retry, or discard to remove the draft.`);
    } finally { uploadAbort.current = null; if (mounted.current) setUploading(false); }
  };

  if (!consent.videoEnabled) return null;

  return <div className="panel" style={{ padding: 18, marginTop: 13 }} data-testid="section-training-clip">
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Video size={15} /><div className="small-label">TRAINING CLIP (OPTIONAL)</div></div>
    {!clip && <>
      <p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, margin: '9px 0 12px' }}>Record up to 15 seconds from the camera, with no audio. It stays on this device until you choose Upload.</p>
      {!auth.isLoading && !auth.isAuthenticated && <div style={{ ...box(false), background: 'var(--brand-white)' }} data-testid="notice-clip-signin">
        To upload clips, sign in before you record. Signing in reloads the page and discards any clip made before it.
        <div><button className="secondary-btn" style={{ marginTop: 8 }} onClick={auth.login} data-testid="button-clip-signin"><LogIn size={13} /> Sign in</button></div>
      </div>}
      {!supported ? <div role="alert" style={box(true)} data-testid="status-clip-unsupported">This browser cannot record video clips. Rep counting still works.</div> :
        recording ? <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
          <button className="primary-btn" style={{ background: 'var(--brand-orange)' }} onClick={stopRecording} data-testid="button-stop-clip"><Square size={14} /> Stop</button>
          <span className="mono-value" style={{ fontSize: 13 }} data-testid="value-clip-elapsed">{(elapsed / 1000).toFixed(1)}s / 15s</span>
        </div> :
          <button className="secondary-btn" style={{ marginTop: 10 }} onClick={start} disabled={!cameraActive} data-testid="button-record-clip"><Circle size={13} /> Record training clip</button>}
      {!cameraActive && supported && !recording && <div className="subtle" style={{ fontSize: 11, marginTop: 8 }}>Start the camera to record.</div>}
      {done && <div role="status" style={box(false)} data-testid="status-clip-uploaded">Clip uploaded and saved to your private list. Labels are used for evaluation, not automatic training.</div>}
    </>}
    {clip && <div style={{ marginTop: 10 }}>
      {previewUrl && <video src={previewUrl} controls playsInline style={{ width: '100%', maxHeight: 320, borderRadius: 12, background: 'var(--brand-black)' }} data-testid="video-clip-preview" />}
      <div className="subtle mono-value" style={{ fontSize: 11, marginTop: 7 }}>{(clip.durationMs / 1000).toFixed(1)}s · {(clip.blob.size / 1048576).toFixed(1)} MB · {clip.base} · counted {clip.countedReps}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
        <div><label className="small-label" htmlFor="clip-expected">REPS YOU DID (0-100)</label>
          <input id="clip-expected" className="field" type="number" inputMode="numeric" min={0} max={100} step={1} value={expected} onChange={(e) => setExpected(e.target.value)} disabled={uploading || !!draftRef.current} data-testid="input-clip-expected" style={{ marginTop: 6 }} /></div>
        <div><label className="small-label" htmlFor="clip-placement">CAMERA PLACEMENT</label>
          <select id="clip-placement" className="field" value={placement} onChange={(e) => setPlacement(e.target.value as Placement)} disabled={uploading || !!draftRef.current} data-testid="select-clip-placement" style={{ marginTop: 6 }}>
            <option value="floor">Floor</option><option value="body-level">Body level</option><option value="other">Other</option>
          </select></div>
      </div>
      {!auth.isAuthenticated && <div style={{ ...box(false), background: 'var(--brand-white)' }} data-testid="notice-upload-signin">Sign in to upload. Signing in reloads the page and discards this local clip, so you would need to record again.
        <div><button className="secondary-btn" style={{ marginTop: 8 }} onClick={auth.login} data-testid="button-upload-signin"><LogIn size={13} /> Sign in</button></div></div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button className="primary-btn" onClick={() => void upload()} disabled={uploading || !expValid || !auth.isAuthenticated} data-testid="button-upload-clip">
          {uploading ? 'Uploading…' : draftRef.current ? <><RotateCcw size={14} /> Retry upload</> : <><Upload size={14} /> Upload for tracker improvement</>}</button>
        <button className="secondary-btn" onClick={() => void discard()} disabled={uploading} data-testid="button-discard-clip"><Trash2 size={14} /> Discard</button>
      </div>
    </div>}
    {error && <div role="alert" style={box(true)} data-testid="status-clip-error">{error}{!clip && supported && !recording && <div><button className="secondary-btn" style={{ marginTop: 8 }} onClick={start} disabled={!cameraActive} data-testid="button-retry-record"><RotateCcw size={13} /> Try again</button></div>}</div>}
  </div>;
}
