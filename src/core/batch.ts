import type { BatchLease, BatchManifest } from '../protocol/types';
import { jobView } from './jobState';
import type { DeviceRecord, JobState, JobView, Timeouts } from './types';

export const LEASE_HEARTBEAT_MS = 10_000;
export const LEASE_STALE_MS = 30_000;

export type BatchSummary = {
  total: number;
  counts: Record<JobState, number>;
  /** Entries in a terminal state. */
  finished: number;
  done: boolean;
};

const ZERO: Record<JobState, number> = {
  queued: 0, sent: 0, accepted: 0, downloading: 0, verifying: 0, installing: 0,
  rebooting: 0, success: 0, failed: 0, skipped: 0, cancelled: 0,
};

export function batchViews(
  m: BatchManifest,
  devices: ReadonlyMap<string, DeviceRecord>,
  now: number,
  t: Timeouts,
): Map<string, JobView> {
  const out = new Map<string, JobView>();
  for (const [id, e] of Object.entries(m.entries)) out.set(id, jobView(e, devices.get(id), m.firmware.version, now, t));
  return out;
}

export function summarize(views: ReadonlyMap<string, JobView>): BatchSummary {
  const counts = { ...ZERO };
  let finished = 0;
  for (const v of views.values()) {
    counts[v.state]++;
    if (v.terminal) finished++;
  }
  return { total: views.size, counts, finished, done: views.size > 0 && finished === views.size };
}

/** Collapsed groups for counters and filters. */
export const IN_PROGRESS_STATES: readonly JobState[] = [
  'sent', 'accepted', 'downloading', 'verifying', 'installing', 'rebooting',
];

export function inProgressCount(s: BatchSummary): number {
  return IN_PROGRESS_STATES.reduce((n, st) => n + s.counts[st], 0);
}

export function leaseIsStale(lease: BatchLease | undefined, now: number): boolean {
  return !lease || now - lease.heartbeat > LEASE_STALE_MS;
}
