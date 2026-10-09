import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ContributionSettings } from '@/contribution/ContributionSettings';
import { VideoSettings } from '@/contribution/VideoSettings';
import { TrainingClipRecorder } from '@/contribution/TrainingClipRecorder';
import { ReviewQueue } from '@/contribution/ReviewQueue';
import { RepCapture } from '@/contribution/capture';
import { ExerciseTracker, loadClassifier, type Exercise, type Point as Landmark } from '@/tracking/classifier';
import { getConsent } from '@/contribution/consent';
import { clearQueue, enqueue, getQueue, isFull, useQueue } from '@/contribution/queue';
import { Link, Route, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowLeft, ArrowRight, Camera, CameraOff, Check,
  CircleHelp, Dumbbell, History, LockKeyhole, RotateCcw, Settings2,
  ShieldCheck, Sparkles, Target, Trash2, Video, X,
} from 'lucide-react';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
type WorkoutSession = { id: string; exercise: Exercise | 'bicep-curl'; reps: number; startedAt: string; durationSeconds: number };
type AppData = { sessions: WorkoutSession[]; weeklyWorkoutGoal: number };
const STORAGE_KEY = 'rep-accountability-v1';
const defaultData: AppData = { sessions: [], weeklyWorkoutGoal: 3 };

function readData(): AppData {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<AppData> | null;
    return {
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions.filter((s): s is WorkoutSession =>
        !!s && typeof s.id === 'string' && (s.exercise === 'squat' || s.exercise === 'push-up' || s.exercise === 'bicep-curl') &&
        Number.isFinite(s.reps) && typeof s.startedAt === 'string') : [],
      weeklyWorkoutGoal: Number.isFinite(parsed?.weeklyWorkoutGoal)
        ? Math.max(1, Math.min(7, Math.round(parsed!.weeklyWorkoutGoal!))) : 3,
    };
  } catch { return defaultData; }
}
const localDay = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
const mondayStart = (date: Date) => {
  const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
};
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const prettyExercise = (e: WorkoutSession['exercise']) => e === 'squat' ? 'Squats' : e === 'push-up' ? 'Push-ups' : 'Bicep curls (past exercise)';
const fmtDate = (value: string) => new Date(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function useAppData() {
  const [data, setData] = useState<AppData>(readData);
  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }, [data]);
  const save = useCallback((session: WorkoutSession) => {
    setData((current) => ({ ...current, sessions: [session, ...current.sessions] }));
  }, []);
  const setGoal = useCallback((weeklyWorkoutGoal: number) => setData((current) => ({ ...current, weeklyWorkoutGoal })), []);
  const clear = useCallback(() => setData((current) => ({ ...current, sessions: [] })), []);
  return { data, save, setGoal, clear };
}

function weekSessions(sessions: WorkoutSession[], start = mondayStart(new Date())) {
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return sessions.filter((s) => { const d = new Date(s.startedAt); return d >= start && d < end; });
}
function getStreak(sessions: WorkoutSession[]) {
  const days = new Set(sessions.map((s) => localDay(new Date(s.startedAt))));
  const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  if (!days.has(localDay(cursor))) cursor.setDate(cursor.getDate() - 1);
  let count = 0;
  while (days.has(localDay(cursor))) { count++; cursor.setDate(cursor.getDate() - 1); }
  return count;
}

const navItems = [
  { href: '/', label: 'Today', icon: Activity },
  { href: '/history', label: 'History', icon: History },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];
function Shell({ children }: { children: ReactNode }) {
  const [path] = useLocation();
  useEffect(() => {
    const page = path === '/session' ? 'Camera workout' : path === '/history' ? 'Workout history' : path === '/settings' ? 'Settings' : 'Today';
    document.title = `${page} · Rep Accountability`;
  }, [path]);
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand" data-testid="link-brand"><span className="brand-mark">R</span><span>rep / accountability</span></Link>
      <nav className="nav-links" aria-label="Main navigation">
        {navItems.map(({ href, label }) => <Link href={href} key={href} className={`nav-link ${path === href ? 'active' : ''}`} data-testid={`link-nav-${label.toLowerCase()}`}>{label}</Link>)}
      </nav>
      <span className="small-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LockKeyhole size={12} /> video stays on device by default</span>
    </header>
    {children}
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={path === href ? 'active' : ''} data-testid={`mobile-nav-${label.toLowerCase()}`}><Icon size={18} />{label}</Link>)}
    </nav>
  </div>;
}

