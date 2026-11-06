import { describe, expect, it } from 'vitest';
import type { BatchEntry, ModuleVersions, OtaReport } from '../protocol/types';
import { jobView } from './jobState';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const T = DEFAULT_TIMEOUTS;
const TARGET: ModuleVersions = { lte: '2.0.0' };
const SENT = 1_000_000;
const dispatched: BatchEntry = { state: 'dispatched', jobId: 'b:d1:1', sentAt: SENT, attempts: 1 };

function dev(ota?: Partial<OtaReport>, lte = '1.0.0', statusTs = SENT - 5000, more: ModuleVersions = {}): DeviceRecord {
  return {
    id: 'd1',
    status: { online: true, fw: '9.0.0', model: 'm', ts: statusTs, modules: { lte, ble: '3.1.0', ...more } },
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

  it('keeps overall progress moving forward across the modules of one job', () => {
    const targets: ModuleVersions = { ble: '3.2.0', lte: '2.0.0' };
    const at = (ota: Partial<OtaReport>) => jobView(dispatched, dev(ota), targets, SENT + 1000, T).progress;
    const bleInstalled = at({ phase: 'installing', module: 'ble', percent: 100 });
    const lteStarting = at({ phase: 'downloading', module: 'lte', percent: 0 });
    const lteHalf = at({ phase: 'installing', module: 'lte', percent: 50 });
    expect(at({ phase: 'downloading', module: 'ble', percent: 50 })).toBeLessThan(bleInstalled);
    expect(bleInstalled).toBeLessThanOrEqual(lteStarting);
    expect(lteStarting).toBeLessThan(lteHalf);
    expect(lteHalf).toBeLessThan(at({ phase: 'rebooting' }));
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
    expect(jobView(dispatched, dev(done, '2.0.0', SENT + 5000), TARGET, SENT + 6000, T)).toMatchObject({
      state: 'success',
      progress: 100,
      terminal: true,
    });
    // Status not yet refreshed after the reboot: keep waiting.
    expect(jobView(dispatched, dev(done, '1.0.0', SENT - 1), TARGET, SENT + 6000, T).state).toBe('rebooting');
    // Fresh status still on the old version: rolled back.
    const rb = jobView(dispatched, dev(done, '1.0.0', SENT + 5000), TARGET, SENT + 6000, T);
    expect(rb.error).toMatchObject({ code: 'ROLLED_BACK', phase: 'rebooting', message: 'LTE is running 1.0.0' });
  });

  it('needs every targeted module on its version, and names the ones that are not', () => {
    const targets: ModuleVersions = { ble: '3.2.0', lte: '2.0.0' };
    const done = { phase: 'done' as const, ts: SENT + 5000 };
    const both = dev(done, '2.0.0', SENT + 5000, { ble: '3.2.0' });
    expect(jobView(dispatched, both, targets, SENT + 6000, T).state).toBe('success');
    const oneBack = dev(done, '2.0.0', SENT + 5000);
    const rb = jobView(dispatched, oneBack, targets, SENT + 6000, T);
    expect(rb.error).toMatchObject({ code: 'ROLLED_BACK', message: 'BLE is running 3.1.0', module: 'ble' });
  });

  it('carries the module a multi-module job is on, in progress and on failure', () => {
    const v = jobView(dispatched, dev({ phase: 'installing', module: 'ble', percent: 20 }), TARGET, SENT + 1000, T);
    expect(v).toMatchObject({ state: 'installing', module: 'ble' });
    const f = dev({ phase: 'failed', module: 'lte', error: { code: 'FLASH_WRITE_FAILED', message: '', phase: 'installing' } });
    expect(jobView(dispatched, f, TARGET, SENT + 1000, T).error).toMatchObject({ code: 'FLASH_WRITE_FAILED', module: 'lte' });
    const quiet = dev({ phase: 'downloading', module: 'ble', percent: 10 });
    expect(jobView(dispatched, quiet, TARGET, SENT + 100 + T.stallMs + 1, T).error).toMatchObject({ code: 'STALLED', module: 'ble' });
  });

  it('honours a device-side cancel', () => {
    expect(jobView(dispatched, dev({ phase: 'cancelled' }), TARGET, SENT + 1000, T).state).toBe('cancelled');
  });

  it('treats a report from the future as current rather than stalling', () => {
    const v = jobView(dispatched, dev({ phase: 'downloading', ts: SENT + 999_999 }), TARGET, SENT + 1000, T);
    expect(v.state).toBe('downloading');
  });
});
