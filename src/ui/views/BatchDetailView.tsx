import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { batchViews, IN_PROGRESS_STATES, inProgressCount, leaseIsStale, summarize } from '../../core/batch';
import type { JobState, JobView } from '../../core/types';
import { OnlineDot, OtaCell } from '../components/OtaCell';
import { StackedBar } from '../components/StackedBar';
import { href, navigate, useEngine, useEngineState } from '../hooks';
import { S } from '../strings';

type Filter = 'all' | 'inprogress' | JobState;

const ROW_H = 38;

const matches = (v: JobView, f: Filter) =>
  f === 'all' || (f === 'inprogress' ? IN_PROGRESS_STATES.includes(v.state) : v.state === f);

export function BatchDetailView({ id, onOpenDevice }: { id: string; onOpenDevice: (id: string) => void }) {
  const engine = useEngine();
  const m = useEngineState((s) => s.batches.get(id));
  const lease = useEngineState((s) => s.leases.get(id));
  const devices = useEngineState((s) => s.devices);
  const now = useEngineState((s) => s.now);
  const timeouts = useEngineState((s) => s.settings.timeouts);
  const clientId = useEngineState((s) => s.clientId);
  const [filter, setFilter] = useState<Filter>('all');

  const views = useMemo(() => (m ? batchViews(m, devices, now, timeouts) : new Map<string, JobView>()), [m, devices, now, timeouts]);
  const summary = useMemo(() => summarize(views), [views]);
  const rows = useMemo(() => [...views].filter(([, v]) => matches(v, filter)), [views, filter]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    initialRect: { width: 1000, height: 600 },
  });

  if (!m) {
    return (
      <section className="view">
        <a href={href.batches}>{S.batch.back}</a>
        <p className="empty">{S.batch.notFound}</p>
      </section>
    );
  }

  const isOwner = lease?.owner === clientId;
  const stale = leaseIsStale(lease, now);
  const canAct = !m.archived && (isOwner || stale);
  const who = lease?.operator || lease?.owner || '?';
  const ago = lease ? S.ago(now - lease.heartbeat) : S.never;

  const takeOver = () => {
    if (!stale && !confirm(S.batch.confirmTakeOver(who))) return;
    engine.takeOver(id);
  };

  const counters: [Filter, string, number][] = [
    ['all', S.batch.all, summary.total],
    ['inprogress', S.batch.inProgress, inProgressCount(summary)],
    ['queued', S.state.queued, summary.counts.queued],
    ['success', S.state.success, summary.counts.success],
    ['failed', S.state.failed, summary.counts.failed],
    ['skipped', S.state.skipped, summary.counts.skipped],
    ['cancelled', S.state.cancelled, summary.counts.cancelled],
  ];

  return (
    <section className="view">
      <a href={href.batches} className="back">
        {S.batch.back}
      </a>
      <header className="view-head">
        <h1>{m.name}</h1>
        <span className="mono">→ {m.firmware.version}</span>
        <span className="muted small">
          {S.batch.created(new Date(m.createdAt).toLocaleString(), m.createdBy)} · {S.batch.maxInFlight(m.maxInFlight)}
        </span>
      </header>

      {m.archived ? (
        <p className="banner">{S.batch.archivedNote}</p>
      ) : isOwner ? (
        <p className="banner banner-ok">
          {S.batch.owner}
          {summary.counts.queued > 0 && <strong> {S.batch.keepOpen(summary.counts.queued)}</strong>}
        </p>
      ) : (
        <p className="banner banner-warn">
          {stale ? S.batch.stale(who, ago) : S.batch.ownedBy(who, ago)}{' '}
          <button onClick={takeOver}>{S.batch.takeOver}</button>
        </p>
      )}

      <div className="counters" role="tablist">
        {counters.map(([f, label, n]) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            className={`counter counter-${f}${filter === f ? ' active' : ''}`}
            onClick={() => setFilter(f)}
          >
            <span className="n">{n}</span>
            <span className="label">{label}</span>
          </button>
        ))}
      </div>
      <StackedBar summary={summary} />

      <div className="toolbar">
        <button className="primary" disabled={!canAct || summary.counts.failed + summary.counts.skipped === 0} onClick={() => engine.retryFailed(id)}>
          {S.batch.retryFailed}
        </button>
        <button disabled={!canAct || summary.counts.queued === 0} onClick={() => engine.cancelQueued(id)}>
          {S.batch.cancelQueued}
        </button>
        <span className="spacer" />
        {!m.archived && (
          <button disabled={!canAct} onClick={() => engine.archive(id)}>
            {S.batch.archive}
          </button>
        )}
        <button
          className="danger"
          disabled={!(isOwner || stale)}
          onClick={() => {
            if (confirm(S.batch.confirmDelete) && engine.deleteBatch(id)) navigate(href.batches);
          }}
        >
          {S.batch.delete}
        </button>
      </div>

      <div className="table batch-table" role="table">
        <div className="tr th" role="row">
          <span role="columnheader">{S.batch.cols.id}</span>
          <span role="columnheader">{S.batch.cols.online}</span>
          <span role="columnheader">{S.batch.cols.fw}</span>
          <span role="columnheader">{S.batch.cols.state}</span>
          <span role="columnheader">{S.batch.cols.attempts}</span>
          <span role="columnheader">{S.batch.cols.info}</span>
          <span role="columnheader">{S.batch.cols.actions}</span>
        </div>
        <div className="tbody" ref={scrollRef}>
          <div style={{ height: virt.getTotalSize(), position: 'relative' }}>
            {virt.getVirtualItems().map((vi) => {
              const [deviceId, v] = rows[vi.index];
              const st = devices.get(deviceId)?.status;
              const entry = m.entries[deviceId];
              const info = v.error ? `${v.error.code}${v.error.message ? `: ${v.error.message}` : ''}` : v.reason ? S.skip[v.reason] : '';
              return (
                <div
                  key={deviceId}
                  role="row"
                  className="tr clickable"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: ROW_H, transform: `translateY(${vi.start}px)` }}
                  onClick={() => onOpenDevice(deviceId)}
                >
                  <span role="cell" className="mono">{deviceId}</span>
                  <span role="cell"><OnlineDot online={st?.online} /></span>
                  <span role="cell" className="mono">{st?.fw || S.never}</span>
                  <span role="cell"><OtaCell view={v} /></span>
                  <span role="cell">{entry?.attempts ?? 0}</span>
                  <span role="cell" className={`small ellipsis${v.error ? ' fail-text' : ' muted'}`} title={info}>
                    {info}
                  </span>
                  <span role="cell" onClick={(e) => e.stopPropagation()}>
                    {['failed', 'skipped', 'cancelled'].includes(v.state) && (
                      <button className="small-btn" disabled={!canAct} onClick={() => engine.retry(id, [deviceId])}>
                        {S.batch.retry}
                      </button>
                    )}
                    {(v.state === 'queued' || v.state === 'downloading') && (
                      <button className="small-btn" disabled={!canAct} onClick={() => engine.cancelDevice(id, deviceId)}>
                        {S.batch.cancel}
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
