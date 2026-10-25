import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Route, Router, Switch, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import {
  Activity, ArrowLeft, ArrowRight, Check, Database, Download, Dumbbell, History,
  LockKeyhole, Settings2, Sparkles, Target, Trash2, Upload, Volume2,
} from 'lucide-react';
import {
  clearSessions, downloadJson, importAppData, setGoal, updateSettings, useAppData, useSettings,
  type RepSound, type WorkoutSession,
} from './data/store.ts';
import { clearPoseLogs, listPoseLogs, usePoseLogSummary } from './data/poseLogs.ts';
import { EXERCISES } from './tracking/exercises.ts';
import { SessionPage } from './session/SessionPage.tsx';

const localDay = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const mondayStart = (date: Date) => {
  const d = new Date(date); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d;
};
const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const prettyExercise = (e: WorkoutSession['exercise']) => e === 'bicep-curl' ? 'Bicep curls (old)' : EXERCISES[e].label;
const fmtDate = (v: string) => new Date(v).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

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
    const page = path === '/session' ? 'Workout' : path === '/history' ? 'History' : path === '/settings' ? 'Settings' : 'Today';
    document.title = `${page} · Overachiever`;
    window.scrollTo(0, 0);
  }, [path]);
  return <div className="app-shell">
    <header className="topbar">
      <Link href="/" className="brand"><span className="brand-mark">O</span><span>overachiever</span></Link>
      <nav className="nav-links" aria-label="Main navigation">
        {navItems.map(({ href, label }) => <Link href={href} key={href} className={`nav-link ${path === href ? 'active' : ''}`}>{label}</Link>)}
      </nav>
      <span className="small-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><LockKeyhole size={12} /> on this phone only</span>
    </header>
    {children}
    {path !== '/session' && <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} className={path === href ? 'active' : ''}><Icon size={18} />{label}</Link>)}
    </nav>}
  </div>;
}

