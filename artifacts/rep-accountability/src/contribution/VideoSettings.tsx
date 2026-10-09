import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, LogIn, LogOut, Play, Trash2, Video } from 'lucide-react';
import { useAuth } from '@workspace/replit-auth-web';
import {
  getGetTrainingVideoContentUrl, getListTrainingVideosQueryKey, useDeleteTrainingVideo, useListTrainingVideos,
} from '@workspace/api-client-react';
import { errorMessage, setVideoEnabled, useConsent } from './consent';

const LIMIT = 50;

export function VideoSettings() {
  const consent = useConsent();
  const auth = useAuth();
  const qc = useQueryClient();
  const list = useListTrainingVideos({ query: { enabled: auth.isAuthenticated, queryKey: getListTrainingVideosQueryKey() } });
  const del = useDeleteTrainingVideo();
  const [msg, setMsg] = useState<{ bad: boolean; text: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [play, setPlay] = useState<{ id: string; url: string } | null>(null);
  const playRef = useRef<string | null>(null);
  useEffect(() => () => { if (playRef.current) URL.revokeObjectURL(playRef.current); }, []);

  const closePlay = () => { if (playRef.current) URL.revokeObjectURL(playRef.current); playRef.current = null; setPlay(null); };
  const toggle = () => {
    const err = setVideoEnabled(!consent.videoEnabled);
    setMsg(err ? { bad: true, text: err } : { bad: false, text: consent.videoEnabled ? 'Training videos are off.' : 'Training videos are on. Nothing records until you press Record on the session page.' });
  };
  const fetchBlob = async (id: string) => {
    const res = await fetch(getGetTrainingVideoContentUrl(id), { credentials: 'include' });
    if (!res.ok) throw new Error(`Server answered ${res.status}.`);
    return res.blob();
  };
  const watch = async (id: string) => {
    if (play?.id === id) { closePlay(); return; }
    setBusyId(id); setMsg(null);
    try {
      const url = URL.createObjectURL(await fetchBlob(id));
      closePlay(); playRef.current = url; setPlay({ id, url });
    } catch (e) { setMsg({ bad: true, text: `Could not load that clip. ${errorMessage(e)}` }); }
    setBusyId(null);
  };
  const download = async (id: string, type: string) => {
    setBusyId(id); setMsg(null);
    try {
      const url = URL.createObjectURL(await fetchBlob(id));
      const a = document.createElement('a'); a.href = url; a.download = `training-clip-${id}.${type.includes('mp4') ? 'mp4' : 'webm'}`; a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setMsg({ bad: true, text: `Download failed. ${errorMessage(e)}` }); }
    setBusyId(null);
  };
  const remove = async (id: string) => {
    try {
      await del.mutateAsync({ id });
      if (play?.id === id) closePlay();
      setConfirmId(null); setMsg({ bad: false, text: 'Clip deleted.' });
      await qc.invalidateQueries({ queryKey: getListTrainingVideosQueryKey() });
    } catch (e) { setMsg({ bad: true, text: `Delete failed. ${errorMessage(e)}` }); }
  };
  const videos = list.data?.videos ?? [];

  return <section className="panel" style={{ padding: 21, marginTop: 13 }} data-testid="section-videos">
    <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}>
      <div style={{ width: 38, height: 38, background: 'var(--brand-lime)', borderRadius: 12, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Video size={17} /></div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Training videos (optional)</div>
        <p className="subtle" style={{ fontSize: 12, lineHeight: 1.65, margin: '7px 0 12px' }}>Off by default and separate from pose sharing. When on, a Record button appears on the session page for clips up to 15 seconds, no audio. Clips never upload automatically: you preview each one, then choose Upload or Discard. Uploading needs a sign-in; clips are private to you and labels are used for evaluation, not automatic training.</p>
        <button role="switch" aria-checked={consent.videoEnabled} onClick={toggle} className={consent.videoEnabled ? 'primary-btn' : 'secondary-btn'} data-testid="switch-videos">{consent.videoEnabled ? 'Allow training videos: on' : 'Allow training videos: off'}</button>
        {msg && <div role={msg.bad ? 'alert' : 'status'} data-testid="status-videos" style={{ marginTop: 12, padding: '10px 12px', borderRadius: 10, fontSize: 12, border: '1px solid var(--brand-black)', background: msg.bad ? 'var(--brand-orange)' : 'var(--brand-lime)' }}>{msg.text}</div>}

        <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid rgba(0,0,0,.14)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div className="small-label">YOUR UPLOADED CLIPS</div>
            {auth.isAuthenticated && <button className="secondary-btn" onClick={auth.logout} data-testid="button-video-signout" style={{ padding: '7px 10px' }}><LogOut size={13} /> Sign out</button>}
          </div>
          {auth.isLoading ? <div className="subtle" style={{ fontSize: 12, marginTop: 8 }}>Loading…</div> :
            !auth.isAuthenticated ? <div style={{ marginTop: 8 }}><p className="subtle" style={{ fontSize: 12, lineHeight: 1.6, margin: '0 0 10px' }}>Sign in to upload clips or see the ones you have uploaded. Workouts and local counting never need an account.</p>
              <button className="secondary-btn" onClick={auth.login} data-testid="button-video-signin"><LogIn size={14} /> Sign in</button></div> :
              list.isLoading ? <div className="subtle" style={{ fontSize: 12, marginTop: 8 }} data-testid="status-videos-loading">Loading clips…</div> :
                list.isError ? <div role="alert" style={{ fontSize: 12, marginTop: 8 }} data-testid="error-videos">Could not load your clips. {errorMessage(list.error)}
                  <div><button className="secondary-btn" style={{ marginTop: 8 }} onClick={() => void list.refetch()} data-testid="button-retry-videos">Retry</button></div></div> :
                  <>
                    <div style={{ marginTop: 6 }}><span className="mono-value" style={{ fontSize: 31 }} data-testid="value-video-count">{videos.length}</span><span className="subtle" style={{ fontSize: 11, marginLeft: 8 }}>of {LIMIT} clips</span></div>
                    {videos.length === 0 ? <div className="subtle" style={{ fontSize: 12, marginTop: 8 }} data-testid="empty-videos">No clips yet. Record one from a session.</div> :
                      <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>{videos.map((v) => <div key={v.id} data-testid={`row-video-${v.id}`} style={{ border: '1px solid rgba(0,0,0,.15)', borderRadius: 12, padding: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 800 }}>{v.exercise === 'squat' ? 'Squats' : 'Bicep curls'} · {(v.durationMs / 1000).toFixed(1)}s</div>
                          <span className="small-label" style={{ background: v.ready ? 'var(--brand-lime)' : 'var(--brand-orange)', color: 'var(--brand-black)', padding: '2px 7px', borderRadius: 6 }}>{v.ready ? 'READY' : 'INCOMPLETE DRAFT'}</span>
                        </div>
                        <div className="subtle mono-value" style={{ fontSize: 10, marginTop: 5 }}>{new Date(v.createdAt).toLocaleString()} · {v.placement} · you {v.expectedReps} / counted {v.countedReps} · {(v.size / 1048576).toFixed(1)} MB</div>
                        {play?.id === v.id && <video src={play.url} controls playsInline style={{ width: '100%', maxHeight: 300, marginTop: 10, borderRadius: 10, background: 'var(--brand-black)' }} data-testid={`video-playback-${v.id}`} />}
                        <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                          {v.ready && <button className="secondary-btn" onClick={() => void watch(v.id)} disabled={busyId === v.id} data-testid={`button-play-${v.id}`}><Play size={13} /> {play?.id === v.id ? 'Close' : 'Play'}</button>}
                          {v.ready && <button className="secondary-btn" onClick={() => void download(v.id, v.contentType)} disabled={busyId === v.id} data-testid={`button-download-${v.id}`}><Download size={13} /> Download</button>}
                          {confirmId !== v.id && <button className="secondary-btn danger-btn" onClick={() => setConfirmId(v.id)} data-testid={`button-delete-${v.id}`}><Trash2 size={13} /> Delete</button>}
                        </div>
                        {confirmId === v.id && <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--brand-orange)', borderRadius: 10, fontSize: 12 }}>Permanently delete this clip?
                          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                            <button className="secondary-btn" onClick={() => setConfirmId(null)} disabled={del.isPending} data-testid={`button-cancel-delete-${v.id}`}>Keep it</button>
                            <button className="secondary-btn danger-btn" onClick={() => void remove(v.id)} disabled={del.isPending} data-testid={`button-confirm-delete-${v.id}`}>{del.isPending ? 'Deleting…' : 'Delete clip'}</button>
                          </div></div>}
                      </div>)}</div>}
                  </>}
        </div>
      </div>
    </div>
  </section>;
}
