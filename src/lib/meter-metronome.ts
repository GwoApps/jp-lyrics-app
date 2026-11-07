import type { MeterFrame } from './meter-dice';

export type MeterSoundStatus = 'off' | 'ready' | 'blocked' | 'unavailable';

/** Owns sound resources, never owns a clock or schedules future beats. */
export class MeterMetronome {
  private context: AudioContext | null = null;
  private enabled = false;
  private disposed = false;
  private generation = 0;
  private previous: MeterFrame | null = null;
  private voices = new Map<OscillatorNode, GainNode>();
  private createContext: () => AudioContext;
  private report: (status: MeterSoundStatus) => void;
  constructor(createContext: () => AudioContext, report: (status: MeterSoundStatus) => void) {
    this.createContext = createContext;
    this.report = report;
  }

  enable(frame: MeterFrame | null) {
    if (this.disposed) return;
    this.enabled = true;
    this.previous = frame;
    const generation = ++this.generation;
    try {
      const ctx = this.context ?? (this.context = this.createContext());
      // Called synchronously from the native click for browser activation.
      const resumed = ctx.resume();
      this.report(ctx.state === 'running' ? 'ready' : 'blocked');
      void resumed.then(() => {
        if (this.disposed || !this.enabled) {
          if (ctx.state !== 'closed') void ctx.suspend().catch(() => {});
          return;
        }
        if (generation === this.generation) this.report(ctx.state === 'running' ? 'ready' : 'blocked');
      }).catch(() => {
        if (this.enabled && generation === this.generation) this.report('unavailable');
      });
    } catch {
      this.report('unavailable');
    }
  }

  sample(next: MeterFrame | null, continuous: boolean) {
    const previous = this.previous;
    this.previous = next;
    if (!continuous || !next) { this.silence(); return; }
    const adjacent = previous && (next.barIndex === previous.barIndex
      ? next.beatIndex === previous.beatIndex + 1
      : next.barIndex === previous.barIndex + 1 && next.beatIndex === 0
        && previous.beatIndex === previous.numerator - 1);
    const ctx = this.context;
    if (!this.enabled || !adjacent || !ctx || ctx.state !== 'running') return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      this.voices.set(osc, gain);
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(next.beatIndex === 0 ? 1320 : 880, now);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(next.beatIndex === 0 ? 0.24 : 0.14, now + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => { osc.disconnect(); gain.disconnect(); this.voices.delete(osc); };
      osc.start(now);
      osc.stop(now + 0.04);
    } catch { this.silence(); this.report('unavailable'); }
  }

  silence() {
    for (const [osc, gain] of this.voices) {
      osc.onended = null;
      try { osc.stop(); } catch { /* Already ended. */ }
      osc.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
  }

  disable() {
    this.enabled = false;
    this.generation++;
    this.previous = null;
    this.silence();
    if (this.context && this.context.state !== 'closed') void this.context.suspend().catch(() => {});
    this.report('off');
  }

  dispose() {
    this.disable();
    this.disposed = true;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {});
    this.context = null;
  }
}
