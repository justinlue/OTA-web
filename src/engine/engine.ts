// OtaEngine: owns the transport, folds broker messages into a vanilla Zustand store, and
// runs the once-a-second loop (dispatch, lease heartbeat, toasts). React only reads the
// store and calls the actions; everything here is testable without a DOM.
import { createStore, type StoreApi } from 'zustand/vanilla';
import { batchViews, LEASE_HEARTBEAT_MS, leaseIsStale, summarize } from '../core/batch';
import { applyCancelQueued, applyRetry, planDispatch } from '../core/dispatch';
import type { DeviceRecord, JobView } from '../core/types';
import { parseBatch, parseCatalog, parseLease, parseOtaReport, parseStatus } from '../protocol/parse';
import { parseTopic, topics } from '../protocol/topics';
import type { BatchLease, BatchManifest, FirmwareCatalog, FirmwareEntry } from '../protocol/types';
import { SimFleet } from '../sim/fleet';
import { MemoryBroker } from '../transport/memory';
import { MqttTransport } from '../transport/mqtt';
import type { ConnState, Transport } from '../transport/types';
import { saveSettings, type Settings } from './settings';

export type HistoryItem = { ts: number; phase: string; percent?: number; code?: string };

export type Toast = { id: number; kind: 'error' | 'success' | 'info'; text: string; batchId?: string };

export type EngineState = {
  conn: ConnState;
  connError?: string;
  clientId: string;
  settings: Settings;
  devices: Map<string, DeviceRecord>;
  batches: Map<string, BatchManifest>;
  leases: Map<string, BatchLease>;
  catalog: FirmwareCatalog;
  /** Phase transitions seen by this tab, per device. */
  history: Map<string, HistoryItem[]>;
  now: number;
  toasts: Toast[];
  /** Failed devices across active batches (for the tab title). */
  failedCount: number;
};

export type StartBatchInput = {
  name: string;
  firmware: FirmwareEntry;
  deviceIds: string[];
  maxInFlight: number;
  allowDowngrade: boolean;
};

export type TransportFactory = (settings: Settings, clientId: string) => { transport: Transport; cleanup?: () => void };

const HISTORY_CAP = 50;
const FLUSH_MS = 16;
const TICK_MS = 1000;

/** Default factory: the simulator's in-memory broker, or a real MQTT connection. */
export const defaultTransportFactory: TransportFactory = (settings, clientId) => {
  if (settings.conn.simulator) {
    const broker = new MemoryBroker();
    const fleet = new SimFleet(broker, settings.conn.topicPrefix, settings.sim);
    const transport = broker.client(clientId);
    const connect = transport.connect.bind(transport);
    transport.connect = async () => {
      await fleet.start();
      await connect();
    };
    return { transport, cleanup: () => fleet.stop() };
  }
  const { url, username, password } = settings.conn;
  return { transport: new MqttTransport({ url, username, password, clientId }) };
};

function randomId(n = 6): string {
  return Math.random().toString(36).slice(2, 2 + n).padEnd(n, '0');
}

export function newBatchId(now = Date.now()): string {
  const d = new Date(now);
  const p = (x: number) => String(x).padStart(2, '0');
  return `b-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${randomId(4)}`;
}

export class OtaEngine {
  readonly store: StoreApi<EngineState>;
  private transport: Transport | null = null;
  private cleanup: (() => void) | undefined;
  private unsubs: (() => void)[] = [];
  private pending: [string, string][] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private toastSeq = 0;
  /** Last seen state per `batchId/deviceId`, for failure toasts; null until seeded. */
  private seen: Map<string, string> | null = null;
  private doneBatches = new Set<string>();

  constructor(
    settings: Settings,
    private factory: TransportFactory = defaultTransportFactory,
  ) {
    this.store = createStore<EngineState>(() => ({
      conn: 'disconnected',
      clientId: `${settings.conn.clientIdPrefix}-${randomId()}`,
      settings,
      devices: new Map(),
      batches: new Map(),
      leases: new Map(),
      catalog: { entries: [], rev: 0, writer: '' },
      history: new Map(),
      now: Date.now(),
      toasts: [],
      failedCount: 0,
    }));
  }

  private get s(): EngineState {
    return this.store.getState();
  }

  private get t() {
    return topics(this.s.settings.conn.topicPrefix);
  }

  // ---- connection -------------------------------------------------------------------

