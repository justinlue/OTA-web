// Simulated LTE fleet: each device is a MemoryClient on the shared in-memory broker and
// speaks the real protocol, so the engine cannot tell it from hardware.
import { topics } from '../protocol/topics';
import type { DeviceCommand, FirmwareCatalog, OtaCommand, OtaError, OtaReport } from '../protocol/types';
import type { MemoryBroker, MemoryClient } from '../transport/memory';

export type SimConfig = {
  count: number;
  /** Share of devices that keep dropping on and off the network. */
  flapRate: number;
  /** Share of OTA jobs that fail (or go silent). */
  failureRate: number;
  /** Time compression: 10 means ten times faster than a real device. */
  speed: number;
  seed: number;
};

export const DEFAULT_SIM: SimConfig = { count: 200, flapRate: 0.05, failureRate: 0.15, speed: 10, seed: 42 };

const MODELS = [
  { model: 'LT-100', fw: ['1.4.2', '1.4.2', '1.4.2', '1.3.9'] },
  { model: 'LT-200', fw: ['2.1.0', '2.1.0', '2.0.4'] },
];

export const SIM_CATALOG: FirmwareCatalog = {
  rev: 1,
  writer: 'simulator',
  entries: [
    { version: '1.5.0', url: 'https://fw.example.com/lt100/1.5.0.bin', sha256: 'a3f1c2…e9', size: 1_843_200, models: ['LT-100'], notes: 'Modem stack update, power-save fixes.' },
    { version: '1.3.9', url: 'https://fw.example.com/lt100/1.3.9.bin', sha256: '77b0d4…1c', size: 1_802_240, models: ['LT-100'], notes: 'Previous stable (for downgrade).' },
    { version: '2.2.0', url: 'https://fw.example.com/lt200/2.2.0.bin', sha256: 'c91e0a…4f', size: 2_457_600, models: ['LT-200'], notes: 'New GNSS driver.' },
  ],
};

type Failure = { code: string; at: 'accepted' | 'downloading' | 'verifying' | 'installing' | 'rebooting'; message: string };

const FAILURES: Failure[] = [
  { code: 'DOWNLOAD_FAILED', at: 'downloading', message: 'HTTP 503 from fw.example.com' },
  { code: 'SIGNAL_LOST', at: 'downloading', message: 'RSRP -121 dBm, PDP context lost' },
  { code: 'CHECKSUM_MISMATCH', at: 'verifying', message: 'sha256 mismatch' },
  { code: 'INSUFFICIENT_STORAGE', at: 'accepted', message: 'need 2.4 MB, 1.1 MB free' },
  { code: 'LOW_BATTERY', at: 'accepted', message: 'battery 9%' },
  { code: 'FLASH_WRITE_FAILED', at: 'installing', message: 'write error at 0x0804A000' },
  { code: 'ROLLED_BACK', at: 'rebooting', message: 'boot watchdog expired on new image' },
  { code: 'VERSION_REJECTED', at: 'accepted', message: 'anti-rollback counter' },
];

