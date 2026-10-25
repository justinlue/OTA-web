import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEASE_STALE_MS } from '../core/batch';
import { topics } from '../protocol/topics';
import type { DeviceCommand } from '../protocol/types';
import { MemoryBroker, type MemoryClient } from '../transport/memory';
import { OtaEngine, type TransportFactory } from './engine';
import { DEFAULT_SETTINGS, type Settings } from './settings';

const t = topics('ota');
const fw = { version: '2.0.0', url: 'https://cdn/fw.bin', sha256: 'abc', size: 42, models: [], notes: '' };
const settings: Settings = { ...DEFAULT_SETTINGS, conn: { ...DEFAULT_SETTINGS.conn, simulator: false } };

/** A hand-driven device: records commands, publishes whatever the test tells it to. */
class FakeDevice {
  commands: DeviceCommand[] = [];
  client: MemoryClient;
  constructor(
    broker: MemoryBroker,
    readonly id: string,
    public fw = '1.0.0',
  ) {
    this.client = broker.client(`dev-${id}`);
    this.client.onMessage((_t, p) => this.commands.push(JSON.parse(p)));
  }
  async start() {
    await this.client.connect();
    await this.client.subscribe([t.cmd(this.id)]);
    this.status(true);
  }
  status(online: boolean) {
    this.client.publish(t.status(this.id), JSON.stringify({ online, fw: this.fw, model: 'm', ts: Date.now() }), { retain: true });
  }
  report(phase: string, extra: object = {}) {
    const jobId = (this.commands.at(-1) as { jobId: string }).jobId;
    this.client.publish(t.ota(this.id), JSON.stringify({ jobId, phase, ts: Date.now(), ...extra }), { retain: true });
  }
  otaCommands() {
    return this.commands.filter((c) => c.type === 'ota');
  }
}

function setup() {
  const broker = new MemoryBroker();
  const factory: TransportFactory = (_s, clientId) => ({ transport: broker.client(clientId) });
  const engine = () => new OtaEngine(settings, factory);
  return { broker, engine };
}

const settle = (ms = 50) => vi.advanceTimersByTimeAsync(ms);

