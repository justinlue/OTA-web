import type { FirmwareEntry, SkipReason } from '../protocol/types';
import type { DeviceRecord, Timeouts } from './types';
import { compareVersions } from './versions';

const IN_PROGRESS = ['accepted', 'downloading', 'verifying', 'installing', 'rebooting'];

/** Why this device must be skipped for this firmware, or null when it may be updated now. */
export function checkEligibility(
  device: DeviceRecord | undefined,
  firmware: FirmwareEntry,
  now: number,
  t: Timeouts,
  allowDowngrade: boolean,
): SkipReason | null {
  const status = device?.status;
  if (!status || !status.online) return 'offline';
  if (firmware.models.length > 0 && !firmware.models.includes(status.model)) return 'incompatible';
  if (status.fw === firmware.version) return 'up-to-date';
  const ota = device.ota;
  if (ota && IN_PROGRESS.includes(ota.phase)) {
    const allowance = ota.phase === 'rebooting' ? t.rebootMs : t.stallMs;
    if (now - Math.min(ota.ts, now) <= allowance) return 'busy';
  }
  if (!allowDowngrade && status.fw && compareVersions(status.fw, firmware.version) > 0) return 'downgrade';
  return null;
}