function SessionRow({ session }: { session: WorkoutSession }) {
  const missed = session.countedReps !== undefined && session.countedReps !== session.reps;
  return <div className="panel" style={{ padding: '15px 17px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div className="icon-tile"><Dumbbell size={17} /></div>
      <div><div style={{ fontSize: 13, fontWeight: 800 }}>{prettyExercise(session.exercise)}</div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>{fmtDate(session.startedAt)} · {formatDuration(session.durationSeconds)}{missed ? ` · camera counted ${session.countedReps}` : ''}</div></div>
    </div>
    <div style={{ textAlign: 'right' }}><span className="mono-value" style={{ fontSize: 20 }}>{session.reps}</span><div className="small-label" style={{ fontSize: 8 }}>REPS</div></div>
  </div>;
}

function Dashboard() {
  const data = useAppData();
  const today = new Date();
  const todays = data.sessions.filter((s) => localDay(new Date(s.startedAt)) === localDay(today));
  const thisWeek = weekSessions(data.sessions);
  const reps = todays.reduce((sum, s) => sum + s.reps, 0);
  const lifetimeReps = data.sessions.reduce((sum, s) => sum + s.reps, 0);
  const streak = getStreak(data.sessions);
  const goalProgress = Math.min(100, (thisWeek.length / data.weeklyWorkoutGoal) * 100);
  const hasToday = todays.length > 0;
  return <main className="page-wrap enter">
    <div className="eyebrow">{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap', marginTop: 12 }}>
      <div><h1 className="page-title">Show up.<br /><span style={{ color: 'var(--brand-orange)' }}>Count what counts.</span></h1>
        <p className="subtle" style={{ margin: '13px 0 0', fontSize: 14 }}>{hasToday ? 'You showed up today. Keep that promise to yourself.' : 'Nothing yet today. One honest set to begin.'}</p></div>
      <Link href="/session" className="primary-btn"><Dumbbell size={17} /> Start a workout <ArrowRight size={16} /></Link>
    </div>

    <section className="panel hero-panel">
      <div className="small-label" style={{ color: 'rgba(255,255,255,.72)' }}>TODAY’S CHECK-IN</div>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, marginTop: 14 }}>
        <div><div className="font-display" style={{ fontSize: 31, lineHeight: 1.1 }}>{hasToday ? 'Promise kept.' : 'Your day is still yours.'}</div>
          <div style={{ color: 'rgba(255,255,255,.72)', fontSize: 12, marginTop: 8 }}>{hasToday ? `${todays.length} session${todays.length === 1 ? '' : 's'} · ${reps} reps` : 'A few real reps beat a perfect plan.'}</div></div>
        {hasToday && <div style={{ textAlign: 'right' }}><div className="mono-value" style={{ fontSize: 36, color: 'var(--brand-lime)' }}>{reps}</div><div className="small-label" style={{ color: 'rgba(255,255,255,.72)' }}>REPS</div></div>}
      </div>
    </section>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 13, marginTop: 14 }}>
      <div className="panel" style={{ padding: 19 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="small-label">THIS WEEK</span><Target size={16} color="var(--brand-orange)" /></div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 15 }}><span className="mono-value" style={{ fontSize: 33 }}>{thisWeek.length}</span><span className="subtle" style={{ fontSize: 12 }}>of {data.weeklyWorkoutGoal}</span></div>
        <div className="phase-track" style={{ marginTop: 12 }}><span style={{ width: `${goalProgress}%` }} /></div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 9 }}>{thisWeek.length >= data.weeklyWorkoutGoal ? 'Weekly target hit.' : `${data.weeklyWorkoutGoal - thisWeek.length} more to hit your target`}</div>
      </div>
      <div className="panel" style={{ padding: 19 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span className="small-label">STREAK</span><Sparkles size={16} color="var(--brand-orange)" /></div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 15 }}><span className="mono-value" style={{ fontSize: 33 }}>{streak}</span><span className="subtle" style={{ fontSize: 12 }}>{streak === 1 ? 'day' : 'days'}</span></div>
        <div className="subtle" style={{ fontSize: 11, marginTop: 9 }}>{data.sessions.length} workouts · {lifetimeReps} total reps</div>
      </div>
    </div>

    <section style={{ marginTop: 37 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 }}>
        <h2 className="font-display" style={{ margin: 0, fontSize: 24 }}>Recent work</h2>
        {data.sessions.length > 0 && <Link href="/history" className="text-link">All history <ArrowRight size={13} style={{ verticalAlign: 'middle' }} /></Link>}
      </div>
      {data.sessions.length === 0
        ? <div className="panel" style={{ padding: '22px 19px', display: 'flex', alignItems: 'center', gap: 15 }}>
          <div className="icon-tile"><Activity size={19} /></div>
          <div><div style={{ fontSize: 13, fontWeight: 800 }}>A clean slate.</div><div className="subtle" style={{ fontSize: 12, marginTop: 4 }}>Your first saved session shows up here.</div></div>
        </div>
        : <div style={{ display: 'grid', gap: 9 }}>{data.sessions.slice(0, 3).map((s) => <SessionRow key={s.id} session={s} />)}</div>}
    </section>
  </main>;
}

