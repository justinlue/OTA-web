import { describe, expect, it } from 'vitest';
import type { DeviceStatus, FirmwareEntry } from '../protocol/types';
import { checkEligibility, pendingImages } from './eligibility';
import { DEFAULT_TIMEOUTS, type DeviceRecord } from './types';

const NOW = 1_000_000;
const lte: FirmwareEntry = { module: 'lte', version: '2.0.0', url: 'u', sha256: 's', size: 1, models: ['LT-100'], notes: '' };
const ble: FirmwareEntry = { module: 'ble', version: '3.2.0', url: 'u', sha256: 's', size: 1, models: [], notes: '' };

function dev(over: Partial<DeviceStatus> = {}, ota?: DeviceRecord['ota']): DeviceRecord {
  return {
    id: 'd1',
    status: { online: true, fw: '1.0.0', model: 'LT-100', ts: NOW, modules: { lte: '1.0.0', ble: '3.1.0' }, ...over },
    ota,
  };
}

const check = (d: DeviceRecord | undefined, allowDowngrade = false, images = [lte]) =>
  checkEligibility(d, images, NOW, DEFAULT_TIMEOUTS, allowDowngrade);

describe('checkEligibility', () => {
  it('accepts an online, compatible, older device', () => {
    expect(check(dev())).toBeNull();
  });

  it('skips offline and unknown devices', () => {
    expect(check(dev({ online: false }))).toBe('offline');
    expect(check(undefined)).toBe('offline');
  });

  it('skips incompatible models unless the image lists none', () => {
    expect(check(dev({ model: 'LT-200' }))).toBe('incompatible');
    expect(check(dev({ model: 'LT-200' }), false, [{ ...lte, models: [] }])).toBeNull();
  });

  it('skips a device when any chosen image is incompatible', () => {
    expect(check(dev({ model: 'LT-200' }), false, [ble, lte])).toBe('incompatible');
  });

  it('skips devices whose every chosen module is already on target', () => {
    expect(check(dev({ modules: { lte: '2.0.0' } }))).toBe('up-to-date');
    expect(check(dev({ modules: { lte: '2.0.0', ble: '3.2.0' } }), false, [ble, lte])).toBe('up-to-date');
    // One module still behind: the device is updated (for that module only).
    expect(check(dev({ modules: { lte: '2.0.0', ble: '3.1.0' } }), false, [ble, lte])).toBeNull();
  });

  it('updates a module the device does not report a version for', () => {
    expect(check(dev({ modules: {} }))).toBeNull();
  });

  it('skips downgrades of any module that would be sent, unless allowed', () => {
    expect(check(dev({ modules: { lte: '3.1.0' } }))).toBe('downgrade');
    expect(check(dev({ modules: { lte: '3.1.0' } }), true)).toBeNull();
    expect(check(dev({ modules: { lte: '1.0.0', ble: '4.0.0' } }), false, [ble, lte])).toBe('downgrade');
  });

  it('skips devices with a fresh in-progress update, but not a stale or finished one', () => {
    expect(check(dev({}, { jobId: 'x', phase: 'downloading', ts: NOW - 1000 }))).toBe('busy');
    expect(check(dev({}, { jobId: 'x', phase: 'downloading', ts: NOW - DEFAULT_TIMEOUTS.stallMs - 1 }))).toBeNull();
    expect(check(dev({}, { jobId: 'x', phase: 'failed', ts: NOW - 1000 }))).toBeNull();
  });
});

describe('pendingImages', () => {
  it('keeps only the images whose module is not already on that version, in order', () => {
    const d = dev({ modules: { lte: '2.0.0', ble: '3.1.0' } });
    expect(pendingImages(d, [ble, lte])).toEqual([ble]);
    expect(pendingImages(dev({ modules: {} }), [ble, lte])).toEqual([ble, lte]);
  });
});