function Dashboard({ data }: { data: AppData }) {
  const today = new Date();
  const todays = data.sessions.filter((s) => localDay(new Date(s.startedAt)) === localDay(today));
  const thisWeek = weekSessions(data.sessions);
  const reps = todays.reduce((sum, s) => sum + s.reps, 0);
  const lifetimeReps = data.sessions.reduce((sum, s) => sum + s.reps, 0);
  const streak = getStreak(data.sessions);
  const goalProgress = Math.min(100, (thisWeek.length / data.weeklyWorkoutGoal) * 100);
  const hasToday = todays.length > 0;
  return <main className="page-wrap enter">
    <div className="eyebrow" data-testid="text-today-date">{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()}</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
      <div><h1 className="page-title">Show up.<br /><span style={{ color: 'var(--brand-orange)' }}>Count what counts.</span></h1>
        <p className="subtle" style={{ margin: '13px 0 0', fontSize: 14 }}>{hasToday ? 'You showed up today. Keep that promise to yourself.' : 'No story to tell yet. Just one honest set to begin.'}</p>
      </div>
      <Link href="/session" className="primary-btn" data-testid="button-start-workout"><Dumbbell size={17} /> Start a workout <ArrowRight size={16} /></Link>
    </div>

    <section className="panel" style={{ padding: 22, marginTop: 31, background: 'var(--brand-black)', color: 'var(--brand-white)', borderColor: 'var(--brand-black)', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', right: -30, top: -52, width: 210, height: 210, border: '1px solid rgba(255,255,255,.1)', borderRadius: '50%' }} />
      <div style={{ position: 'absolute', right: 7, top: -28, width: 155, height: 155, border: '1px solid rgba(255,255,255,.1)', borderRadius: '50%' }} />
      <div className="small-label" style={{ color: 'rgba(255,255,255,.72)' }}>TODAY'S CHECK-IN</div>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, marginTop: 14, position: 'relative' }}>
        <div><div className="font-display" style={{ fontSize: 31, lineHeight: 1.1 }} data-testid="status-today">{hasToday ? 'Promise kept.' : 'Your day is still yours.'}</div>
          <div style={{ color: 'rgba(255,255,255,.72)', fontSize: 12, marginTop: 8 }} data-testid="text-today-summary">{hasToday ? `${todays.length} session${todays.length === 1 ? '' : 's'} · ${reps} honest reps` : 'A few real reps are worth more than a perfect plan.'}</div></div>
        {hasToday && <div style={{ textAlign: 'right' }}><div className="mono-value" style={{ fontSize: 36, color: 'var(--brand-lime)' }} data-testid="value-today-reps">{reps}</div><div className="small-label" style={{ color: 'rgba(255,255,255,.72)' }}>REPS</div></div>}
      </div>
    </section>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13, marginTop: 14 }}>
      <div className="panel" style={{ padding: 19 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="small-label">THIS WEEK</span><Target size={16} color="var(--brand-orange)" /></div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 15 }}><span className="mono-value" style={{ fontSize: 33 }} data-testid="value-week-workouts">{thisWeek.length}</span><span className="subtle" style={{ fontSize: 12 }}>of {data.weeklyWorkoutGoal} workouts</span></div>
        <div className="phase-track" style={{ marginTop: 12 }}><span style={{ width: `${goalProgress}%` }} /></div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 9 }} data-testid="status-week-goal">{thisWeek.length >= data.weeklyWorkoutGoal ? 'You made your weekly mark.' : `${data.weeklyWorkoutGoal - thisWeek.length} more to meet your target`}</div>
      </div>
      <div className="panel" style={{ padding: 19 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="small-label">CURRENT STREAK</span><Sparkles size={16} color="var(--brand-orange)" /></div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 15 }}><span className="mono-value" style={{ fontSize: 33 }} data-testid="value-streak">{streak}</span><span className="subtle" style={{ fontSize: 12 }}>{streak === 1 ? 'day' : 'days'}</span></div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 9 }} data-testid="text-total-sessions">{data.sessions.length} workouts · {lifetimeReps} total reps</div>
      </div>
    </div>

    <section style={{ marginTop: 37 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <div><div className="eyebrow">KEEP IT SIMPLE</div><h2 className="font-display" style={{ margin: '5px 0 0', fontSize: 24 }}>Your recent work</h2></div>
        {data.sessions.length > 0 && <Link href="/history" style={{ color: 'var(--brand-black)', fontSize: 12, fontWeight: 800, textDecoration: 'none' }} data-testid="link-see-history">All history <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link>}
      </div>
      {data.sessions.length === 0 ? <div className="panel" style={{ padding: '22px 19px', display: 'flex', alignItems: 'center', gap: 15 }}>
        <div style={{ width: 43, height: 43, borderRadius: 14, background: 'var(--brand-lime)', display: 'grid', placeItems: 'center', color: 'var(--brand-black)' }}><Activity size={19} /></div>
        <div><div style={{ fontSize: 13, fontWeight: 800 }}>A clean slate. No invented numbers.</div><div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>Your first saved session will show up here.</div></div>
      </div> : <div style={{ display: 'grid', gap: 9 }}>{data.sessions.slice(0, 3).map((s) => <SessionRow key={s.id} session={s} />)}</div>}
    </section>
    <div style={{ marginTop: 27, padding: '13px 15px', borderLeft: '2px solid var(--brand-orange)', color: 'rgba(0,0,0,.7)', fontSize: 12, lineHeight: 1.6 }}>A rep only counts when you do it. The camera helps you keep an honest count; your video stays on this device unless you separately opt in to upload a short training clip. Pose samples are shared only if you opt in and label them.</div>
  </main>;
}

function SessionRow({ session }: { session: WorkoutSession }) {
  return <div className="panel" data-testid={`row-session-${session.id}`} style={{ padding: '15px 17px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><div style={{ width: 38, height: 38, background: 'var(--brand-lime)', borderRadius: 12, display: 'grid', placeItems: 'center', color: 'var(--brand-black)' }}><Dumbbell size={17} /></div><div><div style={{ fontSize: 13, fontWeight: 800 }}>{prettyExercise(session.exercise)}</div><div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>{fmtDate(session.startedAt)} · {formatDuration(session.durationSeconds)}</div></div></div>
    <div style={{ textAlign: 'right' }}><span className="mono-value" style={{ fontSize: 20 }}>{session.reps}</span><div className="small-label" style={{ fontSize: 8 }}>REPS</div></div>
  </div>;
}

function HistoryPage({ sessions, goal }: { sessions: WorkoutSession[]; goal: number }) {
  const [offset, setOffset] = useState(0);
  const monday = mondayStart(new Date()); monday.setDate(monday.getDate() + offset * 7);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const list = sessions.filter((s) => { const date = new Date(s.startedAt); const end = new Date(monday); end.setDate(end.getDate() + 7); return date >= monday && date < end; });
  const dayData = Array.from({ length: 7 }, (_, i) => { const date = new Date(monday); date.setDate(date.getDate() + i); const count = sessions.filter((s) => localDay(new Date(s.startedAt)) === localDay(date)).length; return { date, count }; });
  return <main className="page-wrap enter">
    <div className="eyebrow">THE RECEIPTS</div><h1 className="page-title">Work, remembered.</h1><p className="subtle" style={{ fontSize: 13, marginTop: 12 }}>Only sessions you completed and saved. Nothing filled in for you.</p>
    <section className="panel" style={{ padding: 20, marginTop: 27 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div><div className="small-label">WEEKLY RHYTHM</div><div style={{ fontWeight: 800, fontSize: 14, marginTop: 7 }} data-testid="text-week-range">{monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div>
        <div style={{ display: 'flex', gap: 5 }}><button className="secondary-btn" aria-label="Previous week" onClick={() => setOffset((v) => v - 1)} data-testid="button-week-previous" style={{ padding: 8 }}><ArrowLeft size={15} /></button><button className="secondary-btn" aria-label="Next week" disabled={offset >= 0} onClick={() => setOffset((v) => Math.min(0, v + 1))} data-testid="button-week-next" style={{ padding: 8, opacity: offset >= 0 ? .4 : 1 }}><ArrowRight size={15} /></button></div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginTop: 22 }}>
        {dayData.map(({ date, count }) => <div key={date.toISOString()} style={{ textAlign: 'center' }} data-testid={`day-activity-${date.getDay()}`}>
          <div className="small-label" style={{ fontSize: 8 }}>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2).toUpperCase()}</div>
          <div style={{ height: 38, borderRadius: 10, background: count ? 'var(--brand-lime)' : 'var(--brand-white)', border: '1px solid rgba(0,0,0,.12)', margin: '7px 0', color: 'var(--brand-black)', display: 'grid', placeItems: 'center' }}>{count ? <Check size={15} /> : <span style={{ fontSize: 11 }}>·</span>}</div>
          <div className="mono-value" style={{ fontSize: 9, color: 'rgba(0,0,0,.6)' }}>{date.getDate()}</div>
        </div>)}
      </div>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,.14)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="subtle" style={{ fontSize: 12 }} data-testid="text-weekly-total">{list.length} of {goal} workouts this week</span>
        <div style={{ display: 'flex', gap: 4 }}>{Array.from({ length: goal }, (_, i) => <span key={i} style={{ width: 15, height: 5, borderRadius: 4, background: i < list.length ? 'var(--brand-orange)' : 'rgba(0,0,0,.14)' }} />)}</div>
      </div>
    </section>
    <section style={{ marginTop: 32 }}>
      <div className="eyebrow">SESSION LOG</div><h2 className="font-display" style={{ fontSize: 27, margin: '6px 0 15px' }}>{offset === 0 ? 'This week' : 'Selected week'}</h2>
      {list.length ? <div style={{ display: 'grid', gap: 9 }}>{list.map((s) => <SessionRow session={s} key={s.id} />)}</div> :
        <div className="panel" style={{ padding: '27px 20px', textAlign: 'center' }}><div style={{ width: 48, height: 48, margin: '0 auto 13px', borderRadius: 16, background: 'var(--brand-lime)', color: 'var(--brand-black)', display: 'grid', placeItems: 'center' }}><History size={20} /></div><div style={{ fontWeight: 800, fontSize: 14 }} data-testid="empty-history-title">{offset > 0 ? 'That week is still blank.' : 'No sessions logged this week.'}</div><p className="subtle" style={{ fontSize: 12, margin: '7px 0 16px' }}>No pressure to backfill. Start where you are.</p><Link href="/session" className="secondary-btn" data-testid="button-history-start">Start a session <ArrowRight size={14} /></Link></div>}
    </section>
    {sessions.length > 0 && <div style={{ marginTop: 29, display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(0,0,0,.62)', fontSize: 11 }}><ShieldCheck size={14} /> These records are stored only in this browser.</div>}
  </main>;
}

function SettingsPage({ data, setGoal, clear }: { data: AppData; setGoal: (n: number) => void; clear: () => void }) {
  const [clearing, setClearing] = useState(false);
  const confirmClear = () => {
    if (!clearing) { setClearing(true); return; }
    clear(); setClearing(false);
  };
  return <main className="page-wrap enter">
    <div className="eyebrow">YOUR PRACTICE, YOUR RULES</div><h1 className="page-title">Set the terms.</h1><p className="subtle" style={{ fontSize: 13, marginTop: 12 }}>Keep the goal realistic enough to repeat.</p>
    <section className="panel" style={{ padding: 21, marginTop: 29 }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}><div style={{ width: 38, height: 38, background: 'var(--brand-lime)', color: 'var(--brand-black)', borderRadius: 12, display: 'grid', placeItems: 'center' }}><Target size={18} /></div><div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 14 }}>Weekly workout target</div><p className="subtle" style={{ fontSize: 12, margin: '5px 0 17px', lineHeight: 1.6 }}>How many days do you want to show up? You can change this whenever life changes.</p>
        <label htmlFor="weekly-goal" className="small-label">SESSIONS PER WEEK</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}><select id="weekly-goal" className="field" value={data.weeklyWorkoutGoal} onChange={(e) => setGoal(Number(e.target.value))} data-testid="select-weekly-goal" style={{ maxWidth: 130 }}>
          {[1,2,3,4,5,6,7].map((n) => <option value={n} key={n}>{n} {n === 1 ? 'day' : 'days'}</option>)}
        </select><span className="subtle" style={{ fontSize: 11 }}>Current target: {data.weeklyWorkoutGoal} per week</span></div>
      </div></div>
    </section>
    <section className="panel" style={{ padding: 21, marginTop: 13 }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}><div style={{ width: 38, height: 38, background: 'var(--brand-lime)', color: 'var(--brand-black)', borderRadius: 12, display: 'grid', placeItems: 'center' }}><LockKeyhole size={17} /></div><div><div style={{ fontWeight: 800, fontSize: 14 }}>Camera privacy</div><p className="subtle" style={{ fontSize: 12, lineHeight: 1.65, margin: '7px 0 13px' }}>Camera video is processed on this device for rep counting and is not uploaded or saved by default. Short training clips are a separate opt-in below, and each upload is your explicit choice. A session log stores only the exercise, rep count, start time and duration in this browser. Optional training-data sharing is off unless you turn it on below.</p><div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--brand-black)', fontSize: 11, fontWeight: 800 }}><ShieldCheck size={14} /> On-device by design</div></div></div>
    </section>
    <section className="panel" style={{ padding: 21, marginTop: 13, borderColor: clearing ? 'var(--brand-orange)' : undefined }}>
      <div style={{ display: 'flex', gap: 13, alignItems: 'flex-start' }}><div style={{ width: 38, height: 38, background: 'var(--brand-orange)', color: 'var(--brand-black)', borderRadius: 12, display: 'grid', placeItems: 'center' }}><Trash2 size={17} /></div><div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 14 }}>Clear workout history</div><p className="subtle" style={{ fontSize: 12, margin: '6px 0 14px', lineHeight: 1.6 }}>{clearing ? 'This permanently removes all saved sessions from this browser. Your weekly target stays.' : `${data.sessions.length} saved session${data.sessions.length === 1 ? '' : 's'} currently stored here.`}</p>
        {clearing ? <div style={{ display: 'flex', gap: 8 }}><button className="secondary-btn" onClick={() => setClearing(false)} data-testid="button-cancel-clear">Keep my history</button><button className="secondary-btn danger-btn" onClick={confirmClear} data-testid="button-confirm-clear">Clear sessions</button></div> :
          <button className="secondary-btn danger-btn" onClick={confirmClear} data-testid="button-clear-history" disabled={data.sessions.length === 0}><Trash2 size={14} /> Clear local history</button>}
      </div></div>
    </section>
    <ContributionSettings />
    <VideoSettings />
    <div style={{ marginTop: 25, color: 'rgba(0,0,0,.62)', fontSize: 11, display: 'flex', gap: 7, alignItems: 'center' }}><CircleHelp size={14} /> Your workout history stays on this device unless you clear browser storage.</div>
  </main>;
}

