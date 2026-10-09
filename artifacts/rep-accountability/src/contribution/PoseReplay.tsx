import { useEffect, useId, useState } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import type { Sample } from './queue';
import { replayPose } from './replay';

const PHASE_NAMES = { stand: 'Extended', lower: 'Lowering', bottom: 'Bent', return: 'Returning', unknown: 'Tracking uncertain' };

export function PoseReplay({ sample, sampleId }: { sample: Sample; sampleId: string }) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const titleId = useId();
  const duration = sample.frames[sample.frames.length - 1]?.offsetMs ?? 0;
  const pose = replayPose(sample.frames, time);
  const aspect = Number.isFinite(sample.aspectRatio) ? Math.max(.2, Math.min(5, sample.aspectRatio)) : 1;
  const width = 300 * aspect;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let previous: number | null = null;
    const tick = (now: number) => {
      const delta = previous === null ? 0 : now - previous;
      if (delta > 0) setTime((current) => Math.min(duration, current + delta));
      previous = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);
  useEffect(() => { if (time >= duration) setPlaying(false); }, [time, duration]);

  if (!pose) return <p className="subtle">No joint coordinates available for replay.</p>;
  const connections = sample.exercise === 'squat'
    ? [[23, 25], [25, 27], [24, 26], [26, 28], [23, 24]]
    : [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12]];
  const point = (index: number) => pose.landmarks.find((p) => p.index === index);
  const play = () => { if (time >= duration) setTime(0); setPlaying((value) => !value); };

  return <div data-testid={`replay-${sampleId}`} style={{ marginTop: 12 }}>
    <div className="small-label" style={{ marginBottom: 7 }}>JOINT-ONLY REPLAY · STAYS LOCAL</div>
    <svg role="img" aria-labelledby={titleId} viewBox={`-12 -12 ${width + 24} 324`}
      style={{ display: 'block', width: '100%', height: 190, background: 'var(--brand-black)', borderRadius: 10 }}>
      <title id={titleId}>{sample.exercise === 'squat' ? 'Hip, knee and ankle' : 'Shoulder, elbow and wrist'} movement replay</title>
      {connections.map(([a, b]) => {
        const from = point(a!); const to = point(b!);
        if (!from || !to) return null;
        const uncertain = Math.min(from.visibility, to.visibility) < .65;
        return <line key={`${a}-${b}`} x1={from.x * width} y1={from.y * 300} x2={to.x * width} y2={to.y * 300}
          stroke={a! % 2 ? 'var(--brand-lime)' : 'var(--brand-orange)'} strokeWidth={4}
          strokeLinecap="round" strokeDasharray={uncertain ? '6 6' : undefined} opacity={uncertain ? .45 : 1} />;
      })}
      {pose.landmarks.map((p) => <circle key={p.index} cx={p.x * width} cy={p.y * 300} r={5}
        fill={p.index % 2 ? 'var(--brand-lime)' : 'var(--brand-orange)'} stroke="var(--brand-white)" strokeWidth={1.5}
        opacity={p.visibility < .65 ? .45 : 1} />)}
    </svg>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginTop: 8, fontSize: 11 }}>
      <span data-testid={`replay-phase-${sampleId}`}>{PHASE_NAMES[pose.phase]}</span>
      <span className="mono-value" data-testid={`replay-time-${sampleId}`}>{(time / 1000).toFixed(1)} / {(duration / 1000).toFixed(1)}s · frame {pose.index + 1}/{sample.frames.length}</span>
    </div>
    <input type="range" aria-label="Movement replay position" min={0} max={Math.max(duration, 1)} step={10}
      value={time} disabled={duration === 0} data-testid={`replay-seek-${sampleId}`}
      onChange={(event) => { setPlaying(false); setTime(Number(event.target.value)); }}
      style={{ width: '100%', height: 36, margin: '4px 0', accentColor: 'var(--brand-orange)' }} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button className="secondary-btn" onClick={play} disabled={duration === 0} data-testid={`replay-play-${sampleId}`}
        aria-label={playing ? 'Pause movement replay' : 'Play movement replay'}>
        {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? 'Pause' : time >= duration ? 'Replay' : 'Play'}
      </button>
      <button className="secondary-btn" onClick={() => { setPlaying(false); setTime(0); }}
        data-testid={`replay-reset-${sampleId}`} aria-label="Reset movement replay"><RotateCcw size={14} /> Reset</button>
    </div>
    <p className="subtle" style={{ fontSize: 10, lineHeight: 1.5, margin: '8px 0 0' }}>Six joints, not video. Motion between recorded frames is interpolated for display. Faded or dashed joints mean lower visibility.</p>
  </div>;
}
