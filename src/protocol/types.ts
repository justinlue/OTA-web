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

/** Separately upgradable parts of a device. Order is install order within one job. */
export type ModuleId = 'ble' | 'mcu' | 'lte' | 'sensor';

export const MODULES: readonly ModuleId[] = ['ble', 'mcu', 'lte', 'sensor'];

/** Running version per module, as far as the device reports it. */
export type ModuleVersions = Partial<Record<ModuleId, string>>;

/** Names operators see for each module. */
export const MODULE_LABELS: Record<ModuleId, string> = { ble: 'BLE', mcu: 'MCU', lte: 'LTE', sensor: 'Sensor' };

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
  /** The module being updated when it failed (from the report, or the rolled-back module). */
  module?: ModuleId;
  detail?: string;
};

/** `P/dev/{id}/status`, retained, also the device's Last Will. */
export type DeviceStatus = {
  online: boolean;
  /** Overall firmware label, for display only; upgrades go by `modules`. */
  fw: string;
  model: string;
  ts: number;
  modules: ModuleVersions;
};

/** `P/dev/{id}/ota`, retained: the device's latest OTA report. */
export type OtaReport = {
  jobId: string;
  phase: DevicePhase;
  /** The module a multi-module job is working on. */
  module?: ModuleId;
  percent?: number;
  error?: OtaError;
  ts: number;
};

/** One module image as sent to a device. */
export type ModuleImage = {
  module: ModuleId;
  version: string;
  url: string;
  sha256: string;
  size: number;
};

export type OtaCommand = {
  type: 'ota';
  jobId: string;
  /** Installed in this order, as one job with one reboot at the end. */
  modules: ModuleImage[];
};

export type CancelCommand = { type: 'cancel'; jobId: string };

export type DeviceCommand = OtaCommand | CancelCommand;

export type FirmwareEntry = {
  module: ModuleId;
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
  /** One image per module, in install order; no module twice. */
  firmware: FirmwareEntry[];
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