  async connect(): Promise<void> {
    await this.disconnect(false);
    const { settings } = this.s;
    const clientId = `${settings.conn.clientIdPrefix}-${randomId()}`;
    this.store.setState({
      clientId,
      connError: undefined,
      devices: new Map(),
      batches: new Map(),
      leases: new Map(),
      catalog: { entries: [], rev: 0, writer: '' },
      history: new Map(),
      toasts: [],
      failedCount: 0,
    });
    this.seen = null;
    this.doneBatches.clear();
    const { transport, cleanup } = this.factory(settings, clientId);
    this.transport = transport;
    this.cleanup = cleanup;
    this.unsubs.push(
      transport.onState((conn, error) => this.store.setState({ conn, ...(error ? { connError: error } : {}) })),
      transport.onMessage((topic, payload) => this.enqueue(topic, payload)),
    );
    try {
      await transport.connect();
      await transport.subscribe(this.t.subscriptions());
    } catch (err) {
      this.store.setState({ conn: 'error', connError: err instanceof Error ? err.message : String(err) });
      await this.disconnect(false);
      this.store.setState({ conn: 'error' });
      throw err;
    }
    this.updateSettings({ autoConnect: true });
    this.tickTimer = setInterval(() => this.tick(), TICK_MS);
  }

  async disconnect(manual = true): Promise<void> {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.tickTimer = null;
    this.flushTimer = null;
    this.pending = [];
    const t = this.transport;
    this.transport = null;
    if (t) await t.disconnect();
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.cleanup?.();
    this.cleanup = undefined;
    if (manual) {
      this.store.setState({ conn: 'disconnected' });
      this.updateSettings({ autoConnect: false });
    }
  }

  updateSettings(patch: Partial<Settings>): void {
    const settings = { ...this.s.settings, ...patch };
    this.store.setState({ settings });
    saveSettings(settings);
  }

  // ---- incoming ---------------------------------------------------------------------

