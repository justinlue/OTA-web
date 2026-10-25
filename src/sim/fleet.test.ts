import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseOtaReport, parseStatus } from '../protocol/parse';
import { topics } from '../protocol/topics';
import { MemoryBroker } from '../transport/memory';
import { SimFleet } from './fleet';

const t = topics('ota');

describe('SimFleet', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function setup(failureRate: number) {
    const broker = new MemoryBroker();
    const fleet = new SimFleet(broker, 'ota', { count: 4, flapRate: 0, failureRate, speed: 1000, seed: 1 });
    await fleet.start();
    const ui = broker.client('ui');
    await ui.connect();
    return { broker, fleet, ui };
  }

  const cmd = (jobId: string) =>
    JSON.stringify({ type: 'ota', jobId, version: '9.9.9', url: 'u', sha256: 's', size: 1 });

  it('announces every device with a retained status and seeds the catalog', async () => {
    const { broker, fleet } = await setup(0);
    expect(fleet.deviceIds()).toHaveLength(4);
    for (const id of fleet.deviceIds()) expect(parseStatus(broker.retained.get(t.status(id))!)?.online).toBe(true);
    expect(broker.retained.has(t.catalog())).toBe(true);
    fleet.stop();
  });

  it('runs an update to done and comes back on the new version', async () => {
    const { broker, fleet, ui } = await setup(0);
    const id = fleet.deviceIds()[0];
    ui.publish(t.cmd(id), cmd('j1'));
    await vi.advanceTimersByTimeAsync(200);
    const report = parseOtaReport(broker.retained.get(t.ota(id))!);
    expect(report).toMatchObject({ jobId: 'j1', phase: 'done' });
    expect(parseStatus(broker.retained.get(t.status(id))!)).toMatchObject({ online: true, fw: '9.9.9' });
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
    const { broker, fleet, ui } = await setup(1);
    const ids = fleet.deviceIds();
    ids.forEach((id, i) => ui.publish(t.cmd(id), cmd(`j${i}`)));
    await vi.advanceTimersByTimeAsync(200);
    const reports = ids.map((id) => broker.retained.get(t.ota(id))).filter(Boolean).map((p) => parseOtaReport(p!));
    // Silent devices leave no report; every device that did answer failed with a code.
    for (const r of reports) expect(r).toMatchObject({ phase: 'failed', error: { code: expect.any(String) } });
    fleet.stop();
  });
});
