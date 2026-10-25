import { useMemo } from 'react';
import { batchViews, leaseIsStale, summarize } from '../../core/batch';
import { StackedBar } from '../components/StackedBar';
import { href, navigate, useEngineState } from '../hooks';
import { S } from '../strings';

export function BatchesView({ archived }: { archived: boolean }) {
  const batches = useEngineState((s) => s.batches);
  const leases = useEngineState((s) => s.leases);
  const devices = useEngineState((s) => s.devices);
  const now = useEngineState((s) => s.now);
  const timeouts = useEngineState((s) => s.settings.timeouts);
  const clientId = useEngineState((s) => s.clientId);

  const rows = useMemo(
    () =>
      [...batches.values()]
        .filter((m) => m.archived === archived)
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((m) => ({ m, summary: summarize(batchViews(m, devices, now, timeouts)) })),
    [batches, devices, now, timeouts, archived],
  );

  return (
    <section className="view">
      <header className="view-head">
        <h1>{S.batches.title}</h1>
        <nav className="tabs">
          <a href={href.batches} className={!archived ? 'active' : undefined}>
            {S.batches.active}
          </a>
          <a href={href.archived} className={archived ? 'active' : undefined}>
            {S.batches.archived}
          </a>
        </nav>
      </header>
      {rows.length === 0 ? (
        <p className="empty">{archived ? S.batches.emptyArchived : S.batches.empty}</p>
      ) : (
        <div className="table batches-table" role="table">
          <div className="tr th" role="row">
            <span role="columnheader">{S.batches.cols.name}</span>
            <span role="columnheader">{S.batches.cols.fw}</span>
            <span role="columnheader">{S.batches.cols.created}</span>
            <span role="columnheader">{S.batches.cols.by}</span>
            <span role="columnheader">{S.batches.cols.owner}</span>
            <span role="columnheader">{S.batches.cols.progress}</span>
          </div>
          {rows.map(({ m, summary }) => {
            const lease = leases.get(m.id);
            const owner =
              lease?.owner === clientId
                ? S.batches.thisTab
                : leaseIsStale(lease, now)
                  ? S.batches.nobody
                  : lease?.operator || lease?.owner;
            return (
              <div key={m.id} className="tr clickable" role="row" onClick={() => navigate(href.batch(m.id))}>
                <span role="cell">
                  <a href={href.batch(m.id)} onClick={(e) => e.stopPropagation()}>
                    {m.name}
                  </a>
                </span>
                <span role="cell" className="mono">{m.firmware.version}</span>
                <span role="cell" className="muted">{S.ago(now - m.createdAt)}</span>
                <span role="cell">{m.createdBy}</span>
                <span role="cell" className="muted">{archived ? S.never : owner}</span>
                <span role="cell" className="progress-cell">
                  <StackedBar summary={summary} />
                  <span className="small muted">
                    {summary.counts.success}/{summary.total}
                    {summary.counts.failed > 0 && <span className="fail-count"> · {summary.counts.failed} {S.state.failed.toLowerCase()}</span>}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
