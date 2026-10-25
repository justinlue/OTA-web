import { describe, expect, it } from 'vitest';
import type { BatchManifest } from '../protocol/types';
import { batchViews, inProgressCount, leaseIsStale, LEASE_STALE_MS, summarize } from './batch';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const NOW = 1_000_000;
const fw = { version: '2.0.0', url: 'u', sha256: 's', size: 1, models: [], notes: '' };

describe('summarize', () => {
  it('counts states and knows when a batch is done', () => {
    const m: BatchManifest = {
      id: 'b', name: 'b', createdAt: 0, createdBy: '', firmware: fw, maxInFlight: 5,
      allowDowngrade: false, archived: false, rev: 1, writer: '',
      entries: {
        d1: { state: 'dispatched', jobId: 'b:d1:1', sentAt: NOW - 10, attempts: 1 },
        d2: { state: 'skipped', reason: 'offline', attempts: 0 },
        d3: { state: 'queued', attempts: 0 },
      },
    };
    const devs = new Map<string, DeviceRecord>([
      ['d1', { id: 'd1', ota: { jobId: 'b:d1:1', phase: 'downloading', percent: 5, ts: NOW } }],
    ]);
    const s = summarize(batchViews(m, devs, NOW, DEFAULT_TIMEOUTS));
    expect(s.counts.downloading).toBe(1);
    expect(s.counts.skipped).toBe(1);
    expect(s.counts.queued).toBe(1);
    expect(inProgressCount(s)).toBe(1);
    expect(s.finished).toBe(1);
    expect(s.done).toBe(false);

    const finished = { ...m, entries: { d2: m.entries.d2 } };
    expect(summarize(batchViews(finished, devs, NOW, DEFAULT_TIMEOUTS)).done).toBe(true);
  });
});

describe('leaseIsStale', () => {
  it('is stale when missing or older than the threshold', () => {
    expect(leaseIsStale(undefined, NOW)).toBe(true);
    expect(leaseIsStale({ owner: 'a', operator: '', heartbeat: NOW - 1000 }, NOW)).toBe(false);
    expect(leaseIsStale({ owner: 'a', operator: '', heartbeat: NOW - LEASE_STALE_MS - 1 }, NOW)).toBe(true);
  });
});
