// The effective state of one device in a batch: a pure function of the batch entry, the
// device's retained topics, the clock and the timeouts. Nothing here is written back, so
// every tab looking at the same broker reaches the same verdict.
import type { BatchEntry, DevicePhase } from '../protocol/types';
import { TERMINAL_STATES, type DeviceRecord, type JobState, type JobView, type Timeouts } from './types';

/** Overall progress band [start, end] for each phase. */
const BANDS: Partial<Record<JobState, [number, number]>> = {
  sent: [0, 0],
  accepted: [2, 2],
  downloading: [2, 60],
  verifying: [62, 62],
  installing: [65, 95],
  rebooting: [97, 97],
  success: [100, 100],
};

function view(state: JobState, extra: Partial<JobView> = {}): JobView {
  const band = BANDS[state];
  let progress = 0;
  if (band) {
    const pct = extra.percent ?? 0;
    progress = Math.round(band[0] + ((band[1] - band[0]) * pct) / 100);
  }
  return { state, terminal: TERMINAL_STATES.includes(state), progress, ...extra };
}

export function jobView(
  entry: BatchEntry,
  device: DeviceRecord | undefined,
  target: string,
  now: number,
  t: Timeouts,
): JobView {
  if (entry.state === 'queued') return view('queued');
  if (entry.state === 'skipped') return view('skipped', { reason: entry.reason });
  if (entry.state === 'cancelled') return view('cancelled');

  const sentAt = entry.sentAt ?? now;
  const report = device?.ota && device.ota.jobId === entry.jobId ? device.ota : undefined;

  if (!report) {
    if (now - sentAt > t.ackMs) {
      return view('failed', { error: { code: 'NO_ACK', message: '', phase: 'sent' }, since: sentAt + t.ackMs });
    }
    return view('sent', { since: sentAt });
  }

  const ts = Math.min(report.ts, now);
  const stalled = (phase: string, allowance: number): JobView | null =>
    now - ts > allowance
      ? view('failed', { error: { code: 'STALLED', message: '', phase }, since: ts + allowance })
      : null;

  switch (report.phase) {
    case 'failed':
      return view('failed', { error: report.error ?? { code: 'UNKNOWN', message: '' }, since: ts });
    case 'cancelled':
      return view('cancelled', { since: ts });
    case 'done': {
      const status = device?.status;
      if (status && status.fw === target) return view('success', { since: ts });
      if (status && status.ts >= report.ts) {
        return view('failed', {
          error: { code: 'ROLLED_BACK', message: `Device is running ${status.fw || 'an unknown version'}`, phase: 'rebooting' },
          since: status.ts,
        });
      }
      return stalled('rebooting', t.rebootMs) ?? view('rebooting', { since: ts });
    }
    case 'rebooting':
      return stalled('rebooting', t.rebootMs) ?? view('rebooting', { since: ts });
    default: {
      const phase: DevicePhase = report.phase;
      return stalled(phase, t.stallMs) ?? view(phase, { percent: report.percent, since: ts });
    }
  }
}
