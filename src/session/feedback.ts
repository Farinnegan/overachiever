import type { RepSound } from '../data/store.ts';

/** Rep sounds, so you don't have to look at the phone mid-set. */
let audio: AudioContext | null = null;

/** Must be called from a tap (browsers block sound until the user interacts). */
export function unlockSound(mode: RepSound) {
  try {
    if (mode === 'beep') {
      audio ??= new AudioContext();
      void audio.resume();
    } else if (mode === 'voice' && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  } catch { /* sound is optional */ }
}

export function announceRep(n: number, mode: RepSound) {
  try {
    if (mode === 'voice' && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(n));
      u.rate = 1.15;
      speechSynthesis.speak(u);
    } else if (mode === 'beep' && audio) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
      osc.connect(gain).connect(audio.destination);
      osc.start();
      osc.stop(audio.currentTime + 0.2);
    }
  } catch { /* sound is optional */ }
}

/** Spoken or beeped warning that the camera has lost you mid-set. */
export function announceLost(mode: RepSound) {
  try {
    if (mode === 'voice' && 'speechSynthesis' in window) {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance('I can’t see you. Get your head and shoulders in the frame.');
      u.rate = 1.1;
      speechSynthesis.speak(u);
    } else if (mode === 'beep' && audio) {
      for (const [i, f] of [[0, 330], [1, 262]] as const) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const at = audio.currentTime + i * 0.22;
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.25, at);
        gain.gain.exponentialRampToValueAtTime(0.001, at + 0.2);
        osc.connect(gain).connect(audio.destination);
        osc.start(at);
        osc.stop(at + 0.21);
      }
    }
  } catch { /* sound is optional */ }
}

/** Keep the screen on during a workout. Silently does nothing where unsupported. */
export async function keepScreenOn(): Promise<() => void> {
  try {
    const lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen');
    return () => { void lock?.release().catch(() => undefined); };
  } catch {
    return () => undefined;
  }
}