describe('OtaEngine', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('discovers devices and their online state from retained status', async () => {
    const { broker, engine } = setup();
    const d = new FakeDevice(broker, 'd1');
    await d.start();
    const e = engine();
    await e.connect();
    await settle();
    expect(e.store.getState().devices.get('d1')?.status).toMatchObject({ online: true, fw: '1.0.0' });
    d.client.kill(); // no will configured on the fake, so publish one by hand
    broker.publish(t.status('d1'), '{"online":false}', true);
    await settle();
    expect(e.store.getState().devices.get('d1')?.status).toMatchObject({ online: false, fw: '1.0.0' });
  });

  it('throttles a batch and follows each device to success', async () => {
    const { broker, engine } = setup();
    const d1 = new FakeDevice(broker, 'd1');
    const d2 = new FakeDevice(broker, 'd2');
    await d1.start();
    await d2.start();
    const e = engine();
    await e.connect();
    await settle();

    const batchId = e.startBatch({ name: 'rollout', firmware: fw, deviceIds: ['d1', 'd2'], maxInFlight: 1, allowDowngrade: false });
    await settle();
    expect(d1.otaCommands()).toHaveLength(1);
    expect(d2.otaCommands()).toHaveLength(0);
    expect(d1.otaCommands()[0]).toMatchObject({ type: 'ota', version: '2.0.0', url: fw.url, sha256: 'abc', size: 42 });

    d1.report('downloading', { percent: 30 });
    await settle(1000);
    expect(e.views(batchId).get('d1')).toMatchObject({ state: 'downloading', percent: 30 });
    expect(d2.otaCommands()).toHaveLength(0);

    d1.report('rebooting');
    d1.fw = '2.0.0';
    d1.status(true);
    d1.report('done');
    await settle(1000);
    expect(e.views(batchId).get('d1')?.state).toBe('success');
    expect(d2.otaCommands()).toHaveLength(1);

    // Many ticks later, nobody was sent anything twice.
    await settle(10_000);
    expect(d1.otaCommands()).toHaveLength(1);
    expect(d2.otaCommands()).toHaveLength(1);
  });

  it('times out a silent device as NO_ACK and retries it with a new job id', async () => {
    const { broker, engine } = setup();
    const d1 = new FakeDevice(broker, 'd1');
    await d1.start();
    const e = engine();
    await e.connect();
    await settle();
    const batchId = e.startBatch({ name: '', firmware: fw, deviceIds: ['d1'], maxInFlight: 5, allowDowngrade: false });
    await settle(settings.timeouts.ackMs + 2000);
    expect(e.views(batchId).get('d1')?.error?.code).toBe('NO_ACK');
    expect(e.store.getState().failedCount).toBe(1);
    expect(e.store.getState().toasts.some((x) => x.kind === 'error')).toBe(true);

    expect(e.retryFailed(batchId)).toBe(true);
    await settle();
    expect(d1.otaCommands().map((c) => (c as { jobId: string }).jobId)).toEqual([`${batchId}:d1:1`, `${batchId}:d1:2`]);
    expect(e.views(batchId).get('d1')?.state).toBe('sent');
  });

  it('shows device-reported errors', async () => {
    const { broker, engine } = setup();
    const d1 = new FakeDevice(broker, 'd1');
    await d1.start();
    const e = engine();
    await e.connect();
    await settle();
    const batchId = e.startBatch({ name: '', firmware: fw, deviceIds: ['d1'], maxInFlight: 5, allowDowngrade: false });
    await settle();
    d1.report('failed', { error: { code: 'LOW_BATTERY', message: 'battery 9%', phase: 'accepted' } });
    await settle(1000);
    expect(e.views(batchId).get('d1')).toMatchObject({
      state: 'failed',
      error: { code: 'LOW_BATTERY', message: 'battery 9%', phase: 'accepted' },
    });
    expect(e.store.getState().history.get('d1')?.at(-1)).toMatchObject({ phase: 'failed', code: 'LOW_BATTERY' });
  });

  it('skips offline devices at their turn', async () => {
    const { broker, engine } = setup();
    const d1 = new FakeDevice(broker, 'd1');
    await d1.start();
    d1.status(false);
    const e = engine();
    await e.connect();
    await settle();
    const batchId = e.startBatch({ name: '', firmware: fw, deviceIds: ['d1'], maxInFlight: 5, allowDowngrade: false });
    await settle();
    expect(e.views(batchId).get('d1')).toMatchObject({ state: 'skipped', reason: 'offline' });
    expect(d1.otaCommands()).toHaveLength(0);
  });

  it('lets only the lease owner dispatch, and another tab take over a stale lease', async () => {
    const { broker, engine } = setup();
    const d1 = new FakeDevice(broker, 'd1');
    const d2 = new FakeDevice(broker, 'd2');
    await d1.start();
    await d2.start();
    const a = engine();
    const b = engine();
    await a.connect();
    await b.connect();
    await settle();

    const batchId = a.startBatch({ name: '', firmware: fw, deviceIds: ['d1', 'd2'], maxInFlight: 1, allowDowngrade: false });
    await settle(2000);
    expect(b.store.getState().batches.has(batchId)).toBe(true);
    expect(b.isOwner(batchId)).toBe(false);
    expect(b.canAct(batchId)).toBe(false);
    expect(b.retry(batchId, ['d2'])).toBe(false);

    // Tab A closes with d2 still queued.
    await a.disconnect();
    await settle(LEASE_STALE_MS + 2000);
    expect(d2.otaCommands()).toHaveLength(0);
    expect(b.canAct(batchId)).toBe(true);

    // d1 finishes meanwhile; B takes over and drains the queue.
    d1.report('done');
    d1.fw = '2.0.0';
    d1.status(true);
    b.takeOver(batchId);
    await settle(2000);
    expect(b.isOwner(batchId)).toBe(true);
    expect(d2.otaCommands()).toHaveLength(1);
  });

  it('shares the firmware catalog through the broker', async () => {
    const { engine } = setup();
    const a = engine();
    const b = engine();
    await a.connect();
    await b.connect();
    a.saveFirmware(fw);
    await settle();
    expect(b.store.getState().catalog.entries).toEqual([fw]);
    b.deleteFirmware('2.0.0');
    await settle();
    expect(a.store.getState().catalog.entries).toEqual([]);
  });

  it('archives and deletes batches', async () => {
    const { broker, engine } = setup();
    const e = engine();
    await e.connect();
    const batchId = e.startBatch({ name: '', firmware: fw, deviceIds: ['x'], maxInFlight: 5, allowDowngrade: false });
    await settle();
    expect(e.archive(batchId)).toBe(true);
    await settle();
    expect(e.store.getState().batches.get(batchId)?.archived).toBe(true);
    expect(e.deleteBatch(batchId)).toBe(true);
    await settle();
    expect(e.store.getState().batches.has(batchId)).toBe(false);
    expect(broker.retained.has(t.batch(batchId))).toBe(false);
  });
});
