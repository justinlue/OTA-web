// Batch manifest transitions. Pure: the engine publishes the resulting manifest and commands.
import type { BatchEntry, BatchManifest, OtaCommand } from '../protocol/types';
import { checkEligibility } from './eligibility';
import { jobView } from './jobState';
import type { DeviceRecord, Timeouts } from './types';

export type DispatchPlan = {
  manifest: BatchManifest;
  commands: { deviceId: string; command: OtaCommand }[];
  changed: boolean;
};

export const jobIdFor = (batchId: string, deviceId: string, attempt: number) => `${batchId}:${deviceId}:${attempt}`;

export function planDispatch(
  m: BatchManifest,
  devices: ReadonlyMap<string, DeviceRecord>,
  now: number,
  t: Timeouts,
): DispatchPlan {
  let inFlight = 0;
  for (const [id, e] of Object.entries(m.entries)) {
    if (e.state === 'dispatched' && !jobView(e, devices.get(id), m.firmware.version, now, t).terminal) inFlight++;
  }
  let slots = m.maxInFlight - inFlight;
  const entries: Record<string, BatchEntry> = { ...m.entries };
  const commands: DispatchPlan['commands'] = [];
  let changed = false;

  for (const [id, e] of Object.entries(m.entries)) {
    if (slots <= 0) break;
    if (e.state !== 'queued') continue;
    changed = true;
    const reason = checkEligibility(devices.get(id), m.firmware, now, t, m.allowDowngrade);
    if (reason) {
      entries[id] = { state: 'skipped', reason, attempts: e.attempts };
      continue;
    }
    const attempts = e.attempts + 1;
    const jobId = jobIdFor(m.id, id, attempts);
    entries[id] = { state: 'dispatched', jobId, sentAt: now, attempts };
    const { version, url, sha256, size } = m.firmware;
    commands.push({ deviceId: id, command: { type: 'ota', jobId, version, url, sha256, size } });
    slots--;
  }

  return changed ? { manifest: { ...m, entries }, commands, changed } : { manifest: m, commands, changed };
}

export function applyRetry(m: BatchManifest, deviceIds: readonly string[]): BatchManifest {
  const entries = { ...m.entries };
  for (const id of deviceIds) {
    const e = entries[id];
    if (e) entries[id] = { state: 'queued', attempts: e.attempts };
  }
  return { ...m, entries };
}

export function applyCancelQueued(m: BatchManifest, deviceIds?: readonly string[]): BatchManifest {
  const entries = { ...m.entries };
  for (const [id, e] of Object.entries(entries)) {
    if (e.state === 'queued' && (!deviceIds || deviceIds.includes(id))) {
      entries[id] = { state: 'cancelled', attempts: e.attempts };
    }
  }
  return { ...m, entries };
}
