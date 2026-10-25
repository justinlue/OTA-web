// The OTA column of the device table: which batch a device's current job belongs to, and
// its effective state there.
import type { BatchManifest } from '../protocol/types';
import { jobView } from './jobState';
import type { DeviceRecord, JobView, Timeouts } from './types';

export type DeviceJobRef = { batchId: string; createdAt: number };

/** For each device, the most recent non-archived batch that contains it. */
export function deviceJobIndex(batches: Iterable<BatchManifest>): Map<string, DeviceJobRef> {
  const index = new Map<string, DeviceJobRef>();
  for (const m of batches) {
    if (m.archived) continue;
    for (const id of Object.keys(m.entries)) {
      const cur = index.get(id);
      if (!cur || cur.createdAt < m.createdAt) index.set(id, { batchId: m.id, createdAt: m.createdAt });
    }
  }
  return index;
}

/** View of a device's latest job: from its batch when we have one, else from its raw report. */
export function deviceJobView(
  device: DeviceRecord,
  ref: DeviceJobRef | undefined,
  batches: ReadonlyMap<string, BatchManifest>,
  now: number,
  t: Timeouts,
): JobView | null {
  const m = ref && batches.get(ref.batchId);
  const entry = m?.entries[device.id];
  if (m && entry) return jobView(entry, device, m.firmware.version, now, t);
  const ota = device.ota;
  if (!ota) return null;
  // No batch to tell us the target: trust the device's own "done".
  const target = ota.phase === 'done' ? (device.status?.fw ?? '') : '';
  return jobView({ state: 'dispatched', jobId: ota.jobId, sentAt: ota.ts, attempts: 1 }, device, target, now, t);
}
