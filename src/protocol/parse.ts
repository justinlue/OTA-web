// Validation of incoming payloads. Anything malformed parses to null and is ignored.
import {
  DEVICE_PHASES,
  type BatchEntry,
  type BatchLease,
  type BatchManifest,
  type DevicePhase,
  type DeviceStatus,
  type FirmwareCatalog,
  type FirmwareEntry,
  type OtaError,
  type OtaReport,
} from './types';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

function json(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch {
    return undefined;
  }
}

export function parseStatus(payload: string): DeviceStatus | null {
  const v = json(payload);
  if (!isObj(v) || !isBool(v.online)) return null;
  // A Last Will is often just {"online":false}; the rest is kept from the previous status.
  if (!v.online && v.fw === undefined && v.model === undefined && v.ts === undefined) {
    return { online: false, fw: '', model: '', ts: 0 };
  }
  if (!isStr(v.fw) || !isStr(v.model) || !isNum(v.ts)) return null;
  return { online: v.online, fw: v.fw, model: v.model, ts: v.ts };
}

function parseError(v: unknown): OtaError | null {
  if (!isObj(v) || !isStr(v.code)) return null;
  const err: OtaError = { code: v.code, message: isStr(v.message) ? v.message : '' };
  if (isStr(v.phase)) err.phase = v.phase;
  if (isStr(v.detail)) err.detail = v.detail;
  return err;
}

export function parseOtaReport(payload: string): OtaReport | null {
  const v = json(payload);
  if (!isObj(v) || !isStr(v.jobId) || !isNum(v.ts)) return null;
  if (!DEVICE_PHASES.includes(v.phase as DevicePhase)) return null;
  const report: OtaReport = { jobId: v.jobId, phase: v.phase as DevicePhase, ts: v.ts };
  if (isNum(v.percent)) report.percent = Math.max(0, Math.min(100, v.percent));
  if (v.error !== undefined) {
    const err = parseError(v.error);
    if (!err) return null;
    report.error = err;
  } else if (report.phase === 'failed') {
    report.error = { code: 'UNKNOWN', message: '' };
  }
  return report;
}

function parseFirmware(v: unknown): FirmwareEntry | null {
  if (!isObj(v) || !isStr(v.version) || !isStr(v.url) || !isStr(v.sha256) || !isNum(v.size)) return null;
  const models = Array.isArray(v.models) ? v.models.filter(isStr) : [];
  return { version: v.version, url: v.url, sha256: v.sha256, size: v.size, models, notes: isStr(v.notes) ? v.notes : '' };
}

const ENTRY_STATES = ['queued', 'skipped', 'dispatched', 'cancelled'];

function parseEntry(v: unknown): BatchEntry | null {
  if (!isObj(v) || !ENTRY_STATES.includes(v.state as string) || !isNum(v.attempts)) return null;
  const e: BatchEntry = { state: v.state as BatchEntry['state'], attempts: v.attempts };
  if (isStr(v.reason)) e.reason = v.reason as BatchEntry['reason'];
  if (isStr(v.jobId)) e.jobId = v.jobId;
  if (isNum(v.sentAt)) e.sentAt = v.sentAt;
  return e;
}

export function parseBatch(payload: string): BatchManifest | null {
  const v = json(payload);
  if (!isObj(v) || !isStr(v.id) || !isNum(v.createdAt) || !isNum(v.maxInFlight) || !isNum(v.rev)) return null;
  const firmware = parseFirmware(v.firmware);
  if (!firmware || !isObj(v.entries)) return null;
  const entries: Record<string, BatchEntry> = {};
  for (const [id, raw] of Object.entries(v.entries)) {
    const e = parseEntry(raw);
    if (!e) return null;
    entries[id] = e;
  }
  return {
    id: v.id,
    name: isStr(v.name) ? v.name : v.id,
    createdAt: v.createdAt,
    createdBy: isStr(v.createdBy) ? v.createdBy : '',
    firmware,
    maxInFlight: v.maxInFlight,
    allowDowngrade: v.allowDowngrade === true,
    archived: v.archived === true,
    rev: v.rev,
    writer: isStr(v.writer) ? v.writer : '',
    entries,
  };
}

export function parseLease(payload: string): BatchLease | null {
  const v = json(payload);
  if (!isObj(v) || !isStr(v.owner) || !isNum(v.heartbeat)) return null;
  return { owner: v.owner, operator: isStr(v.operator) ? v.operator : '', heartbeat: v.heartbeat };
}

export function parseCatalog(payload: string): FirmwareCatalog | null {
  const v = json(payload);
  if (!isObj(v) || !Array.isArray(v.entries)) return null;
  const entries: FirmwareEntry[] = [];
  for (const raw of v.entries) {
    const fw = parseFirmware(raw);
    if (!fw) return null;
    entries.push(fw);
  }
  return { entries, rev: isNum(v.rev) ? v.rev : 0, writer: isStr(v.writer) ? v.writer : '' };
}
