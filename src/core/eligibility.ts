import type { FirmwareEntry, SkipReason } from '../protocol/types';
import type { DeviceRecord, Timeouts } from './types';
import { compareVersions } from './versions';

const IN_PROGRESS = ['accepted', 'downloading', 'verifying', 'installing', 'rebooting'];

/** The images this device still needs: those whose module is not already on that version. */
export function pendingImages(device: DeviceRecord | undefined, images: readonly FirmwareEntry[]): FirmwareEntry[] {
  const running = device?.status?.modules ?? {};
  return images.filter((img) => running[img.module] !== img.version);
}

/** Why this device must be skipped for these module images, or null when it may be updated now. */
export function checkEligibility(
  device: DeviceRecord | undefined,
  images: readonly FirmwareEntry[],
  now: number,
  t: Timeouts,
  allowDowngrade: boolean,
): SkipReason | null {
  const status = device?.status;
  if (!status || !status.online) return 'offline';
  if (images.some((img) => img.models.length > 0 && !img.models.includes(status.model))) return 'incompatible';
  const pending = pendingImages(device, images);
  if (pending.length === 0) return 'up-to-date';
  const ota = device.ota;
  if (ota && IN_PROGRESS.includes(ota.phase)) {
    const allowance = ota.phase === 'rebooting' ? t.rebootMs : t.stallMs;
    if (now - Math.min(ota.ts, now) <= allowance) return 'busy';
  }
  if (!allowDowngrade) {
    const downgrade = pending.some((img) => {
      const cur = status.modules[img.module];
      return cur && compareVersions(cur, img.version) > 0;
    });
    if (downgrade) return 'downgrade';
  }
  return null;
}
