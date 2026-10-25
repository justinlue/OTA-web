import { describe, expect, it } from 'vitest';
import type { BatchEntry, OtaReport } from '../protocol/types';
import { jobView } from './jobState';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const T = DEFAULT_TIMEOUTS;
const TARGET = '2.0.0';
const SENT = 1_000_000;
const dispatched: BatchEntry = { state: 'dispatched', jobId: 'b:d1:1', sentAt: SENT, attempts: 1 };

function dev(ota?: Partial<OtaReport>, fw = '1.0.0', statusTs = SENT - 5000): DeviceRecord {
  return {
    id: 'd1',
    status: { online: true, fw, model: 'm', ts: statusTs },
    ota: ota ? ({ jobId: 'b:d1:1', phase: 'accepted', ts: SENT + 100, ...ota } as OtaReport) : undefined,
  };
}

describe('jobView', () => {
  it('passes queued, skipped and cancelled entries through', () => {
    expect(jobView({ state: 'queued', attempts: 0 }, dev(), TARGET, SENT, T).state).toBe('queued');
    const skipped = jobView({ state: 'skipped', reason: 'offline', attempts: 0 }, dev(), TARGET, SENT, T);
    expect(skipped).toMatchObject({ state: 'skipped', reason: 'offline', terminal: true });
    expect(jobView({ state: 'cancelled', attempts: 0 }, dev(), TARGET, SENT, T).state).toBe('cancelled');
  });

  it('is "sent" until the device answers, then NO_ACK after the ack timeout', () => {
    expect(jobView(dispatched, dev(), TARGET, SENT + 1000, T).state).toBe('sent');
    const v = jobView(dispatched, dev(), TARGET, SENT + T.ackMs + 1, T);
    expect(v).toMatchObject({ state: 'failed', terminal: true });
    expect(v.error).toMatchObject({ code: 'NO_ACK', phase: 'sent' });
  });

  it('ignores reports for a different job', () => {
    const d = dev({ jobId: 'b:d1:0', phase: 'failed', error: { code: 'LOW_BATTERY', message: '' } });
    expect(jobView(dispatched, d, TARGET, SENT + 1000, T).state).toBe('sent');
  });

  it('shows phase progress', () => {
    const v = jobView(dispatched, dev({ phase: 'downloading', percent: 50 }), TARGET, SENT + 1000, T);
    expect(v).toMatchObject({ state: 'downloading', percent: 50, terminal: false });
    expect(v.progress).toBeGreaterThan(0);
    expect(v.progress).toBeLessThan(60);
  });

  it('marks a silent device STALLED, with a longer allowance while rebooting', () => {
    const late = SENT + 100 + T.stallMs + 1;
    const stalled = jobView(dispatched, dev({ phase: 'installing', percent: 10 }), TARGET, late, T);
    expect(stalled.error).toMatchObject({ code: 'STALLED', phase: 'installing' });
    expect(jobView(dispatched, dev({ phase: 'rebooting' }), TARGET, late, T).state).toBe('rebooting');
    const veryLate = SENT + 100 + T.rebootMs + 1;
    expect(jobView(dispatched, dev({ phase: 'rebooting' }), TARGET, veryLate, T).error?.code).toBe('STALLED');
  });

  it('passes device failures through with their phase', () => {
    const d = dev({ phase: 'failed', error: { code: 'CHECKSUM_MISMATCH', message: 'bad hash', phase: 'verifying' } });
    const v = jobView(dispatched, d, TARGET, SENT + 1000, T);
    expect(v).toMatchObject({ state: 'failed', terminal: true });
    expect(v.error).toEqual({ code: 'CHECKSUM_MISMATCH', message: 'bad hash', phase: 'verifying' });
  });

  it('needs done AND the target version in status for success', () => {
    const done = { phase: 'done' as const, ts: SENT + 5000 };
    expect(jobView(dispatched, dev(done, TARGET, SENT + 5000), TARGET, SENT + 6000, T)).toMatchObject({
      state: 'success',
      progress: 100,
      terminal: true,
    });
    // Status not yet refreshed after the reboot: keep waiting.
    expect(jobView(dispatched, dev(done, '1.0.0', SENT - 1), TARGET, SENT + 6000, T).state).toBe('rebooting');
    // Fresh status still on the old version: rolled back.
    const rb = jobView(dispatched, dev(done, '1.0.0', SENT + 5000), TARGET, SENT + 6000, T);
    expect(rb.error).toMatchObject({ code: 'ROLLED_BACK', phase: 'rebooting' });
  });

  it('honours a device-side cancel', () => {
    expect(jobView(dispatched, dev({ phase: 'cancelled' }), TARGET, SENT + 1000, T).state).toBe('cancelled');
  });

  it('treats a report from the future as current rather than stalling', () => {
    const v = jobView(dispatched, dev({ phase: 'downloading', ts: SENT + 999_999 }), TARGET, SENT + 1000, T);
    expect(v.state).toBe('downloading');
  });
});
