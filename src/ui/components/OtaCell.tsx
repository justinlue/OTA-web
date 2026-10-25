import type { JobView } from '../../core/types';
import { S } from '../strings';

/** Compact OTA state: a progress bar while running, a badge when finished. */
export function OtaCell({ view }: { view: JobView | null }) {
  if (!view) return <span className="muted">{S.devices.noJob}</span>;
  const label = S.state[view.state];
  if (view.state === 'failed') {
    return (
      <span className="badge badge-failed" title={view.error?.message || undefined}>
        {label}: {view.error?.code ?? '?'}
      </span>
    );
  }
  if (view.state === 'skipped') {
    return <span className="badge badge-skipped">{label}{view.reason ? `: ${S.skip[view.reason]}` : ''}</span>;
  }
  if (view.terminal || view.state === 'queued') {
    return <span className={`badge badge-${view.state}`}>{label}</span>;
  }
  const pct = view.percent !== undefined ? ` ${view.percent}%` : '';
  return (
    <span className="ota-progress" title={`${label}${pct}`}>
      <span className="bar" aria-hidden>
        <span style={{ width: `${view.progress}%` }} />
      </span>
      <span className="ota-label">
        {label}
        {pct}
      </span>
    </span>
  );
}

export function OnlineDot({ online }: { online: boolean | undefined }) {
  return (
    <span className={`online ${online ? 'is-online' : 'is-offline'}`}>
      <span className="dot" aria-hidden />
      {online ? S.online : S.offline}
    </span>
  );
}