function HistoryPage() {
  const { sessions, weeklyWorkoutGoal: goal } = useAppData();
  const [offset, setOffset] = useState(0);
  const monday = mondayStart(new Date()); monday.setDate(monday.getDate() + offset * 7);
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6);
  const list = weekSessions(sessions, monday);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(monday); date.setDate(date.getDate() + i);
    return { date, count: sessions.filter((s) => localDay(new Date(s.startedAt)) === localDay(date)).length };
  });
  return <main className="page-wrap enter">
    <div className="eyebrow">THE RECEIPTS</div><h1 className="page-title">Work, remembered.</h1>
    <section className="panel" style={{ padding: 20, marginTop: 27 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <div><div className="small-label">WEEK</div><div style={{ fontWeight: 800, fontSize: 14, marginTop: 7 }}>{monday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {sunday.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div></div>
        <div style={{ display: 'flex', gap: 5 }}>
          <button className="secondary-btn" aria-label="Previous week" onClick={() => setOffset((v) => v - 1)} style={{ padding: 8 }}><ArrowLeft size={15} /></button>
          <button className="secondary-btn" aria-label="Next week" disabled={offset >= 0} onClick={() => setOffset((v) => Math.min(0, v + 1))} style={{ padding: 8, opacity: offset >= 0 ? .4 : 1 }}><ArrowRight size={15} /></button>
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 5, marginTop: 22 }}>
        {days.map(({ date, count }) => <div key={date.toISOString()} style={{ textAlign: 'center' }}>
          <div className="small-label" style={{ fontSize: 8 }}>{date.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2).toUpperCase()}</div>
          <div className={`day-cell${count ? ' done' : ''}`}>{count ? <Check size={15} /> : '·'}</div>
          <div className="mono-value" style={{ fontSize: 9, color: 'rgba(0,0,0,.6)' }}>{date.getDate()}</div>
        </div>)}
      </div>
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,.14)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="subtle" style={{ fontSize: 12 }}>{list.length} of {goal} workouts</span>
        <div style={{ display: 'flex', gap: 4 }}>{Array.from({ length: goal }, (_, i) => <span key={i} style={{ width: 15, height: 5, borderRadius: 4, background: i < list.length ? 'var(--brand-orange)' : 'rgba(0,0,0,.14)' }} />)}</div>
      </div>
    </section>
    <section style={{ marginTop: 32 }}>
      <h2 className="font-display" style={{ fontSize: 27, margin: '0 0 15px' }}>{offset === 0 ? 'This week' : 'That week'}</h2>
      {list.length
        ? <div style={{ display: 'grid', gap: 9 }}>{list.map((s) => <SessionRow session={s} key={s.id} />)}</div>
        : <div className="panel" style={{ padding: '27px 20px', textAlign: 'center' }}>
          <div style={{ fontWeight: 800, fontSize: 14 }}>Nothing logged{offset === 0 ? ' yet this week' : ''}.</div>
          <Link href="/session" className="secondary-btn" style={{ marginTop: 14 }}>Start a session <ArrowRight size={14} /></Link>
        </div>}
    </section>
  </main>;
}

