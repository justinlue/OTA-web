import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOtaReport, parseStatus } from '../protocol/parse';
import { topics } from '../protocol/topics';
import { MemoryBroker } from '../transport/memory';
import { SimFleet } from './fleet';

const t = topics('ota');

describe('SimFleet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup(failureRate: number, count = 4) {
    const broker = new MemoryBroker();
    const fleet = new SimFleet(broker, 'ota', { count, flapRate: 0, failureRate, speed: 1000, seed: 1 });
    await fleet.start();
    const ui = broker.client('ui');
    await ui.connect();
    return { broker, fleet, ui };
  }

  const img = (module: string) => ({ module, version: '9.9.9', url: 'u', sha256: 's', size: 1 });
  const cmd = (jobId: string, modules = ['lte']) => JSON.stringify({ type: 'ota', jobId, modules: modules.map(img) });

  it('announces every device with a retained status and seeds the catalog', async () => {
    const { broker, fleet } = await setup(0);
    expect(fleet.deviceIds()).toHaveLength(4);
    for (const id of fleet.deviceIds()) expect(parseStatus(broker.retained.get(t.status(id))!)?.online).toBe(true);
    expect(broker.retained.has(t.catalog())).toBe(true);
    fleet.stop();
  });

  it('announces a version for every module', async () => {
    const { broker, fleet } = await setup(0);
    const status = parseStatus(broker.retained.get(t.status(fleet.deviceIds()[0]))!);
    expect(Object.keys(status!.modules).sort()).toEqual(['ble', 'lte', 'mcu', 'sensor']);
    expect(status!.fw).toBe(status!.modules.mcu);
    fleet.stop();
  });

  it('updates each listed module in order, then comes back on the new versions', async () => {
    const { broker, fleet, ui } = await setup(0);
    const id = fleet.deviceIds()[0];
    const before = parseStatus(broker.retained.get(t.status(id))!)!;
    const seen: string[] = [];
    ui.onMessage((_topic, p) => {
      const r = parseOtaReport(p);
      if (r?.module && seen.at(-1) !== r.module) seen.push(r.module);
    });
    await ui.subscribe([t.ota(id)]);
    ui.publish(t.cmd(id), cmd('j1', ['ble', 'lte']));
    await vi.advanceTimersByTimeAsync(400);
    expect(parseOtaReport(broker.retained.get(t.ota(id))!)).toMatchObject({ jobId: 'j1', phase: 'done' });
    expect(seen).toEqual(['ble', 'lte']);
    const after = parseStatus(broker.retained.get(t.status(id))!)!;
    expect(after).toMatchObject({ online: true });
    expect(after.modules).toEqual({ ...before.modules, ble: '9.9.9', lte: '9.9.9' });
    fleet.stop();
  });

  it('answers BUSY to a second command while running', async () => {
    const { broker, fleet, ui } = await setup(0);
    const id = fleet.deviceIds()[0];
    ui.publish(t.cmd(id), cmd('j1'));
    await vi.advanceTimersByTimeAsync(5);
    ui.publish(t.cmd(id), cmd('j2'));
    await vi.advanceTimersByTimeAsync(1);
    expect(parseOtaReport(broker.retained.get(t.ota(id))!)).toMatchObject({ jobId: 'j2', phase: 'failed', error: { code: 'BUSY' } });
    fleet.stop();
  });

  it('fails with a reported error when failure is forced', async () => {
    const { broker, fleet, ui } = await setup(1, 12);
    const ids = fleet.deviceIds();
    ids.forEach((id, i) => ui.publish(t.cmd(id), cmd(`j${i}`)));
    await vi.advanceTimersByTimeAsync(400);
    const reports = ids.map((id) => broker.retained.get(t.ota(id))).filter(Boolean).map((p) => parseOtaReport(p!));
    // Silent devices leave no report; every device that did answer failed with a code.
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      expect(r).toMatchObject({ phase: 'failed', error: { code: expect.any(String) } });
      // Only a failure that belongs to one module names it; refusing the whole job does not.
      expect(r?.module).toBe(r?.error?.phase === 'accepted' ? undefined : 'lte');
    }
    fleet.stop();
  });
});
