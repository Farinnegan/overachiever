import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, ArrowLeft, ArrowRight, Camera, CameraOff, Check, Flag, Minus, Plus, RotateCcw, SwitchCamera, X } from 'lucide-react';
import { saveSession, updateSettings, useSettings } from '../data/store.ts';
import { PoseLogger, savePoseLog } from '../data/poseLogs.ts';
import { createTracker, EXERCISES, TRACKER_VERSION, type TrackResult, type Tracker } from '../tracking/exercises.ts';
import { EXERCISE_IDS, type Exercise } from '../tracking/types.ts';
import { loadPoseModel, type Landmarker } from './pose-model.ts';
import { drawPose } from './overlay.ts';
import { announceRep, keepScreenOn, unlockSound } from './feedback.ts';
import { ClipRecorder } from './ClipRecorder.tsx';

type Stage = 'setup' | 'loading' | 'live' | 'review';
type Placement = 'floor' | 'low' | 'body' | 'other';
const LAST_EXERCISE = 'overachiever-last-exercise';
const PLACEMENTS: { id: Placement; label: string }[] = [
  { id: 'floor', label: 'On the floor' },
  { id: 'low', label: 'Low (shin or knee height)' },
  { id: 'body', label: 'Body height (waist or chest)' },
  { id: 'other', label: 'Other' },
];

const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function initialExercise(): Exercise {
  try {
    const v = localStorage.getItem(LAST_EXERCISE) as Exercise | null;
    if (v && EXERCISE_IDS.includes(v)) return v;
  } catch { /* ignore */ }
  return 'squat';
}

