import { describe, expect, it } from 'vitest';
import type { BatchManifest } from '../protocol/types';
import { deviceJobIndex, deviceJobView } from './deviceView';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const fw = { version: '2.0.0', url: 'u', sha256: 's', size: 1, models: [], notes: '' };
const batch = (id: string, createdAt: number, archived = false): BatchManifest => ({
  id, name: id, createdAt, createdBy: '', firmware: fw, maxInFlight: 1, allowDowngrade: false,
  archived, rev: 1, writer: '', entries: { d1: { state: 'queued', attempts: 0 } },
});

describe('deviceJobIndex', () => {
  it('picks the newest non-archived batch per device', () => {
    const idx = deviceJobIndex([batch('old', 1), batch('new', 2), batch('arch', 3, true)]);
    expect(idx.get('d1')?.batchId).toBe('new');
  });
});

describe('deviceJobView', () => {
  const now = 10_000;
  it('uses the batch entry when indexed', () => {
    const b = batch('b', 1);
    const v = deviceJobView({ id: 'd1' }, { batchId: 'b', createdAt: 1 }, new Map([['b', b]]), now, DEFAULT_TIMEOUTS);
    expect(v?.state).toBe('queued');
  });

  it('falls back to the raw report and trusts "done" without a batch', () => {
    const d: DeviceRecord = {
      id: 'd1',
      status: { online: true, fw: '3.0.0', model: 'm', ts: now },
      ota: { jobId: 'gone:d1:1', phase: 'done', ts: now },
    };
    expect(deviceJobView(d, undefined, new Map(), now, DEFAULT_TIMEOUTS)?.state).toBe('success');
    expect(deviceJobView({ id: 'd2' }, undefined, new Map(), now, DEFAULT_TIMEOUTS)).toBeNull();
  });
});
