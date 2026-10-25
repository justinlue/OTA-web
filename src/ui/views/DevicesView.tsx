import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { deviceJobView } from '../../core/deviceView';
import { Modal } from '../components/Modal';
import { OnlineDot, OtaCell } from '../components/OtaCell';
import { StartOtaDialog } from '../components/StartOtaDialog';
import { filterRows, NO_FILTERS, parseIdList, type DeviceFilters, type DeviceRow } from '../deviceFilter';
import { useEngineState, useJobIndex } from '../hooks';
import { S } from '../strings';

const ROW_H = 38;

export function DevicesView({ onOpenDevice }: { onOpenDevice: (id: string) => void }) {
  const devices = useEngineState((s) => s.devices);
  const batches = useEngineState((s) => s.batches);
  const now = useEngineState((s) => s.now);
  const timeouts = useEngineState((s) => s.settings.timeouts);
  const index = useJobIndex();
  const [filters, setFilters] = useState<DeviceFilters>(NO_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pasteOpen, setPasteOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);

  const rows = useMemo<DeviceRow[]>(() => {
    const out: DeviceRow[] = [];
    for (const d of devices.values()) {
      const ref = index.get(d.id);
      out.push({ device: d, ref, view: deviceJobView(d, ref, batches, now, timeouts) });
    }
    return out.sort((a, b) => a.device.id.localeCompare(b.device.id));
  }, [devices, index, batches, now, timeouts]);

  const shown = useMemo(() => filterRows(rows, filters), [rows, filters]);
  const versions = useMemo(() => [...new Set(rows.map((r) => r.device.status?.fw).filter(Boolean) as string[])].sort(), [rows]);
  const models = useMemo(() => [...new Set(rows.map((r) => r.device.status?.model).filter(Boolean) as string[])].sort(), [rows]);

  const set = (patch: Partial<DeviceFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.device.id));

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    initialRect: { width: 1000, height: 600 },
  });

  return (
    <section className="view">
      <header className="view-head">
        <h1>{S.devices.title}</h1>
        <span className="muted">{S.devices.count(shown.length, rows.length)}</span>
      </header>

      <div className="toolbar">
        <input
          type="search"
          placeholder={S.devices.search}
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
          aria-label={S.devices.search}
        />
        <select value={filters.online} onChange={(e) => set({ online: e.target.value as DeviceFilters['online'] })} aria-label="Online filter">
          <option value="">{S.devices.allOnline}</option>
          <option value="online">{S.devices.online}</option>
          <option value="offline">{S.devices.offline}</option>
        </select>
        <select value={filters.fw} onChange={(e) => set({ fw: e.target.value })} aria-label="Firmware filter">
          <option value="">{S.devices.allVersions}</option>
          {versions.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
        <select value={filters.model} onChange={(e) => set({ model: e.target.value })} aria-label="Model filter">
          <option value="">{S.devices.allModels}</option>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <select value={filters.ota} onChange={(e) => set({ ota: e.target.value as DeviceFilters['ota'] })} aria-label="OTA filter">
          <option value="">{S.devices.allStates}</option>
          <option value="none">{S.devices.noJob}</option>
          <option value="inprogress">{S.devices.inProgress}</option>
          <option value="queued">{S.state.queued}</option>
          <option value="success">{S.state.success}</option>
          <option value="failed">{S.state.failed}</option>
          <option value="skipped">{S.state.skipped}</option>
          <option value="cancelled">{S.state.cancelled}</option>
        </select>
      </div>

      <div className="toolbar">
        <button onClick={() => setSelected(new Set([...selected, ...shown.map((r) => r.device.id)]))} disabled={shown.length === 0}>
          {S.devices.selectMatching(shown.length)}
        </button>
        <button onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
          {S.devices.clearSelection}
        </button>
        <button onClick={() => setPasteOpen(true)}>{S.devices.pasteIds}</button>
        <span className="spacer" />
        <button className="primary" disabled={selected.size === 0} onClick={() => setStartOpen(true)}>
          {S.devices.startOta(selected.size)}
        </button>
      </div>

      <div className="table devices-table" role="table">
        <div className="tr th" role="row">
          <span role="columnheader">
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={allShownSelected}
              onChange={() => {
                const n = new Set(selected);
                for (const r of shown) {
                  if (allShownSelected) n.delete(r.device.id);
                  else n.add(r.device.id);
                }
                setSelected(n);
              }}
            />
          </span>
          <span role="columnheader">{S.devices.cols.id}</span>
          <span role="columnheader">{S.devices.cols.model}</span>
          <span role="columnheader">{S.devices.cols.online}</span>
          <span role="columnheader">{S.devices.cols.fw}</span>
          <span role="columnheader">{S.devices.cols.ota}</span>
          <span role="columnheader">{S.devices.cols.seen}</span>
        </div>
        <div className="tbody" ref={scrollRef}>
          {rows.length === 0 ? (
            <p className="empty">{S.devices.empty}</p>
          ) : shown.length === 0 ? (
            <p className="empty">{S.devices.noMatch}</p>
          ) : (
            <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
              {virt.getVirtualItems().map((vi) => {
                const { device, view } = shown[vi.index];
                const st = device.status;
                return (
                  <div
                    key={device.id}
                    role="row"
                    className={`tr${selected.has(device.id) ? ' selected' : ''}`}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` }}
                    onClick={() => onOpenDevice(device.id)}
                  >
                    <span role="cell" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${device.id}`} checked={selected.has(device.id)} onChange={() => toggle(device.id)} />
                    </span>
                    <span role="cell" className="mono">{device.id}</span>
                    <span role="cell">{st?.model || S.never}</span>
                    <span role="cell"><OnlineDot online={st?.online} /></span>
                    <span role="cell" className="mono">{st?.fw || S.never}</span>
                    <span role="cell"><OtaCell view={view} /></span>
                    <span role="cell" className="muted">{st?.online ? S.online : st?.ts ? S.ago(now - st.ts) : S.never}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {pasteOpen && (
        <PasteDialog
          known={new Set(devices.keys())}
          onClose={() => setPasteOpen(false)}
          onSelect={(ids) => {
            setSelected(new Set(ids));
            setPasteOpen(false);
          }}
        />
      )}
      {startOpen && <StartOtaDialog deviceIds={[...selected]} onClose={() => setStartOpen(false)} onStarted={() => setSelected(new Set())} />}
    </section>
  );
}

function PasteDialog({ known, onClose, onSelect }: { known: ReadonlySet<string>; onClose: () => void; onSelect: (ids: string[]) => void }) {
  const [text, setText] = useState('');
  const { found, unknown } = parseIdList(text, known);
  return (
    <Modal title={S.paste.title} onClose={onClose}>
      <p className="muted">{S.paste.hint}</p>
      <textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} autoFocus aria-label={S.paste.title} className="mono" />
      <p>{S.paste.selected(found.length)}</p>
      {unknown.length > 0 && <p className="warn">{S.paste.unknown(unknown.length, unknown.slice(0, 5).join(', '))}</p>}
      <div className="actions">
        <button onClick={onClose}>{S.start.cancel}</button>
        <button className="primary" disabled={found.length === 0} onClick={() => onSelect(found)}>
          {S.paste.apply}
        </button>
      </div>
    </Modal>
  );
}
