// Wire types for the OTA MQTT protocol. See docs/protocol.md.

export type DevicePhase =
  | 'accepted'
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'rebooting'
  | 'done'
  | 'failed'
  | 'cancelled';

export const DEVICE_PHASES: readonly DevicePhase[] = [
  'accepted',
  'downloading',
  'verifying',
  'installing',
  'rebooting',
  'done',
  'failed',
  'cancelled',
];

export const DEVICE_ERROR_CODES = [
  'DOWNLOAD_FAILED',
  'CHECKSUM_MISMATCH',
  'INSUFFICIENT_STORAGE',
  'LOW_BATTERY',
  'SIGNAL_LOST',
  'FLASH_WRITE_FAILED',
  'ROLLED_BACK',
  'BUSY',
  'VERSION_REJECTED',
] as const;

/** Codes the UI derives itself; devices never send these. */
export const UI_ERROR_CODES = ['NO_ACK', 'STALLED'] as const;

export type OtaError = {
  code: string;
  message: string;
  /** The phase the update was in when it failed. */
  phase?: string;
  detail?: string;
};

/** `P/dev/{id}/status`, retained, also the device's Last Will. */
export type DeviceStatus = {
  online: boolean;
  fw: string;
  model: string;
  ts: number;
};

/** `P/dev/{id}/ota`, retained: the device's latest OTA report. */
export type OtaReport = {
  jobId: string;
  phase: DevicePhase;
  percent?: number;
  error?: OtaError;
  ts: number;
};

export type OtaCommand = {
  type: 'ota';
  jobId: string;
  version: string;
  url: string;
  sha256: string;
  size: number;
};

export type CancelCommand = { type: 'cancel'; jobId: string };

export type DeviceCommand = OtaCommand | CancelCommand;

export type FirmwareEntry = {
  version: string;
  url: string;
  sha256: string;
  size: number;
  /** Compatible hardware models; empty means any. */
  models: string[];
  notes: string;
};

/** `P/firmware/catalog`, retained. */
export type FirmwareCatalog = {
  entries: FirmwareEntry[];
  rev: number;
  writer: string;
};

export type SkipReason = 'offline' | 'incompatible' | 'up-to-date' | 'busy' | 'downgrade';

export type BatchEntry = {
  state: 'queued' | 'skipped' | 'dispatched' | 'cancelled';
  reason?: SkipReason;
  jobId?: string;
  sentAt?: number;
  attempts: number;
};

/** `P/batch/{id}`, retained. Only the lease owner writes it. */
export type BatchManifest = {
  id: string;
  name: string;
  createdAt: number;
  createdBy: string;
  firmware: FirmwareEntry;
  maxInFlight: number;
  allowDowngrade: boolean;
  archived: boolean;
  /** Bumped on every write by `writer`; guards against our own late echoes. */
  rev: number;
  writer: string;
  /** Insertion order is dispatch order. */
  entries: Record<string, BatchEntry>;
};

/** `P/batch/{id}/lease`, retained. */
export type BatchLease = {
  owner: string;
  operator: string;
  heartbeat: number;
};