function SettingsPage() {
  const data = useAppData();
  const prefs = useSettings();
  const poseLogs = usePoseLogSummary();
  const [confirm, setConfirm] = useState<'history' | 'pose' | null>(null);
  const [notice, setNotice] = useState<{ bad: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportPose = async () => {
    const logs = await listPoseLogs();
    downloadJson(`overachiever-pose-logs-${stamp()}.json`, { format: 'overachiever-pose-logs-v1', exportedAt: new Date().toISOString(), logs });
  };
  const importHistory = async (file: File | undefined) => {
    if (!file) return;
    try {
      const added = importAppData(JSON.parse(await file.text()));
      setNotice({ bad: false, text: `Imported ${added} session${added === 1 ? '' : 's'}.` });
    } catch {
      setNotice({ bad: true, text: 'That file isn’t a history export from this app.' });
    }
    if (fileRef.current) fileRef.current.value = '';
  };
  const sounds: { id: RepSound; label: string }[] = [{ id: 'voice', label: 'Say the count' }, { id: 'beep', label: 'Beep' }, { id: 'off', label: 'Silent' }];

  return <main className="page-wrap enter">
    <div className="eyebrow">YOUR RULES</div><h1 className="page-title">Set the terms.</h1>

    <section className="panel setting">
      <div className="icon-tile"><Target size={18} /></div>
      <div style={{ flex: 1 }}>
        <div className="setting-title">Weekly workout target</div>
        <p className="subtle setting-text">How many days a week do you want to show up?</p>
        <select className="field" value={data.weeklyWorkoutGoal} onChange={(e) => setGoal(Number(e.target.value))} style={{ maxWidth: 140 }}>
          {[1, 2, 3, 4, 5, 6, 7].map((n) => <option value={n} key={n}>{n} {n === 1 ? 'day' : 'days'}</option>)}
        </select>
      </div>
    </section>

    <section className="panel setting">
      <div className="icon-tile"><Volume2 size={18} /></div>
      <div style={{ flex: 1 }}>
        <div className="setting-title">During a workout</div>
        <p className="subtle setting-text">A sound on each rep, so you don’t have to look at the phone.</p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {sounds.map((s) => <button key={s.id} className={prefs.repSound === s.id ? 'primary-btn' : 'secondary-btn'} style={{ padding: '10px 13px', fontSize: 12 }} onClick={() => updateSettings({ repSound: s.id })}>{s.label}</button>)}
        </div>
        <label style={{ display: 'flex', gap: 9, alignItems: 'center', marginTop: 14, fontSize: 12 }}>
          <input type="checkbox" checked={prefs.showTracking} onChange={(e) => updateSettings({ showTracking: e.target.checked })} style={{ accentColor: '#000' }} />
          Show tracking numbers under the camera
        </label>
      </div>
    </section>

    <section className="panel setting">
      <div className="icon-tile"><Database size={18} /></div>
      <div style={{ flex: 1 }}>
        <div className="setting-title">Pose data for tuning the tracker</div>
        <p className="subtle setting-text">Joint positions from each workout (no video), kept on this phone, last 30 sessions. Export the file and replay it against tracker changes to see if counts get closer to what you actually did.</p>
        <label style={{ display: 'flex', gap: 9, alignItems: 'center', fontSize: 12 }}>
          <input type="checkbox" checked={prefs.keepPoseData} onChange={(e) => updateSettings({ keepPoseData: e.target.checked })} style={{ accentColor: '#000' }} />
          Keep pose data by default
        </label>
        <div className="subtle" style={{ fontSize: 12, marginTop: 12 }}>
          {poseLogs === null ? 'Loading…' : poseLogs.count === 0 ? 'No sessions saved yet.' :
            `${poseLogs.count} saved: ${Object.entries(poseLogs.byExercise).map(([e, n]) => `${n} ${EXERCISES[e as keyof typeof EXERCISES].label.toLowerCase()}`).join(', ')}`}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          <button className="secondary-btn" disabled={!poseLogs?.count} onClick={() => void exportPose()}><Download size={14} /> Export pose data</button>
          {confirm === 'pose'
            ? <button className="secondary-btn danger-btn" onClick={() => { void clearPoseLogs(); setConfirm(null); }}>Yes, delete all</button>
            : <button className="secondary-btn" disabled={!poseLogs?.count} onClick={() => setConfirm('pose')}><Trash2 size={14} /> Delete</button>}
        </div>
      </div>
    </section>

    <section className="panel setting">
      <div className="icon-tile"><History size={18} /></div>
      <div style={{ flex: 1 }}>
        <div className="setting-title">Workout history</div>
        <p className="subtle setting-text">{data.sessions.length} sessions, stored in this browser only. Export a backup now and then, and use it to move to a new phone.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="secondary-btn" disabled={!data.sessions.length} onClick={() => downloadJson(`overachiever-history-${stamp()}.json`, data)}><Download size={14} /> Export</button>
          <button className="secondary-btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Import</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importHistory(e.target.files?.[0])} />
          {confirm === 'history'
            ? <><button className="secondary-btn" onClick={() => setConfirm(null)}>Keep it</button><button className="secondary-btn danger-btn" onClick={() => { clearSessions(); setConfirm(null); }}>Yes, clear history</button></>
            : <button className="secondary-btn" disabled={!data.sessions.length} onClick={() => setConfirm('history')}><Trash2 size={14} /> Clear</button>}
        </div>
        {notice && <div className={`notice${notice.bad ? ' bad' : ''}`}>{notice.text}</div>}
      </div>
    </section>

    <p className="subtle" style={{ fontSize: 11, lineHeight: 1.6, marginTop: 22, display: 'flex', gap: 8 }}>
      <LockKeyhole size={14} style={{ flexShrink: 0, marginTop: 2 }} />
      There’s no server. Pose detection runs on your phone, the camera feed never leaves it, and everything you save stays in this browser until you export it.
    </p>
  </main>;
}

function NotFound() {
  return <main className="page-wrap"><h1 className="page-title">Lost your rhythm?</h1><Link href="/" className="primary-btn">Back to today <ArrowRight size={15} /></Link></main>;
}

export default function App() {
  useEffect(() => { void navigator.storage?.persist?.().catch(() => undefined); }, []);
  return <Router hook={useHashLocation}>
    <Shell><Switch>
      <Route path="/"><Dashboard /></Route>
      <Route path="/session"><SessionPage /></Route>
      <Route path="/history"><HistoryPage /></Route>
      <Route path="/settings"><SettingsPage /></Route>
      <Route><NotFound /></Route>
    </Switch></Shell>
  </Router>;
}
