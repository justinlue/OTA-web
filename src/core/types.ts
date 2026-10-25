import type { DeviceStatus, OtaError, OtaReport, SkipReason } from '../protocol/types';

export type Timeouts = {
  /** No report for the current job this long after sending → NO_ACK. */
  ackMs: number;
  /** No report change this long → STALLED. */
  stallMs: number;
  /** Allowance for the rebooting phase instead of stallMs. */
  rebootMs: number;
};

export const DEFAULT_TIMEOUTS: Timeouts = { ackMs: 60_000, stallMs: 300_000, rebootMs: 600_000 };

/** What the UI knows about one device, straight from its retained topics. */
export type DeviceRecord = {
  id: string;
  status?: DeviceStatus;
  ota?: OtaReport;
};

export type JobState =
  | 'queued'
  | 'sent'
  | 'accepted'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'rebooting'
  | 'success'
  | 'failed'
  | 'skipped'
  | 'cancelled';

export const TERMINAL_STATES: readonly JobState[] = ['success', 'failed', 'skipped', 'cancelled'];

export type JobView = {
  state: JobState;
  terminal: boolean;
  /** Overall progress 0..100 across all phases. */
  progress: number;
  /** Percent within the current phase, when the device reports one. */
  percent?: number;
  error?: OtaError;
  reason?: SkipReason;
  /** Timestamp of the last change we know of. */
  since?: number;
};
