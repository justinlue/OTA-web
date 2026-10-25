import { useEffect } from 'react';
import { deviceJobView } from '../../core/deviceView';
import { explainError } from '../../protocol/errors';
import { href, useEngine, useEngineState, useJobIndex } from '../hooks';
import { S } from '../strings';
import { OnlineDot, OtaCell } from './OtaCell';

const time = (ts: number) => new Date(ts).toLocaleTimeString();

/** Side drawer for one device: its current job, the failure cause, the observed timeline. */
export function DeviceDrawer({ deviceId, onClose }: { deviceId: string; onClose: () => void }) {
  const engine = useEngine();
  const device = useEngineState((s) => s.devices.get(deviceId));
  const batches = useEngineState((s) => s.batches);
  const history = useEngineState((s) => s.history.get(deviceId));
  const now = useEngineState((s) => s.now);
  const timeouts = useEngineState((s) => s.settings.timeouts);
  const index = useJobIndex();

  useEffect(() => {
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [onClose]);

  const ref = index.get(deviceId);
  const batch = ref ? batches.get(ref.batchId) : undefined;
  const entry = batch?.entries[deviceId];
  const view = device ? deviceJobView(device, ref, batches, now, timeouts) : null;
  // `now` ticks every second, so this follows lease changes without its own subscription.
  const canAct = !!batch && !batch.archived && engine.canAct(batch.id);
  const retryable = view && ['failed', 'skipped', 'cancelled'].includes(view.state);
  const cancellable = view && (view.state === 'queued' || view.state === 'downloading');
  const st = device?.status;
  const err = view?.error;

  return (
    <aside className="drawer" role="complementary" aria-label={`${S.drawer.title} ${deviceId}`}>
      <header className="drawer-head">
        <h2 className="mono">{deviceId}</h2>
        <button className="icon-btn" onClick={onClose} aria-label={S.drawer.close}>
          ×
        </button>
      </header>

      <dl className="kv">
        <dt>{S.drawer.model}</dt>
        <dd>{st?.model || S.never}</dd>
        <dt>{S.drawer.status}</dt>
        <dd>
          <OnlineDot online={st?.online} />
        </dd>
        <dt>{S.drawer.firmware}</dt>
        <dd className="mono">{st?.fw || S.never}</dd>
        <dt>{S.drawer.lastSeen}</dt>
        <dd>{st?.ts ? `${S.ago(now - st.ts)} (${time(st.ts)})` : S.never}</dd>
      </dl>

      {!view ? (
        <p className="muted">{S.drawer.noJob}</p>
      ) : (
        <>
          <dl className="kv">
            {batch && (
              <>
                <dt>{S.drawer.batch}</dt>
                <dd>
                  <a href={href.batch(batch.id)}>{batch.name}</a>
                </dd>
                <dt>{S.drawer.target}</dt>
                <dd className="mono">{batch.firmware.version}</dd>
              </>
            )}
            <dt>{S.drawer.state}</dt>
            <dd>
              <OtaCell view={view} />
            </dd>
            {entry && entry.attempts > 0 && (
              <>
                <dt>{S.drawer.attempt}</dt>
                <dd>{entry.attempts}</dd>
              </>
            )}
            {view.reason && (
              <>
                <dt>{S.drawer.skipReason}</dt>
                <dd>{S.skip[view.reason]}</dd>
              </>
            )}
          </dl>

          {err && (
            <div className="error-box" role="alert">
              <p className="error-code mono">{err.code}</p>
              <p>{explainError(err.code)}</p>
              <dl className="kv">
                {err.phase && (
                  <>
                    <dt>{S.drawer.failedIn}</dt>
                    <dd>{S.phase(err.phase)}</dd>
                  </>
                )}
                {err.message && (
                  <>
                    <dt>{S.drawer.deviceMessage}</dt>
                    <dd className="mono">{err.message}</dd>
                  </>
                )}
                {err.detail && (
                  <>
                    <dt>{S.drawer.detail}</dt>
                    <dd className="mono">{err.detail}</dd>
                  </>
                )}
              </dl>
            </div>
          )}

          {batch && (retryable || cancellable) && (
            <div className="actions start">
              {!canAct && <p className="muted small">{S.drawer.takeOverToAct}</p>}
              {retryable && (
                <button className="primary" disabled={!canAct} onClick={() => engine.retry(batch.id, [deviceId])}>
                  {S.drawer.retry}
                </button>
              )}
              {cancellable && (
                <button disabled={!canAct} onClick={() => engine.cancelDevice(batch.id, deviceId)}>
                  {S.drawer.cancel}
                </button>
              )}
            </div>
          )}
        </>
      )}

      <h3>{S.drawer.timeline}</h3>
      <p className="muted small">{S.drawer.timelineNote}</p>
      {history && history.length > 0 ? (
        <ol className="timeline">
          {history.map((h, i) => (
            <li key={i} className={h.phase === 'failed' ? 'failed' : undefined}>
              <span className="mono small">{time(h.ts)}</span> {S.phase(h.phase)}
              {h.percent !== undefined && ` ${h.percent}%`}
              {h.code && <span className="mono"> · {h.code}</span>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted small">{S.drawer.noHistory}</p>
      )}
    </aside>
  );
}
