import { useEffect, useRef, useState } from 'react';
import { Circle, Download, Square, Trash2 } from 'lucide-react';

const MAX_MS = 30000;
const TYPES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

const pickType = () =>
  typeof MediaRecorder === 'undefined' ? null : TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? null;

/**
 * Record a short clip from the live camera and save it to the phone.
 * Nothing is uploaded anywhere. Useful for showing exactly what happened on a missed rep.
 */
export function ClipRecorder({ getStream, active, label }: { getStream: () => MediaStream | null; active: boolean; label: string }) {
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string; ext: string } | null>(null);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<number | null>(null);

  const stop = () => {
    if (timer.current) window.clearInterval(timer.current);
    timer.current = null;
    if (recorder.current?.state === 'recording') recorder.current.stop();
  };
  useEffect(() => { if (!active) stop(); }, [active]);
  useEffect(() => () => { stop(); }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);

  const start = () => {
    setError('');
    const type = pickType();
    const tracks = getStream()?.getVideoTracks().filter((t) => t.readyState === 'live') ?? [];
    if (!type) { setError('This browser can’t record video. Counting still works.'); return; }
    if (!tracks.length) { setError('Start the camera first.'); return; }
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: 2_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      setRecording(false);
      const base = type.split(';')[0]!;
      const blob = new Blob(chunks, { type: base });
      if (blob.size) setClip({ blob, url: URL.createObjectURL(blob), ext: base === 'video/mp4' ? 'mp4' : 'webm' });
    };
    rec.start(1000);
    recorder.current = rec;
    const began = Date.now();
    setElapsed(0);
    setRecording(true);
    timer.current = window.setInterval(() => {
      const ms = Date.now() - began;
      setElapsed(ms);
      if (ms >= MAX_MS) stop();
    }, 250);
  };

  const save = async () => {
    if (!clip) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const name = `overachiever-${label}-${stamp}.${clip.ext}`;
    const file = new File([clip.blob], name, { type: clip.blob.type });
    // On phones, the share sheet has "Save Video". Fall back to a normal download.
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch { /* cancelled: fall through */ }
    }
    const a = document.createElement('a');
    a.href = clip.url; a.download = name; a.click();
  };

  return <div className="panel" style={{ padding: 16, marginTop: 12 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <div>
        <div className="small-label">VIDEO CLIP · SAVED TO YOUR PHONE ONLY</div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 4 }}>Up to 30 seconds. Handy when a rep doesn’t count.</div>
      </div>
      {!clip && (recording
        ? <button className="secondary-btn danger-btn" onClick={stop}><Square size={13} /> Stop · {Math.ceil((MAX_MS - elapsed) / 1000)}s</button>
        : <button className="secondary-btn" onClick={start} disabled={!active}><Circle size={13} color="var(--brand-orange)" fill="var(--brand-orange)" /> Record clip</button>)}
    </div>
    {error && <div className="notice bad">{error}</div>}
    {clip && <>
      <video src={clip.url} controls playsInline muted style={{ width: '100%', maxHeight: 260, marginTop: 10, borderRadius: 12, background: '#000' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="primary-btn" style={{ padding: '11px 14px' }} onClick={() => void save()}><Download size={14} /> Save to phone</button>
        <button className="secondary-btn" onClick={() => setClip(null)}><Trash2 size={13} /> Discard</button>
      </div>
    </>}
  </div>;
}
