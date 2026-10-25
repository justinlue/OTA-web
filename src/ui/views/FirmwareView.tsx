import { useState } from 'react';
import type { FirmwareEntry } from '../../protocol/types';
import { Modal } from '../components/Modal';
import { useEngine, useEngineState } from '../hooks';
import { S } from '../strings';

type Draft = { version: string; url: string; sha256: string; size: string; models: string; notes: string };

const toDraft = (e?: FirmwareEntry): Draft => ({
  version: e?.version ?? '',
  url: e?.url ?? '',
  sha256: e?.sha256 ?? '',
  size: e ? String(e.size) : '',
  models: e?.models.join(', ') ?? '',
  notes: e?.notes ?? '',
});

/** Validate a draft; returns the entry or the first problem. */
export function validateDraft(d: Draft, existing: readonly string[], editing?: string): FirmwareEntry | string {
  const version = d.version.trim();
  if (!version) return S.firmware.errors.version;
  if (version !== editing && existing.includes(version)) return S.firmware.errors.duplicate;
  if (!/^https?:\/\//i.test(d.url.trim())) return S.firmware.errors.url;
  if (!d.sha256.trim()) return S.firmware.errors.sha256;
  const size = Number(d.size);
  if (!Number.isInteger(size) || size <= 0) return S.firmware.errors.size;
  const models = d.models.split(',').map((m) => m.trim()).filter(Boolean);
  return { version, url: d.url.trim(), sha256: d.sha256.trim(), size, models, notes: d.notes.trim() };
}

export function FirmwareView() {
  const engine = useEngine();
  const catalog = useEngineState((s) => s.catalog);
  const [editing, setEditing] = useState<FirmwareEntry | 'new' | null>(null);

  return (
    <section className="view">
      <header className="view-head">
        <h1>{S.firmware.title}</h1>
        <span className="spacer" />
        <button className="primary" onClick={() => setEditing('new')}>
          {S.firmware.add}
        </button>
      </header>
      <p className="muted">{S.firmware.hint}</p>
      {catalog.entries.length === 0 ? (
        <p className="empty">{S.firmware.empty}</p>
      ) : (
        <div className="table firmware-table" role="table">
          <div className="tr th" role="row">
            <span role="columnheader">{S.firmware.cols.version}</span>
            <span role="columnheader">{S.firmware.cols.models}</span>
            <span role="columnheader">{S.firmware.cols.size}</span>
            <span role="columnheader">{S.firmware.cols.url}</span>
            <span role="columnheader">{S.firmware.cols.notes}</span>
            <span role="columnheader" />
          </div>
          {catalog.entries.map((e) => (
            <div key={e.version} className="tr" role="row">
              <span role="cell" className="mono">{e.version}</span>
              <span role="cell">{e.models.length ? e.models.join(', ') : S.firmware.anyModel}</span>
              <span role="cell">{S.bytes(e.size)}</span>
              <span role="cell" className="mono small ellipsis" title={`${e.url}\nsha256 ${e.sha256}`}>{e.url}</span>
              <span role="cell" className="small ellipsis" title={e.notes}>{e.notes}</span>
              <span role="cell" className="row-actions">
                <button className="small-btn" onClick={() => setEditing(e)}>
                  {S.firmware.edit}
                </button>
                <button
                  className="small-btn danger"
                  onClick={() => confirm(S.firmware.confirmDelete(e.version)) && engine.deleteFirmware(e.version)}
                >
                  {S.firmware.delete}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
      {editing && (
        <FirmwareForm
          entry={editing === 'new' ? undefined : editing}
          existing={catalog.entries.map((e) => e.version)}
          onClose={() => setEditing(null)}
          onSave={(entry) => {
            engine.saveFirmware(entry, editing === 'new' ? undefined : editing.version);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function FirmwareForm({
  entry,
  existing,
  onClose,
  onSave,
}: {
  entry?: FirmwareEntry;
  existing: string[];
  onClose: () => void;
  onSave: (e: FirmwareEntry) => void;
}) {
  const [d, setD] = useState<Draft>(toDraft(entry));
  const [error, setError] = useState('');
  const f = S.firmware.form;
  const field = (key: keyof Draft, label: string, props: Record<string, unknown> = {}) => (
    <label>
      {label}
      <input value={d[key]} onChange={(e) => setD({ ...d, [key]: e.target.value })} {...props} />
    </label>
  );
  return (
    <Modal title={entry ? `${S.firmware.edit} ${entry.version}` : S.firmware.add} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const r = validateDraft(d, existing, entry?.version);
          if (typeof r === 'string') setError(r);
          else onSave(r);
        }}
      >
        {field('version', f.version, { autoFocus: true, className: 'mono' })}
        {field('url', f.url, { className: 'mono', placeholder: 'https://' })}
        {field('sha256', f.sha256, { className: 'mono' })}
        {field('size', f.size, { inputMode: 'numeric' })}
        {field('models', f.models, { placeholder: 'LT-100, LT-200' })}
        <p className="muted small">{f.modelsHint}</p>
        {field('notes', f.notes)}
        {error && <p className="warn" role="alert">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            {f.cancel}
          </button>
          <button type="submit" className="primary">
            {f.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
