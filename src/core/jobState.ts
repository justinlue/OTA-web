// The effective state of one device in a batch: a pure function of the batch entry, the
// device's retained topics, the clock and the timeouts. Nothing here is written back, so
// every tab looking at the same broker reaches the same verdict.
import { MODULE_LABELS, MODULES, type BatchEntry, type DevicePhase, type FirmwareEntry, type ModuleId, type ModuleVersions } from '../protocol/types';
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

/** Overall progress from the end of `accepted` to the end of `installing`: the per-module part. */
const MODULE_SPAN: [number, number] = [2, 95];

/**
 * Share a per-module phase's progress out over all the batch's modules, so the bar keeps
 * moving forward from one module to the next. Modules install in MODULES order.
 */
function spreadOverModules(v: JobView, module: ModuleId | undefined, targets: ModuleVersions): JobView {
  const order = MODULES.filter((m) => targets[m] !== undefined);
  const i = module ? order.indexOf(module) : -1;
  if (order.length < 2 || i < 0) return v;
  const [lo, hi] = MODULE_SPAN;
  const within = (v.progress - lo) / (hi - lo);
  return { ...v, progress: Math.round(lo + ((i + within) / order.length) * (hi - lo)) };
}

/** The version each module of a batch should end up on. */
export function targetVersions(images: readonly FirmwareEntry[]): ModuleVersions {
  const out: ModuleVersions = {};
  for (const img of images) out[img.module] = img.version;
  return out;
}

export function jobView(
  entry: BatchEntry,
  device: DeviceRecord | undefined,
  targets: ModuleVersions,
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
  // Spread into views and errors so `module` is only present when the device named one.
  const onModule = report.module ? { module: report.module } : {};
  const stalled = (phase: string, allowance: number): JobView | null =>
    now - ts > allowance
      ? view('failed', { error: { code: 'STALLED', message: '', phase, ...onModule }, since: ts + allowance, ...onModule })
      : null;

  switch (report.phase) {
    case 'failed': {
      const error = report.error ?? { code: 'UNKNOWN', message: '' };
      return view('failed', { error: { ...error, ...onModule }, since: ts, ...onModule });
    }
    case 'cancelled':
      return view('cancelled', { since: ts });
    case 'done': {
      const status = device?.status;
      if (!status) return stalled('rebooting', t.rebootMs) ?? view('rebooting', { since: ts });
      const behind = (Object.entries(targets) as [ModuleId, string][]).filter(([m, v]) => status.modules[m] !== v);
      if (behind.length === 0) return view('success', { since: ts });
      if (status.ts >= report.ts) {
        const message = behind
          .map(([m]) => `${MODULE_LABELS[m]} is running ${status.modules[m] || 'an unknown version'}`)
          .join(', ');
        return view('failed', {
          error: { code: 'ROLLED_BACK', message, phase: 'rebooting', module: behind[0][0] },
          since: status.ts,
        });
      }
      return stalled('rebooting', t.rebootMs) ?? view('rebooting', { since: ts });
    }
    case 'rebooting':
      return stalled('rebooting', t.rebootMs) ?? view('rebooting', { since: ts });
    default: {
      const phase: DevicePhase = report.phase;
      return (
        stalled(phase, t.stallMs) ??
        spreadOverModules(view(phase, { percent: report.percent, since: ts, ...onModule }), report.module, targets)
      );
    }
  }
}
