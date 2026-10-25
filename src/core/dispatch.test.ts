import { describe, expect, it } from 'vitest';
import type { BatchManifest } from '../protocol/types';
import { applyCancelQueued, applyRetry, planDispatch } from './dispatch';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const NOW = 1_000_000;
const fw = { version: '2.0.0', url: 'https://cdn/fw.bin', sha256: 'abc', size: 42, models: [], notes: '' };

function manifest(entries: BatchManifest['entries'], maxInFlight = 2): BatchManifest {
  return {
    id: 'b1', name: 'b1', createdAt: 0, createdBy: 'op', firmware: fw, maxInFlight,
    allowDowngrade: false, archived: false, rev: 1, writer: 'me', entries,
  };
}

function online(id: string, fw = '1.0.0'): DeviceRecord {
  return { id, status: { online: true, fw, model: 'm', ts: NOW } };
}

const devices = (...recs: DeviceRecord[]) => new Map(recs.map((r) => [r.id, r]));

describe('planDispatch', () => {
  it('sends up to maxInFlight queued entries in order, with fresh job ids', () => {
    const m = manifest({
      d1: { state: 'queued', attempts: 0 },
      d2: { state: 'queued', attempts: 0 },
      d3: { state: 'queued', attempts: 0 },
    });
    const plan = planDispatch(m, devices(online('d1'), online('d2'), online('d3')), NOW, DEFAULT_TIMEOUTS);
    expect(plan.commands.map((c) => c.deviceId)).toEqual(['d1', 'd2']);
    expect(plan.commands[0].command).toEqual({
      type: 'ota', jobId: 'b1:d1:1', version: '2.0.0', url: 'https://cdn/fw.bin', sha256: 'abc', size: 42,
    });
    expect(plan.manifest.entries.d1).toEqual({ state: 'dispatched', jobId: 'b1:d1:1', sentAt: NOW, attempts: 1 });
    expect(plan.manifest.entries.d3.state).toBe('queued');
    expect(plan.changed).toBe(true);
  });

  it('counts unfinished dispatched entries against the limit', () => {
    const m = manifest({
      d1: { state: 'dispatched', jobId: 'b1:d1:1', sentAt: NOW - 10, attempts: 1 },
      d2: { state: 'queued', attempts: 0 },
      d3: { state: 'queued', attempts: 0 },
    });
    const plan = planDispatch(m, devices(online('d1'), online('d2'), online('d3')), NOW, DEFAULT_TIMEOUTS);
    expect(plan.commands.map((c) => c.deviceId)).toEqual(['d2']);
  });

  it('frees a slot when a dispatched entry times out', () => {
    const m = manifest(
      {
        d1: { state: 'dispatched', jobId: 'b1:d1:1', sentAt: NOW - DEFAULT_TIMEOUTS.ackMs - 1, attempts: 1 },
        d2: { state: 'queued', attempts: 0 },
      },
      1,
    );
    expect(planDispatch(m, devices(online('d1'), online('d2')), NOW, DEFAULT_TIMEOUTS).commands).toHaveLength(1);
  });

  it('skips ineligible devices at their turn without using a slot', () => {
    const m = manifest(
      {
        d1: { state: 'queued', attempts: 0 },
        d2: { state: 'queued', attempts: 0 },
      },
      1,
    );
    const plan = planDispatch(m, devices({ id: 'd1' }, online('d2')), NOW, DEFAULT_TIMEOUTS);
    expect(plan.manifest.entries.d1).toEqual({ state: 'skipped', reason: 'offline', attempts: 0 });
    expect(plan.commands.map((c) => c.deviceId)).toEqual(['d2']);
  });

  it('reports no change when there is nothing to do', () => {
    const m = manifest({ d1: { state: 'skipped', reason: 'offline', attempts: 0 } });
    const plan = planDispatch(m, devices(), NOW, DEFAULT_TIMEOUTS);
    expect(plan.changed).toBe(false);
    expect(plan.manifest).toBe(m);
  });
});

describe('applyRetry / applyCancelQueued', () => {
  it('re-queues the given entries, keeping attempts', () => {
    const m = manifest({
      d1: { state: 'dispatched', jobId: 'b1:d1:1', sentAt: 1, attempts: 1 },
      d2: { state: 'skipped', reason: 'offline', attempts: 0 },
    });
    const next = applyRetry(m, ['d1', 'd2']);
    expect(next.entries.d1).toEqual({ state: 'queued', attempts: 1 });
    expect(next.entries.d2).toEqual({ state: 'queued', attempts: 0 });
  });

  it('cancels only queued entries', () => {
    const m = manifest({
      d1: { state: 'queued', attempts: 0 },
      d2: { state: 'dispatched', jobId: 'j', sentAt: 1, attempts: 1 },
    });
    const next = applyCancelQueued(m);
    expect(next.entries.d1.state).toBe('cancelled');
    expect(next.entries.d2.state).toBe('dispatched');
  });
});