  private enqueue(topic: string, payload: string): void {
    this.pending.push([topic, payload]);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  /** Apply all buffered messages with one copy of each touched map. */
  flush(): void {
    this.flushTimer = null;
    const batch = this.pending;
    this.pending = [];
    if (batch.length === 0) return;
    const st = this.s;
    const prefix = st.settings.conn.topicPrefix;
    let devices: Map<string, DeviceRecord> | null = null;
    let history: Map<string, HistoryItem[]> | null = null;
    let batches: Map<string, BatchManifest> | null = null;
    let leases: Map<string, BatchLease> | null = null;
    let catalog: FirmwareCatalog | null = null;

    for (const [topic, payload] of batch) {
      const p = parseTopic(prefix, topic);
      if (!p) continue;
      switch (p.kind) {
        case 'status': {
          const status = parseStatus(payload);
          if (!status) break;
          devices ??= new Map(st.devices);
          const prev = devices.get(p.deviceId);
          // A bare Last Will keeps what we knew about the device.
          const merged =
            !status.online && !status.fw && prev?.status
              ? { ...prev.status, online: false }
              : status;
          devices.set(p.deviceId, { ...prev, id: p.deviceId, status: merged });
          break;
        }
        case 'ota': {
          const ota = parseOtaReport(payload);
          if (!ota) break;
          devices ??= new Map(st.devices);
          const prev = devices.get(p.deviceId);
          devices.set(p.deviceId, { ...prev, id: p.deviceId, ota });
          history ??= new Map(st.history);
          const items = history.get(p.deviceId) ?? [];
          const last = items[items.length - 1];
          if (!last || last.phase !== ota.phase || last.ts !== ota.ts) {
            const item: HistoryItem = { ts: ota.ts, phase: ota.phase, percent: ota.percent, code: ota.error?.code };
            const same = last && last.phase === ota.phase;
            // Progress within a phase replaces the previous item instead of growing the list.
            const next = same ? [...items.slice(0, -1), item] : [...items, item];
            history.set(p.deviceId, next.slice(-HISTORY_CAP));
          }
          break;
        }
        case 'batch': {
          batches ??= new Map(st.batches);
          if (payload === '') {
            batches.delete(p.batchId);
            break;
          }
          const m = parseBatch(payload);
          if (!m) break;
          const local = batches.get(p.batchId);
          // Our own late echo must never roll the manifest back (it would re-dispatch).
          if (local && m.writer === st.clientId && local.writer === st.clientId && m.rev < local.rev) break;
          batches.set(p.batchId, m);
          break;
        }
        case 'lease': {
          leases ??= new Map(st.leases);
          if (payload === '') {
            leases.delete(p.batchId);
            break;
          }
          const l = parseLease(payload);
          if (!l) break;
          const local = leases.get(p.batchId);
          if (local && l.owner === st.clientId && local.owner === st.clientId && l.heartbeat < local.heartbeat) break;
          leases.set(p.batchId, l);
          break;
        }
        case 'catalog': {
          const c = payload === '' ? { entries: [], rev: 0, writer: '' } : parseCatalog(payload);
          if (!c) break;
          const local = catalog ?? st.catalog;
          if (c.writer === st.clientId && local.writer === st.clientId && c.rev < local.rev) break;
          catalog = c;
          break;
        }
      }
    }

    const patch: Partial<EngineState> = {};
    if (devices) patch.devices = devices;
    if (history) patch.history = history;
    if (batches) patch.batches = batches;
    if (leases) patch.leases = leases;
    if (catalog) patch.catalog = catalog;
    this.store.setState(patch);
  }

  // ---- loop -------------------------------------------------------------------------

  tick(now = Date.now()): void {
    this.flush();
    this.store.setState({ now });
    if (this.s.conn === 'connected') {
      for (const m of this.s.batches.values()) {
        if (!m.archived && this.isOwner(m.id)) this.drive(m.id, now);
      }
    }
    this.notify(now);
  }

  /** Dispatch what the throttle allows and keep our lease alive. */
  private drive(batchId: string, now: number): void {
    const m = this.s.batches.get(batchId);
    const lease = this.s.leases.get(batchId);
    if (!m) return;
    if (!lease || now - lease.heartbeat >= LEASE_HEARTBEAT_MS) this.writeLease(batchId, now);
    const plan = planDispatch(m, this.s.devices, now, this.s.settings.timeouts);
    if (!plan.changed) return;
    this.writeManifest(plan.manifest);
    for (const { deviceId, command } of plan.commands) {
      this.transport?.publish(this.t.cmd(deviceId), JSON.stringify(command), { qos: 1 });
    }
  }

  private notify(now: number): void {
    const { batches, devices, settings } = this.s;
    const seen = new Map<string, string>();
    const toasts: Omit<Toast, 'id'>[] = [];
    let failedCount = 0;
    for (const m of batches.values()) {
      if (m.archived) continue;
      const views = batchViews(m, devices, now, settings.timeouts);
      let newlyFailed = 0;
      let firstFailed = '';
      for (const [id, v] of views) {
        const key = `${m.id}/${id}`;
        seen.set(key, v.state);
        if (v.state === 'failed') {
          failedCount++;
          if (this.seen && this.seen.get(key) !== 'failed') {
            newlyFailed++;
            firstFailed ||= `${id}: ${v.error?.code ?? 'failed'}`;
          }
        }
      }
      if (newlyFailed === 1) toasts.push({ kind: 'error', text: `${firstFailed} (${m.name})`, batchId: m.id });
      else if (newlyFailed > 1) toasts.push({ kind: 'error', text: `${newlyFailed} devices failed in ${m.name}`, batchId: m.id });
      const sum = summarize(views);
      if (sum.done && !this.doneBatches.has(m.id)) {
        this.doneBatches.add(m.id);
        if (this.seen) {
          toasts.push({
            kind: sum.counts.failed > 0 ? 'info' : 'success',
            text: `${m.name} finished: ${sum.counts.success} updated, ${sum.counts.failed} failed, ${sum.counts.skipped} skipped`,
            batchId: m.id,
          });
        }
      } else if (!sum.done) {
        this.doneBatches.delete(m.id);
      }
    }
    this.seen = seen;
    if (toasts.length) this.store.setState({ toasts: [...this.s.toasts, ...toasts.map((t) => ({ ...t, id: ++this.toastSeq }))] });
    if (failedCount !== this.s.failedCount) this.store.setState({ failedCount });
  }

  dismissToast(id: number): void {
    this.store.setState({ toasts: this.s.toasts.filter((t) => t.id !== id) });
  }

  // ---- writes -----------------------------------------------------------------------

  private writeManifest(m: BatchManifest): void {
    const next = { ...m, rev: m.rev + 1, writer: this.s.clientId };
    this.store.setState({ batches: new Map(this.s.batches).set(next.id, next) });
    this.transport?.publish(this.t.batch(next.id), JSON.stringify(next), { retain: true, qos: 1 });
  }

  private writeLease(batchId: string, now: number): void {
    const lease: BatchLease = { owner: this.s.clientId, operator: this.s.settings.conn.operator, heartbeat: now };
    this.store.setState({ leases: new Map(this.s.leases).set(batchId, lease) });
    this.transport?.publish(this.t.lease(batchId), JSON.stringify(lease), { retain: true, qos: 1 });
  }

  isOwner(batchId: string): boolean {
    return this.s.leases.get(batchId)?.owner === this.s.clientId;
  }

  /** May this tab change the batch right now (owner, or nobody is holding it)? */
  canAct(batchId: string): boolean {
    return this.isOwner(batchId) || leaseIsStale(this.s.leases.get(batchId), this.s.now);
  }

  private mutate(batchId: string, fn: (m: BatchManifest) => BatchManifest): boolean {
    const m = this.s.batches.get(batchId);
    if (!m || !this.canAct(batchId)) return false;
    if (!this.isOwner(batchId)) this.writeLease(batchId, Date.now());
    this.writeManifest(fn(m));
    return true;
  }

  // ---- actions ----------------------------------------------------------------------

  startBatch(input: StartBatchInput): string {
    const now = Date.now();
    const id = newBatchId(now);
    const entries: BatchManifest['entries'] = {};
    for (const d of input.deviceIds) entries[d] = { state: 'queued', attempts: 0 };
    const m: BatchManifest = {
      id,
      name: input.name.trim() || `${input.firmware.version} × ${input.deviceIds.length}`,
      createdAt: now,
      createdBy: this.s.settings.conn.operator || this.s.clientId,
      firmware: input.firmware,
      maxInFlight: Math.max(1, Math.floor(input.maxInFlight)),
      allowDowngrade: input.allowDowngrade,
      archived: false,
      rev: 0,
      writer: this.s.clientId,
      entries,
    };
    this.writeLease(id, now);
    this.writeManifest(m);
    this.drive(id, now);
    return id;
  }

  takeOver(batchId: string): void {
    this.writeLease(batchId, Date.now());
  }

  retry(batchId: string, deviceIds: string[]): boolean {
    if (!this.mutate(batchId, (m) => applyRetry(m, deviceIds))) return false;
    this.drive(batchId, Date.now());
    return true;
  }

  /** Retry every failed or skipped device in the batch. */
  retryFailed(batchId: string): boolean {
    const ids = [...this.views(batchId)].filter(([, v]) => v.state === 'failed' || v.state === 'skipped').map(([id]) => id);
    return ids.length > 0 && this.retry(batchId, ids);
  }

  cancelQueued(batchId: string): boolean {
    return this.mutate(batchId, (m) => applyCancelQueued(m));
  }

  /** Cancel one device: drop it from the queue, or ask it to stop if still downloading. */
  cancelDevice(batchId: string, deviceId: string): boolean {
    const m = this.s.batches.get(batchId);
    const entry = m?.entries[deviceId];
    if (!m || !entry || !this.canAct(batchId)) return false;
    if (entry.state === 'queued') return this.mutate(batchId, (b) => applyCancelQueued(b, [deviceId]));
    const v = this.views(batchId).get(deviceId);
    if (entry.jobId && v?.state === 'downloading') {
      this.transport?.publish(this.t.cmd(deviceId), JSON.stringify({ type: 'cancel', jobId: entry.jobId }), { qos: 1 });
      return true;
    }
    return false;
  }

  archive(batchId: string): boolean {
    return this.mutate(batchId, (m) => applyCancelQueued({ ...m, archived: true }));
  }

  deleteBatch(batchId: string): boolean {
    if (!this.canAct(batchId)) return false;
    this.transport?.publish(this.t.batch(batchId), '', { retain: true, qos: 1 });
    this.transport?.publish(this.t.lease(batchId), '', { retain: true, qos: 1 });
    const batches = new Map(this.s.batches);
    batches.delete(batchId);
    const leases = new Map(this.s.leases);
    leases.delete(batchId);
    this.store.setState({ batches, leases });
    return true;
  }

  views(batchId: string): Map<string, JobView> {
    const m = this.s.batches.get(batchId);
    return m ? batchViews(m, this.s.devices, this.s.now, this.s.settings.timeouts) : new Map();
  }

  /** Add or replace (by `replaces`, else by version) a catalog entry. */
  saveFirmware(entry: FirmwareEntry, replaces?: string): void {
    const key = replaces ?? entry.version;
    const entries = this.s.catalog.entries.filter((e) => e.version !== key && e.version !== entry.version);
    this.writeCatalog([...entries, entry]);
  }

  deleteFirmware(version: string): void {
    this.writeCatalog(this.s.catalog.entries.filter((e) => e.version !== version));
  }

  private writeCatalog(entries: FirmwareEntry[]): void {
    const catalog: FirmwareCatalog = { entries, rev: this.s.catalog.rev + 1, writer: this.s.clientId };
    this.store.setState({ catalog });
    this.transport?.publish(this.t.catalog(), JSON.stringify(catalog), { retain: true, qos: 1 });
  }
}
