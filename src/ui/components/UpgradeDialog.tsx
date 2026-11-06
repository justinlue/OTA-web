import { useMemo, useState } from 'react';
import { checkEligibility } from '../../core/eligibility';
import { MODULES, type FirmwareEntry, type ModuleId, type ModuleVersions, type SkipReason } from '../../protocol/types';
import { href, navigate, useEngine, useEngineState } from '../hooks';
import { S } from '../strings';
import { Modal } from './Modal';

/** Upgrade the selected devices: pick modules, an image for each, then start one batch. */
export function UpgradeDialog({ deviceIds, onClose, onStarted }: { deviceIds: string[]; onClose: () => void; onStarted: () => void }) {
  const engine = useEngine();
  const catalog = useEngineState((s) => s.catalog);
  const devices = useEngineState((s) => s.devices);
  const settings = useEngineState((s) => s.settings);
  const now = useEngineState((s) => s.now);

  const byModule = useMemo(() => {
    const out = new Map<ModuleId, FirmwareEntry[]>(MODULES.map((m) => [m, []]));
    for (const e of catalog.entries) out.get(e.module)?.push(e);
    return out;
  }, [catalog]);

  /** The image of this module that suits most of the selection. */
  const bestImage = (module: ModuleId): string => {
    let best = '';
    let bestN = -1;
    for (const fw of byModule.get(module) ?? []) {
      const n = deviceIds.filter((id) => checkEligibility(devices.get(id), [fw], now, settings.timeouts, false) === null).length;
      if (n > bestN) [best, bestN] = [fw.version, n];
    }
    return best;
  };

  // Chosen version per module. A module counts as chosen only while that image is still in
  // the catalog, so an entry deleted by another operator unticks it instead of vanishing.
  const [picked, setPicked] = useState<ModuleVersions>({});
  const [name, setName] = useState('');
  const [maxInFlight, setMaxInFlight] = useState(settings.defaultMaxInFlight);
  const [allowDowngrade, setAllowDowngrade] = useState(false);
  const [downgradeOk, setDowngradeOk] = useState(false);

  // Install order is module order, whatever order they were ticked in.
  const images = useMemo(
    () =>
      MODULES.flatMap((m) => {
        const img = picked[m] !== undefined && byModule.get(m)?.find((e) => e.version === picked[m]);
        return img ? [img] : [];
      }),
    [picked, byModule],
  );
  const chosen = (m: ModuleId) => images.some((img) => img.module === m);

  const toggleModule = (module: ModuleId) => {
    const next = { ...picked };
    if (chosen(module)) delete next[module];
    else next[module] = bestImage(module);
    setPicked(next);
    setDowngradeOk(false);
  };

  const preview = useMemo(() => {
    const skipped = new Map<SkipReason, string[]>();
    let eligible = 0;
    let downgrades = 0;
    if (images.length === 0) return { eligible, skipped, downgrades };
    for (const id of deviceIds) {
      const strict = checkEligibility(devices.get(id), images, now, settings.timeouts, false);
      const reason = allowDowngrade && strict === 'downgrade' ? null : strict;
      if (allowDowngrade && strict === 'downgrade') downgrades++;
      if (reason) skipped.set(reason, [...(skipped.get(reason) ?? []), id]);
      else eligible++;
    }
    return { eligible, skipped, downgrades };
  }, [images, deviceIds, devices, now, settings.timeouts, allowDowngrade]);

  const needsConfirm = allowDowngrade && preview.downgrades > 0 && !downgradeOk;
  const canStart = images.length > 0 && preview.eligible > 0 && maxInFlight >= 1 && !needsConfirm;

  const start = () => {
    if (images.length === 0) return;
    const id = engine.startBatch({ name, firmware: images, deviceIds, maxInFlight, allowDowngrade });
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
          <fieldset className="modules">
            <legend>{S.start.modules}</legend>
            {MODULES.map((m) => {
              const options = byModule.get(m) ?? [];
              const label = S.module[m];
              return (
                <div key={m} className="module-row">
                  <label className="check">
                    <input type="checkbox" checked={chosen(m)} disabled={options.length === 0} onChange={() => toggleModule(m)} />
                    {label}
                  </label>
                  {options.length === 0 ? (
                    <span className="muted small">{S.start.noImages}</span>
                  ) : (
                    chosen(m) && (
                      <select
                        aria-label={S.start.image(label)}
                        value={picked[m]}
                        onChange={(e) => {
                          setPicked({ ...picked, [m]: e.target.value });
                          setDowngradeOk(false);
                        }}
                      >
                        {options.map((e) => (
                          <option key={e.version} value={e.version}>
                            {e.version} ({e.models.length ? e.models.join(', ') : S.firmware.anyModel}) {e.notes && `· ${e.notes}`}
                          </option>
                        ))}
                      </select>
                    )
                  )}
                </div>
              );
            })}
            <p className="muted small">{S.start.modulesHint}</p>
          </fieldset>
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

      {catalog.entries.length > 0 && (
        <div className="preview">
          {images.length === 0 ? (
            <p className="muted">{S.start.pickModules}</p>
          ) : (
            <>
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
            </>
          )}
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
