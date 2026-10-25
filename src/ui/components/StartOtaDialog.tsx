import { useMemo, useState } from 'react';
import { checkEligibility } from '../../core/eligibility';
import type { SkipReason } from '../../protocol/types';
import { href, navigate, useEngine, useEngineState } from '../hooks';
import { S } from '../strings';
import { Modal } from './Modal';

export function StartOtaDialog({ deviceIds, onClose, onStarted }: { deviceIds: string[]; onClose: () => void; onStarted: () => void }) {
  const engine = useEngine();
  const catalog = useEngineState((s) => s.catalog);
  const devices = useEngineState((s) => s.devices);
  const settings = useEngineState((s) => s.settings);
  const now = useEngineState((s) => s.now);

  // Preselect the firmware that suits most of the selection.
  const [version, setVersion] = useState(() => {
    let best = '';
    let bestN = -1;
    for (const fw of catalog.entries) {
      const n = deviceIds.filter((id) => checkEligibility(devices.get(id), fw, now, settings.timeouts, false) === null).length;
      if (n > bestN) [best, bestN] = [fw.version, n];
    }
    return best;
  });
  const [name, setName] = useState('');
  const [maxInFlight, setMaxInFlight] = useState(settings.defaultMaxInFlight);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [downgradeOk, setDowngradeOk] = useState(false);
  const firmware = catalog.entries.find((e) => e.version === version);

  const preview = useMemo(() => {
    const skipped = new Map<SkipReason, string[]>();
    let eligible = 0;
    let downgrades = 0;
    if (!firmware) return { eligible, skipped, downgrades };
    for (const id of deviceIds) {
      const strict = checkEligibility(devices.get(id), firmware, now, settings.timeouts, false);
      const reason = allowDowngrade && strict === 'downgrade' ? null : strict;
      if (allowDowngrade && strict === 'downgrade') downgrades++;
      if (reason) skipped.set(reason, [...(skipped.get(reason) ?? []), id]);
      else eligible++;
    }
    return { eligible, skipped, downgrades };
  }, [firmware, deviceIds, devices, now, settings.timeouts, allowDowngrade]);

  const needsConfirm = allowDowngrade && preview.downgrades > 0 && !downgradeOk;
  const canStart = !!firmware && preview.eligible > 0 && maxInFlight >= 1 && !needsConfirm;

  const start = () => {
    if (!firmware) return;
    const id = engine.startBatch({ name, firmware, deviceIds, maxInFlight, allowDowngrade });
    onStarted();
    onClose();
    navigate(href.batch(id));
  };

  return (
    <Modal title={S.start.title(deviceIds.length)} onClose={onClose} wide>
      {catalog.entries.length === 0 ? (
        <p className="warn">{S.start.noCatalog}</p>
      ) : (
        <div className="form">
          <label>
            {S.start.firmware}
            <select value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="" disabled>
                {S.start.pickFirmware}
              </option>
              {catalog.entries.map((e) => (
                <option key={e.version} value={e.version}>
                  {e.version} ({e.models.length ? e.models.join(', ') : S.firmware.anyModel}) {e.notes && `· ${e.notes}`}
                </option>
              ))}
            </select>
          </label>
          <label>
            {S.start.name}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={S.start.namePlaceholder} />
          </label>
          <label className="narrow">
            {S.start.maxInFlight}
            <input type="number" min={1} value={maxInFlight} onChange={(e) => setMaxInFlight(Number(e.target.value))} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={allowDowngrade}
              onChange={(e) => {
                setAllowDowngrade(e.target.checked);
                setDowngradeOk(false);
              }}
            />
            {S.start.allowDowngrade}
          </label>
          {allowDowngrade && preview.downgrades > 0 && (
            <label className="check warn">
              <input type="checkbox" checked={downgradeOk} onChange={(e) => setDowngradeOk(e.target.checked)} />
              {S.start.confirmDowngrade(preview.downgrades)}
            </label>
          )}
        </div>
      )}

      {firmware && (
        <div className="preview">
          <p className="ok">{S.start.eligible(preview.eligible)}</p>
          {preview.skipped.size > 0 && (
            <>
              <p className="warn">{S.start.skipped([...preview.skipped.values()].reduce((n, l) => n + l.length, 0))}</p>
              <ul className="skip-list">
                {[...preview.skipped].map(([reason, ids]) => (
                  <li key={reason}>
                    <details>
                      <summary>
                        {S.skip[reason]}: {ids.length}
                      </summary>
                      <p className="mono small">{ids.join(', ')}</p>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="muted small">{S.start.recheck}</p>
          <p className="muted small">{S.start.keepOpen}</p>
        </div>
      )}

      <div className="actions">
        <button onClick={onClose}>{S.start.cancel}</button>
        <button className="primary" disabled={!canStart} onClick={start}>
          {S.start.submit}
        </button>
      </div>
    </Modal>
  );
}