/** Deterministic PRNG so a given seed always produces the same fleet. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class SimDevice {
  private client: MemoryClient;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private job: { id: string; phase: string; percent: number } | null = null;
  private stopped = false;

  constructor(
    readonly id: string,
    readonly model: string,
    public fw: string,
    private flapper: boolean,
    private fleet: SimFleet,
  ) {
    this.client = fleet.broker.client(`sim-${id}`, {
      topic: fleet.t.status(id),
      payload: JSON.stringify({ online: false }),
      retain: true,
    });
    this.client.onMessage((_topic, payload) => this.onCommand(payload));
  }

  async start(online: boolean): Promise<void> {
    if (online) await this.goOnline();
    else this.fleet.broker.publish(this.fleet.t.status(this.id), this.statusPayload(false), true);
    if (this.flapper) this.scheduleFlap();
  }

  stop(): void {
    this.stopped = true;
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.client.kill();
  }

  private statusPayload(online: boolean): string {
    return JSON.stringify({ online, fw: this.fw, model: this.model, ts: Date.now() });
  }

  private async goOnline(): Promise<void> {
    await this.client.connect();
    await this.client.subscribe([this.fleet.t.cmd(this.id)]);
    this.client.publish(this.fleet.t.status(this.id), this.statusPayload(true), { retain: true, qos: 1 });
  }

  private after(ms: number, fn: () => void): void {
    const h = setTimeout(() => {
      this.timers.delete(h);
      if (!this.stopped) fn();
    }, ms / this.fleet.config.speed);
    this.timers.add(h);
  }

  private scheduleFlap(): void {
    this.after(20_000 + this.fleet.rand() * 70_000, () => {
      if (!this.job) {
        if (this.client.isConnected) this.client.kill();
        else void this.goOnline();
      }
      this.scheduleFlap();
    });
  }

  private report(r: Omit<OtaReport, 'ts' | 'jobId'> & { jobId?: string }): void {
    const jobId = r.jobId ?? this.job?.id ?? '';
    this.client.publish(this.fleet.t.ota(this.id), JSON.stringify({ ...r, jobId, ts: Date.now() }), { retain: true, qos: 1 });
  }

  private onCommand(payload: string): void {
    let cmd: DeviceCommand;
    try {
      cmd = JSON.parse(payload) as DeviceCommand;
    } catch {
      return;
    }
    if (cmd.type === 'cancel') {
      if (this.job && this.job.id === cmd.jobId && this.job.phase === 'downloading') {
        this.job = null;
        this.report({ jobId: cmd.jobId, phase: 'cancelled' });
      }
      return;
    }
    if (cmd.type !== 'ota') return;
    if (this.job) {
      this.report({ jobId: cmd.jobId, phase: 'failed', error: { code: 'BUSY', message: `already running ${this.job.id}`, phase: 'accepted' } });
      return;
    }
    this.run(cmd);
  }

  private run(cmd: OtaCommand): void {
    const r = this.fleet.rand();
    const fails = r < this.fleet.config.failureRate;
    // One in nine failures is a device that never answers (the UI should call it NO_ACK).
    if (fails && this.fleet.rand() < 1 / 9) return;
    const failure = fails ? FAILURES[Math.floor(this.fleet.rand() * FAILURES.length)] : null;
    const failPct = 10 + Math.floor(this.fleet.rand() * 8) * 10;
    const job = { id: cmd.jobId, phase: 'accepted', percent: 0 };
    this.job = job;
    const live = () => this.job === job;

    const fail = (phase: string) => {
      const error: OtaError = { code: failure!.code, message: failure!.message, phase };
      this.job = null;
      this.report({ jobId: job.id, phase: 'failed', error });
    };

    this.after(1000, () => {
      if (!live()) return;
      this.report({ phase: 'accepted' });
      if (failure?.at === 'accepted') return this.after(1000, () => live() && fail('accepted'));
      job.phase = 'downloading';
      this.download(job, 0, failure, failPct, live, fail, cmd);
    });
  }

  private download(
    job: { id: string; phase: string; percent: number },
    pct: number,
    failure: Failure | null,
    failPct: number,
    live: () => boolean,
    fail: (phase: string) => void,
    cmd: OtaCommand,
  ): void {
    this.after(3000, () => {
      if (!live()) return;
      if (failure?.at === 'downloading' && pct >= failPct) return fail('downloading');
      job.percent = pct;
      this.report({ phase: 'downloading', percent: pct });
      if (pct < 100) return this.download(job, pct + 10, failure, failPct, live, fail, cmd);
      job.phase = 'verifying';
      this.after(2000, () => {
        if (!live()) return;
        this.report({ phase: 'verifying' });
        if (failure?.at === 'verifying') return this.after(1500, () => live() && fail('verifying'));
        job.phase = 'installing';
        this.install(job, 0, failure, failPct, live, fail, cmd);
      });
    });
  }

  private install(
    job: { id: string; phase: string; percent: number },
    pct: number,
    failure: Failure | null,
    failPct: number,
    live: () => boolean,
    fail: (phase: string) => void,
    cmd: OtaCommand,
  ): void {
    this.after(2500, () => {
      if (!live()) return;
      if (failure?.at === 'installing' && pct >= failPct) return fail('installing');
      this.report({ phase: 'installing', percent: pct });
      if (pct < 100) return this.install(job, pct + 20, failure, failPct, live, fail, cmd);
      job.phase = 'rebooting';
      this.report({ phase: 'rebooting' });
      this.after(500, () => {
        this.client.kill();
        this.after(15_000, async () => {
          if (failure?.at !== 'rebooting') this.fw = cmd.version;
          await this.goOnline();
          if (failure?.at === 'rebooting') fail('rebooting');
          else {
            this.report({ phase: 'done', percent: 100 });
            this.job = null;
          }
        });
      });
    });
  }
}

export class SimFleet {
  readonly t;
  readonly rand: () => number;
  private devices: SimDevice[] = [];

  constructor(
    readonly broker: MemoryBroker,
    prefix: string,
    readonly config: SimConfig,
  ) {
    this.t = topics(prefix);
    this.rand = mulberry32(config.seed);
  }

  async start(): Promise<void> {
    if (!this.broker.retained.has(this.t.catalog())) {
      this.broker.publish(this.t.catalog(), JSON.stringify(SIM_CATALOG), true);
    }
    const starts: Promise<void>[] = [];
    for (let i = 0; i < this.config.count; i++) {
      const m = MODELS[i % MODELS.length];
      const fw = m.fw[Math.floor(this.rand() * m.fw.length)];
      const flapper = this.rand() < this.config.flapRate;
      const id = `${m.model.toLowerCase()}-${String(i + 1).padStart(5, '0')}`;
      const dev = new SimDevice(id, m.model, fw, flapper, this);
      this.devices.push(dev);
      starts.push(dev.start(!flapper || this.rand() < 0.5));
    }
    await Promise.all(starts);
  }

  stop(): void {
    for (const d of this.devices) d.stop();
    this.devices = [];
  }

  deviceIds(): string[] {
    return this.devices.map((d) => d.id);
  }
}
