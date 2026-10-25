import { inProgressCount, type BatchSummary } from '../../core/batch';
import { S } from '../strings';

/** One bar for a whole batch: updated, failed, in progress, queued, skipped/cancelled. */
export function StackedBar({ summary }: { summary: BatchSummary }) {
  const { total, counts } = summary;
  if (total === 0) return null;
  const parts: [string, number, string][] = [
    ['success', counts.success, S.state.success],
    ['failed', counts.failed, S.state.failed],
    ['progress', inProgressCount(summary), S.batch.inProgress],
    ['queued', counts.queued, S.state.queued],
    ['skipped', counts.skipped + counts.cancelled, `${S.state.skipped} / ${S.state.cancelled}`],
  ];
  const title = parts.filter(([, n]) => n > 0).map(([, n, label]) => `${label}: ${n}`).join(' · ');
  return (
    <span className="stacked" title={title} role="img" aria-label={title}>
      {parts.map(([cls, n]) =>
        n > 0 ? <span key={cls} className={`seg seg-${cls}`} style={{ width: `${(n / total) * 100}%` }} /> : null,
      )}
    </span>
  );
}
