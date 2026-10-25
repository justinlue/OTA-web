import { describe, expect, it } from 'vitest';
import type { FirmwareEntry } from '../protocol/types';
import { checkEligibility } from './eligibility';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const NOW = 1_000_000;
const fw: FirmwareEntry = { version: '2.0.0', url: 'u', sha256: 's', size: 1, models: ['LT-100'], notes: '' };

function dev(over: Partial<DeviceRecord['status']> = {}, ota?: DeviceRecord['ota']): DeviceRecord {
  return { id: 'd1', status: { online: true, fw: '1.0.0', model: 'LT-100', ts: NOW, ...over }, ota };
}

const check = (d: DeviceRecord | undefined, allowDowngrade = false, f = fw) =>
  checkEligibility(d, f, NOW, DEFAULT_TIMEOUTS, allowDowngrade);

describe('checkEligibility', () => {
  it('accepts an online, compatible, older device', () => {
    expect(check(dev())).toBeNull();
  });

  it('skips offline and unknown devices', () => {
    expect(check(dev({ online: false }))).toBe('offline');
    expect(check(undefined)).toBe('offline');
  });

  it('skips incompatible models unless the firmware lists none', () => {
    expect(check(dev({ model: 'LT-200' }))).toBe('incompatible');
    expect(check(dev({ model: 'LT-200' }), false, { ...fw, models: [] })).toBeNull();
  });

  it('skips devices already on the target', () => {
    expect(check(dev({ fw: '2.0.0' }))).toBe('up-to-date');
  });

  it('skips downgrades unless allowed', () => {
    expect(check(dev({ fw: '3.1.0' }))).toBe('downgrade');
    expect(check(dev({ fw: '3.1.0' }), true)).toBeNull();
  });

  it('skips devices with a fresh in-progress update, but not a stale or finished one', () => {
    expect(check(dev({}, { jobId: 'x', phase: 'downloading', ts: NOW - 1000 }))).toBe('busy');
    expect(check(dev({}, { jobId: 'x', phase: 'downloading', ts: NOW - DEFAULT_TIMEOUTS.stallMs - 1 }))).toBeNull();
    expect(check(dev({}, { jobId: 'x', phase: 'failed', ts: NOW - 1000 }))).toBeNull();
  });
});