function SessionPage({ save }: { save: (session: WorkoutSession) => void }) {
  const [, setLocation] = useLocation();
  const [exercise, setExercise] = useState<Exercise>('squat');
  const [cameraState, setCameraState] = useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [modelState, setModelState] = useState<'waiting'|'loading'|'ready'|'error'>('waiting');
  const [error, setError] = useState('');
  const [reps, setReps] = useState(0);
  const [phase, setPhase] = useState('Get in frame');
  const [facing, setFacing] = useState<'user'|'environment'>('user');
  const [elapsed, setElapsed] = useState(0);
  const [startedAt, setStartedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const landmarkerRef = useRef<{ detectForVideo: (video: HTMLVideoElement, timestamp: number) => { landmarks?: Landmark[][] }; close: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const trackerRef = useRef<ExerciseTracker | null>(null);
  const lastProcessedAt = useRef(-Infinity);
  const repRef = useRef(0);
  const startRef = useRef<number | null>(null);
  const generationRef = useRef(0);
  const lastVideoTime = useRef(-1);
  const captureRef = useRef(new RepCapture());
  const [ended, setEnded] = useState(false);
  const clipPendingRef = useRef(false);
  const [clipPending, setClipPending] = useState(false);
  const onClipPending = useCallback((p: boolean) => { clipPendingRef.current = p; setClipPending(p); }, []);
  const getStream = useCallback(() => streamRef.current, []);
  const getReps = useCallback(() => repRef.current, []);
  const queueItems = useQueue();
  useEffect(() => () => clearQueue(), []);

  const stopDetection = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    landmarkerRef.current?.close(); landmarkerRef.current = null;
  }, []);
  const stopCamera = useCallback(() => {
    generationRef.current += 1;
    captureRef.current.reset();
    trackerRef.current?.reset();
    stopDetection();
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, [stopDetection]);
  useEffect(() => () => stopCamera(), [stopCamera]);
  useEffect(() => {
    if (startRef.current === null || cameraState !== 'ready') return;
    const interval = window.setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current!) / 1000)), 500);
    return () => window.clearInterval(interval);
  }, [cameraState]);

  const runLoop = useCallback(() => {
    const video = videoRef.current;
    const model = landmarkerRef.current;
    const tracker = trackerRef.current;
    if (!video || !model || !tracker) return;
    const now = performance.now();
    if (video.readyState < 2 || video.currentTime === lastVideoTime.current || now - lastProcessedAt.current < 66) { rafRef.current = requestAnimationFrame(runLoop); return; }
    lastProcessedAt.current = now;
    lastVideoTime.current = video.currentTime;
    try {
      const result = model.detectForVideo(video, now);
      const landmarks = result.landmarks?.[0];
      const aspect = video.videoWidth / video.videoHeight;
      const movement = tracker.update(landmarks, aspect, now);
      const collecting = getConsent().enabled && !isFull();
      if (collecting && landmarks) captureRef.current.observePhase(landmarks, exercise, movement.phase, now, aspect);
      else captureRef.current.reset();
      setPhase(movement.text);
      if (movement.counted) {
        repRef.current += 1; setReps(repRef.current);
        const sample = collecting ? captureRef.current.finishRep(exercise) : null;
        if (sample) enqueue(sample);
      }
    } catch {
      stopCamera(); setCameraState('error'); setModelState('error');
      setError('Pose tracking stopped. Please restart the camera and keep your body in view.'); return;
    }
    rafRef.current = requestAnimationFrame(runLoop);
  }, [exercise, stopCamera]);

  const begin = useCallback(async (nextFacing: 'user'|'environment' = facing, preserveSession = false) => {
    if (ended) return;
    stopCamera();
    const generation = generationRef.current;
    setError(''); setCameraState('loading'); setModelState('loading'); setPhase('Loading on-device pose model…');
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraState('error'); setModelState('error'); setError('Camera access requires a secure browser context (HTTPS or localhost) and a browser that supports camera input.'); return;
    }
    let modelReady = false;
    try {
      const [vision, classifier] = await Promise.all([import('@mediapipe/tasks-vision'), loadClassifier()]);
      const fileset = await vision.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm');
      if (generation !== generationRef.current) return;
      const options = {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task' },
        runningMode: 'VIDEO' as const, numPoses: 1, minPoseDetectionConfidence: .55, minTrackingConfidence: .5,
      };
      let landmarker;
      try {
        landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        if (generation !== generationRef.current) return;
        landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
          ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
      }
      if (generation !== generationRef.current) { landmarker.close(); return; }
      landmarkerRef.current = landmarker;
      trackerRef.current = new ExerciseTracker(classifier, exercise);
      modelReady = true;
      setModelState('ready');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: nextFacing }, width: { ideal: 960 }, height: { ideal: 720 } } });
      if (generation !== generationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      streamRef.current = stream;
      setFacing(nextFacing);
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); }
      if (generation !== generationRef.current) return;
      if (!preserveSession) {
        const now = new Date(); setStartedAt(now.toISOString()); startRef.current = Date.now(); setElapsed(0);
        repRef.current = 0; setReps(0); setEnded(false);
      }
      captureRef.current.reset();
      trackerRef.current.reset(); lastProcessedAt.current = -Infinity; lastVideoTime.current = -1;
      setCameraState('ready'); setPhase('Ready · find your starting position');
      rafRef.current = requestAnimationFrame(runLoop);
    } catch (err) {
      if (generation !== generationRef.current) return;
      stopCamera(); setCameraState('error'); setModelState(modelReady ? 'ready' : 'error');
      const name = err instanceof Error ? err.name : '';
      setError(name === 'NotAllowedError' ? 'Camera permission was declined. Allow camera access in your browser settings, then try again.' :
        name === 'NotFoundError' ? 'No camera was found on this device.' :
        name === 'NotReadableError' ? 'Your camera is already in use by another app.' :
        'The camera, on-device pose model, or exercise examples could not load. Check your connection for the initial download, then try again.');
    }
  }, [ended, exercise, facing, runLoop, stopCamera]);

  const flagMissed = () => {
    const sample = captureRef.current.snapshotMissed(exercise);
    if (!sample) return 'Not enough recent movement was captured yet. Try again after a few more seconds.';
    return enqueue(sample) ? null : 'Queue is full. Label or discard a sample first.';
  };
  const switchCamera = async () => {
    const next = facing === 'user' ? 'environment' : 'user';
    await begin(next, true);
  };
  const finish = () => {
    setSaving(true);
    const finalReps = repRef.current;
    const began = startedAt;
    const durationSeconds = startRef.current === null ? 0 : Math.max(0, Math.floor((Date.now() - startRef.current) / 1000));
    stopCamera();
    if (finalReps > 0 && began) save({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, exercise, reps: finalReps, startedAt: began, durationSeconds });
    if (getQueue().length > 0 || clipPendingRef.current) { setCameraState('idle'); setModelState('waiting'); setSaving(false); setEnded(true); return; }
    setLocation('/');
  };

  return <main className="page-wrap enter" style={{ maxWidth: 760 }}>
    <Link href="/" className="nav-link" data-testid="link-session-back" style={{ paddingLeft: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={14} /> Back to today</Link>
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 18, flexWrap: 'wrap' }}>
      <div><div className="eyebrow">LIVE SESSION · ON-DEVICE</div><h1 className="page-title" style={{ marginBottom: 0 }}>One rep at a time.</h1></div>
      {cameraState === 'ready' && <div style={{ textAlign: 'right' }}><div className="small-label">SESSION TIME</div><div className="mono-value" style={{ fontSize: 23, marginTop: 4 }} data-testid="value-session-duration">{formatDuration(elapsed)}</div></div>}
    </div>
    <div style={{ display: 'flex', gap: 7, marginTop: 21 }} role="group" aria-label="Choose exercise">
      {(['squat','push-up'] as Exercise[]).map((type) => <button key={type} disabled={ended || cameraState === 'ready' || cameraState === 'loading'} onClick={() => { setExercise(type); setPhase('Get in frame'); }} className={exercise === type ? 'primary-btn' : 'secondary-btn'} data-testid={`button-exercise-${type}`} style={{ padding: '11px 14px', fontSize: 11 }}><Dumbbell size={14} />{prettyExercise(type)}</button>)}
    </div>
    <div className="camera-frame" style={{ marginTop: 14 }}>
      <video ref={videoRef} muted playsInline aria-label="Live camera preview" className={facing === 'environment' ? 'back-camera' : ''} data-testid="video-camera-preview" />
      {cameraState !== 'ready' && <div className="camera-idle">
        <div className="camera-idle-mark">{cameraState === 'error' ? <CameraOff size={26} /> : cameraState === 'loading' ? <Activity size={26} /> : <Video size={26} />}</div>
        <div className="font-display" style={{ fontSize: 22 }}>{cameraState === 'error' ? 'We couldn’t get you on camera.' : cameraState === 'loading' ? 'Getting your session ready…' : 'A clear side view works best.'}</div>
        <div style={{ color: 'rgba(255,255,255,.76)', fontSize: 11, maxWidth: 310, lineHeight: 1.6, marginTop: 8 }}>{ended ? 'Camera off. Review your samples below, then return to today.' : cameraState === 'idle' ? `Choose ${exercise === 'squat' ? 'squats' : 'push-ups'}, then allow camera access. Keep shoulders, hips, hands and feet in frame. Video stays local unless you upload a training clip.` : cameraState === 'loading' ? 'Loading the pose model and exercise examples, then requesting camera permission.' : error}</div>
        {cameraState === 'idle' && !ended && <button onClick={() => void begin()} className="primary-btn" data-testid="button-enable-camera" style={{ marginTop: 18, background: 'var(--brand-lime)', color: 'var(--brand-black)' }}><Camera size={16} /> Allow camera & begin</button>}
        {cameraState === 'error' && <button onClick={() => void begin(facing, startRef.current !== null)} className="primary-btn" data-testid="button-retry-camera" style={{ marginTop: 16 }}><RotateCcw size={15} /> Try again</button>}
      </div>}
      {cameraState === 'ready' && <><div className="camera-overlay" /><div className="camera-pill"><span className="live-dot" /> CAMERA LIVE · LOCAL ONLY</div><div className="session-controls"><button className="camera-control" onClick={() => void switchCamera()} title="Switch camera" aria-label="Switch camera" data-testid="button-switch-camera"><RotateCcw size={16} /></button></div><div style={{ position: 'absolute', left: 15, bottom: 14, color: 'var(--brand-white)', fontSize: 11 }} data-testid="status-pose">{phase}</div></>}
      {cameraState !== 'ready' && <div className="camera-pill"><span className="live-dot" style={{ background: cameraState === 'error' ? 'var(--brand-orange)' : 'var(--brand-lime)' }} />{cameraState === 'error' ? 'CAMERA OFFLINE' : modelState === 'loading' ? 'PREPARING MODEL' : 'CAMERA NOT STARTED'}</div>}
    </div>
    {error && cameraState === 'error' && <div role="alert" data-testid="status-camera-error" style={{ marginTop: 10, color: 'var(--brand-black)', background: 'var(--brand-orange)', border: '1px solid var(--brand-black)', padding: '12px 14px', borderRadius: 11, fontSize: 12, lineHeight: 1.5 }}>{error}</div>}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 13 }}>
      <div className="panel" style={{ padding: 17 }}><div className="small-label">REPS COUNTED</div><div className="mono-value" style={{ fontSize: 43, lineHeight: 1.15, marginTop: 5 }} data-testid="value-live-reps">{reps}</div></div>
      <div className="panel" style={{ padding: 17 }}><div className="small-label">MOVEMENT PHASE</div><div style={{ fontWeight: 800, fontSize: 15, marginTop: 12, minHeight: 22 }} data-testid="status-movement-phase">{phase}</div><div className="subtle" style={{ fontSize: 10, marginTop: 5 }} data-testid="status-model">{modelState === 'ready' ? 'Google pose examples · local classifier' : modelState === 'error' ? 'Pose model unavailable' : modelState === 'loading' ? 'Loading pose model…' : 'Waiting for camera permission'}</div></div>
    </div>
    <div className="panel" style={{ padding: 18, marginTop: 13 }}>
      <div className="small-label">WHAT COUNTS AS A REP</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        {(exercise === 'squat' ? ['Stand tall', 'Lower with control', 'Stand tall again'] : ['High plank', 'Lower your body', 'Push back up']).map((label, i) => <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 22, height: 22, borderRadius: 8, background: i === 1 ? 'var(--brand-lime)' : 'var(--brand-white)', border: '1px solid rgba(0,0,0,.14)', color: 'var(--brand-black)', display: 'grid', placeItems: 'center', font: '10px var(--app-font-mono)' }}>{i + 1}</span><span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>{i < 2 && <ArrowRight size={12} color="var(--brand-orange)" />}</div>)}
      </div>
      <p className="subtle" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 12 }}>Matches your pose to Google's labeled squat and push-up examples, smooths the results, and counts an up → down → up cycle. <a href="https://github.com/google-ai-edge/mediapipe/blob/master/docs/solutions/pose_classification.md" target="_blank" rel="noreferrer" style={{ color: 'inherit' }}>About the reference approach</a>. Camera framing still affects recognition.</p>
    </div>
    <TrainingClipRecorder exercise={exercise} cameraActive={cameraState === 'ready'} getStream={getStream} getReps={getReps} onPendingChange={onClipPending} />
    <ReviewQueue canFlag={cameraState === 'ready'} onFlagMissed={flagMissed} />
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, color: 'rgba(0,0,0,.7)', fontSize: 10, lineHeight: 1.55 }}><LockKeyhole size={13} style={{ flexShrink: 0, marginTop: 1 }} /> Camera permission is required. Camera video is not uploaded by default; pose tracking runs on-device. Training clips and pose samples are separate opt-ins, and nothing uploads without your explicit action. Camera access requires HTTPS or localhost. The model loads from the web on first use.</div>
    {ended && <div role="status" data-testid="status-session-ended" style={{ marginTop: 14, padding: '12px 14px', borderLeft: '3px solid var(--brand-lime)', fontSize: 12 }}>Camera off. {reps > 0 ? 'Workout saved.' : 'No reps were counted, so no workout was saved.'} {queueItems.length} sample{queueItems.length === 1 ? '' : 's'} left to label or discard.{clipPending ? ' A training clip is waiting for you to upload or discard it.' : ''} They disappear when you leave this page.</div>}
    {ended ? <Link href="/" className="primary-btn" data-testid="link-session-done" style={{ width: '100%', marginTop: 20, background: 'var(--brand-black)', color: 'var(--brand-white)' }}>Done, back to today</Link> : <button className="primary-btn" onClick={finish} disabled={(cameraState !== 'ready' && reps === 0) || saving} data-testid="button-end-save-session" style={{ width: '100%', marginTop: 20, background: reps > 0 ? 'var(--brand-black)' : 'var(--brand-white)', color: reps > 0 ? 'var(--brand-white)' : 'var(--brand-black)' }}>
      {reps > 0 ? <><Check size={16} /> End & save {reps} {reps === 1 ? 'rep' : 'reps'}</> : <><X size={16} /> End session · no reps to save</>}
    </button>}
    <div className="subtle" style={{ textAlign: 'center', fontSize: 10, marginTop: 9 }}>{cameraState !== 'ready' ? 'Start the camera to begin a session.' : reps > 0 ? 'Your workout is saved only when you end this session.' : 'Sessions with zero reps are not added to your history.'}</div>
  </main>;
}

function NotFound() {
  return <main className="page-wrap"><div className="eyebrow">NOT HERE</div><h1 className="page-title">Lost your rhythm?</h1><Link href="/" className="primary-btn" data-testid="link-not-found-home">Back to today <ArrowRight size={15} /></Link></main>;
}

function AppRoutes() {
  const { data, save, setGoal, clear } = useAppData();
  return <Shell><Switch>
    <Route path="/"><Dashboard data={data} /></Route>
    <Route path="/session"><SessionPage save={save} /></Route>
    <Route path="/history"><HistoryPage sessions={data.sessions} goal={data.weeklyWorkoutGoal} /></Route>
    <Route path="/settings"><SettingsPage data={data} setGoal={setGoal} clear={clear} /></Route>
    <Route><NotFound /></Route>
  </Switch></Shell>;
}

function App() {
  return <QueryClientProvider client={queryClient}><AppRoutes /></QueryClientProvider>;
}

export default App;