export function SessionPage() {
  const [, navigate] = useLocation();
  const prefs = useSettings();
  const [exercise, setExerciseState] = useState<Exercise>(initialExercise);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [stage, setStage] = useState<Stage>('setup');
  const [error, setError] = useState('');
  const [reps, setReps] = useState(0);
  const [track, setTrack] = useState<TrackResult | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [flags, setFlags] = useState(0);
  const [flash, setFlash] = useState(0);
  // Review step
  const [actual, setActual] = useState(0);
  const [placement, setPlacement] = useState<Placement>('floor');
  const [keepPose, setKeepPose] = useState(prefs.keepPoseData);
  const [saving, setSaving] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const modelRef = useRef<Landmarker | null>(null);
  const trackerRef = useRef<Tracker | null>(null);
  const loggerRef = useRef(new PoseLogger());
  const rafRef = useRef<number | null>(null);
  const releaseWake = useRef<() => void>(() => undefined);
  const generation = useRef(0);
  const repRef = useRef(0);
  const startedAt = useRef<Date | null>(null);
  const startMs = useRef(0);
  const lastProcessed = useRef(-Infinity);
  const lastVideoTime = useRef(-1);
  const aspectRef = useRef(0.75);
  const soundRef = useRef(prefs.repSound);
  soundRef.current = prefs.repSound;

  const def = EXERCISES[exercise];
  const setExercise = (e: Exercise) => {
    setExerciseState(e);
    try { localStorage.setItem(LAST_EXERCISE, e); } catch { /* ignore */ }
  };

  const stopCamera = useCallback(() => {
    generation.current += 1;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    releaseWake.current();
    releaseWake.current = () => undefined;
  }, []);

  useEffect(() => () => {
    stopCamera();
    modelRef.current?.close();
    modelRef.current = null;
  }, [stopCamera]);

  useEffect(() => {
    if (stage !== 'live') return;
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startMs.current) / 1000)), 500);
    return () => window.clearInterval(id);
  }, [stage]);

  const loop = useCallback(() => {
    const video = videoRef.current, model = modelRef.current, tracker = trackerRef.current;
    if (!video || !model || !tracker) return;
    const now = performance.now();
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime.current && now - lastProcessed.current >= 66) {
      lastProcessed.current = now;
      lastVideoTime.current = video.currentTime;
      try {
        const points = model.detectForVideo(video, now).landmarks?.[0];
        const aspect = video.videoWidth / video.videoHeight;
        aspectRef.current = aspect;
        const out = tracker.update(points, aspect, now);
        loggerRef.current.add(points, now);
        if (canvasRef.current) drawPose(canvasRef.current, video, points, tracker.def.joints, out.status === 'bottom');
        if (out.counted) {
          repRef.current += 1;
          setReps(repRef.current);
          setFlash((f) => f + 1);
          announceRep(repRef.current, soundRef.current);
        }
        setTrack(out);
      } catch {
        stopCamera();
        setStage('setup');
        setError('Pose tracking stopped unexpectedly. Start the camera again.');
        return;
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, [stopCamera]);

  const start = useCallback(async (nextFacing: 'user' | 'environment', keepSession: boolean) => {
    stopCamera();
    const gen = generation.current;
    setError('');
    setStage('loading');
    if (!keepSession) unlockSound(soundRef.current);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStage('setup');
      setError('The camera needs a secure (https) page and a browser with camera support.');
      return;
    }
    try {
      modelRef.current ??= await loadPoseModel();
      if (gen !== generation.current) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: nextFacing }, width: { ideal: 960 }, height: { ideal: 720 } },
      });
      if (gen !== generation.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      setFacing(nextFacing);
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (gen !== generation.current) return;
      trackerRef.current = createTracker(exercise);
      if (!keepSession) {
        startedAt.current = new Date();
        startMs.current = Date.now();
        repRef.current = 0;
        setReps(0);
        setElapsed(0);
        setFlags(0);
        loggerRef.current.begin(performance.now());
      }
      lastProcessed.current = -Infinity;
      lastVideoTime.current = -1;
      setTrack(null);
      releaseWake.current = await keepScreenOn();
      setStage('live');
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      if (gen !== generation.current) return;
      stopCamera();
      setStage('setup');
      const name = err instanceof Error ? err.name : '';
      setError(
        name === 'NotAllowedError' ? 'Camera permission was blocked. Allow camera access for this site in your browser settings, then try again.'
          : name === 'NotFoundError' ? 'No camera found on this device.'
            : name === 'NotReadableError' ? 'The camera is being used by another app.'
              : 'Couldn’t load the pose model or the camera. The model downloads from the internet the first time, so check your connection.',
      );
    }
  }, [exercise, loop, stopCamera]);

  const end = () => {
    stopCamera();
    setActual(repRef.current);
    setKeepPose(prefs.keepPoseData);
    setStage('review');
  };

  const flagMissed = () => {
    loggerRef.current.flagMissed(performance.now());
    setFlags(loggerRef.current.flagCount);
  };

  const save = async () => {
    setSaving(true);
    const began = startedAt.current ?? new Date();
    const duration = Math.max(0, Math.round((Date.now() - startMs.current) / 1000));
    const counted = repRef.current;
    if (actual > 0) {
      saveSession({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        exercise, reps: actual, startedAt: began.toISOString(), durationSeconds: duration,
        ...(actual !== counted ? { countedReps: counted } : {}),
      });
    }
    if (keepPose && loggerRef.current.frameCount > 10) {
      try {
        await savePoseLog(loggerRef.current.build({
          id: `${began.getTime()}`, exercise, startedAt: began.toISOString(), aspect: aspectRef.current,
          trackerVersion: TRACKER_VERSION, countedReps: counted, actualReps: actual, placement,
        }));
      } catch { /* pose data is optional */ }
    }
    if (keepPose !== prefs.keepPoseData) updateSettings({ keepPoseData: keepPose });
    navigate('/');
  };

  const live = stage === 'live';
  const mirrored = facing === 'user';

  // ---------- Review ----------
  if (stage === 'review') {
    const counted = repRef.current;
    return <main className="page-wrap enter" style={{ maxWidth: 620 }}>
      <div className="eyebrow">SESSION DONE · {def.label.toUpperCase()} · {formatDuration(elapsed)}</div>
      <h1 className="page-title">How did it go?</h1>
      <section className="panel" style={{ padding: 20, marginTop: 22 }}>
        <div className="small-label">THE CAMERA COUNTED</div>
        <div className="mono-value" style={{ fontSize: 44, marginTop: 4 }}>{counted}</div>
        <div style={{ fontWeight: 800, fontSize: 14, marginTop: 18 }}>How many did you actually do?</div>
        <p className="subtle" style={{ fontSize: 12, margin: '5px 0 12px' }}>This is what goes in your history. If it’s different from the camera, both numbers are kept so we can fix the tracker.</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button className="secondary-btn stepper" aria-label="One less" onClick={() => setActual((n) => Math.max(0, n - 1))}><Minus size={18} /></button>
          <input className="field mono-value" inputMode="numeric" aria-label="Actual reps" style={{ width: 90, textAlign: 'center', fontSize: 24 }}
            value={actual} onChange={(e) => setActual(Math.max(0, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 0)))} />
          <button className="secondary-btn stepper" aria-label="One more" onClick={() => setActual((n) => Math.min(999, n + 1))}><Plus size={18} /></button>
          {actual !== counted && <span className="tag">{actual > counted ? `${actual - counted} missed` : `${counted - actual} extra`}</span>}
        </div>
        <label className="small-label" htmlFor="placement" style={{ display: 'block', marginTop: 20 }}>WHERE WAS THE PHONE?</label>
        <select id="placement" className="field" style={{ marginTop: 7 }} value={placement} onChange={(e) => setPlacement(e.target.value as Placement)}>
          {PLACEMENTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 12, lineHeight: 1.5 }}>
          <input type="checkbox" checked={keepPose} onChange={(e) => setKeepPose(e.target.checked)} style={{ marginTop: 3, accentColor: '#000' }} />
          <span><b>Keep this session’s pose data</b> ({loggerRef.current.frameCount} frames{flags ? `, ${flags} missed-rep flag${flags === 1 ? '' : 's'}` : ''}). Joint positions only, no video, stored on this phone. Export it from Settings to tune the tracker.</span>
        </label>
      </section>
      <button className="primary-btn" style={{ width: '100%', marginTop: 16, background: '#000', color: '#fff' }} disabled={saving} onClick={() => void save()}>
        <Check size={16} /> {actual > 0 ? `Save ${actual} ${actual === 1 ? 'rep' : 'reps'}` : 'Done, nothing to save'}
      </button>
      <button className="secondary-btn" style={{ width: '100%', marginTop: 8 }} disabled={saving} onClick={() => navigate('/')}><X size={14} /> Discard session</button>
    </main>;
  }

  // ---------- Setup and live ----------
  const meterColor = track?.status === 'bottom' ? 'var(--brand-orange)' : 'var(--brand-lime)';
  return <main className="page-wrap enter" style={{ maxWidth: 760 }}>
    {!live && <Link href="/" className="nav-link" style={{ paddingLeft: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={14} /> Back</Link>}
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: live ? 0 : 14, flexWrap: 'wrap' }}>
      <div><div className="eyebrow">{live ? `LIVE · ${def.label.toUpperCase()}` : 'NEW SESSION'}</div>
        {!live && <h1 className="page-title" style={{ marginBottom: 0 }}>One rep at a time.</h1>}</div>
      {live && <div className="mono-value" style={{ fontSize: 20 }}>{formatDuration(elapsed)}</div>}
    </div>

    {!live && <div className="exercise-picker" role="group" aria-label="Choose exercise">
      {EXERCISE_IDS.map((id) => <button key={id} disabled={stage === 'loading'} onClick={() => setExercise(id)}
        className={exercise === id ? 'primary-btn' : 'secondary-btn'}>{EXERCISES[id].label}</button>)}
    </div>}

    <div className={`camera-frame${live ? ' is-live' : ''}`} style={{ marginTop: 14 }}>
      <video ref={videoRef} muted playsInline aria-label="Camera preview" className={mirrored ? 'mirrored' : ''} />
      <canvas ref={canvasRef} className={`pose-canvas${mirrored ? ' mirrored' : ''}`} />
      {live && <>
        <div className="camera-overlay" />
        <div className="live-count" key={flash}>{reps}</div>
        <div className="live-status">{track?.text ?? def.text.searching}</div>
        <button className="camera-control" style={{ position: 'absolute', right: 12, top: 12 }} onClick={() => void start(facing === 'user' ? 'environment' : 'user', true)} aria-label="Switch camera"><SwitchCamera size={17} /></button>
      </>}
      {!live && <div className="camera-idle">
        <div className="camera-idle-mark">{stage === 'loading' ? <Activity size={26} /> : error ? <CameraOff size={26} /> : <Camera size={26} />}</div>
        <div className="font-display" style={{ fontSize: 22 }}>{stage === 'loading' ? 'Getting ready…' : def.label}</div>
        <div style={{ color: 'rgba(255,255,255,.78)', fontSize: 12, maxWidth: 330, lineHeight: 1.6, marginTop: 8 }}>
          {stage === 'loading' ? 'Loading the pose model, then asking for the camera.' : def.setup}
        </div>
        {stage === 'setup' && <button onClick={() => void start(facing, false)} className="primary-btn" style={{ marginTop: 18 }}>
          {error ? <RotateCcw size={15} /> : <Camera size={16} />} {error ? 'Try again' : 'Start camera'}
        </button>}
      </div>}
    </div>
    {error && <div role="alert" className="notice bad">{error}</div>}

    {live && <section className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div className="small-label">DEPTH</div>
        <div className="small-label">{track?.status === 'bottom' ? 'BOTTOM REACHED' : 'BOTTOM →'}</div>
      </div>
      <div className="meter"><span style={{ width: `${Math.round((track?.progress ?? 0) * 100)}%`, background: meterColor }} /></div>
      {prefs.showTracking && <div className="mono-value subtle" style={{ fontSize: 11, marginTop: 9, lineHeight: 1.5 }}>
        {def.signal}: {track?.value != null ? def.format(track.value) : '–'}
        {track?.rest != null && track.bottomLine != null && <> · start {def.format(track.rest)} · bottom at {def.format(track.bottomLine)}</>}
        {' · '}{track?.status ?? 'searching'}
      </div>}
    </section>}

    {!live && <div className="panel" style={{ padding: 16, marginTop: 12 }}>
      <div className="small-label">WHAT COUNTS AS A REP</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 11, flexWrap: 'wrap' }}>
        {def.steps.map((label, i) => <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span className="step-dot" style={{ background: i === 1 ? 'var(--brand-lime)' : '#fff' }}>{i + 1}</span>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>{i < 2 && <ArrowRight size={12} color="var(--brand-orange)" />}
        </div>)}
      </div>
      <p className="subtle" style={{ fontSize: 11, lineHeight: 1.6, margin: '11px 0 0' }}>Hold the starting position still for a second so it learns your range. The lime joints on screen are the ones it reads. If one turns orange, it can’t see it.</p>
    </div>}

    {live && <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
      <button className="secondary-btn" onClick={flagMissed} style={{ padding: 15 }}><Flag size={14} /> Missed one{flags ? ` (${flags})` : ''}</button>
      <button className="primary-btn" onClick={end} style={{ background: '#000', color: '#fff' }}><Check size={16} /> End session</button>
    </div>}

    <ClipRecorder getStream={() => streamRef.current} active={live} label={exercise} />
  </main>;
}
