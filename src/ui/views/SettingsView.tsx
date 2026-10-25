import { useState } from 'react';
import type { ConnectionSettings, Settings, Theme } from '../../engine/settings';
import { href, navigate, useEngine, useEngineState } from '../hooks';
import { S } from '../strings';

export function SettingsView() {
  const engine = useEngine();
  const settings = useEngineState((s) => s.settings);
  const conn = useEngineState((s) => s.conn);
  const connError = useEngineState((s) => s.connError);
  const clientId = useEngineState((s) => s.clientId);
  const [busy, setBusy] = useState(false);
  const live = conn !== 'disconnected' && conn !== 'error';
  const c = settings.conn;

  const setConn = (patch: Partial<ConnectionSettings>) => engine.updateSettings({ conn: { ...c, ...patch } });
  const set = (patch: Partial<Settings>) => engine.updateSettings(patch);
  const num = (v: string, fallback: number) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

  const connect = async () => {
    setBusy(true);
    try {
      await engine.connect();
      navigate(href.devices);
    } catch {
      // connError is in the store and shown below.
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="view settings">
      <header className="view-head">
        <h1>{S.settings.title}</h1>
      </header>

      <fieldset className="card">
        <legend>{S.settings.connection}</legend>
        <fieldset disabled={live} className="plain">
          <label className="check">
            <input type="checkbox" checked={c.simulator} onChange={(e) => setConn({ simulator: e.target.checked })} />
            {S.settings.useSimulator}
          </label>
          {!c.simulator && (
            <>
              <label>
                {S.settings.url}
                <input className="mono" value={c.url} onChange={(e) => setConn({ url: e.target.value })} placeholder={S.settings.urlHint} />
              </label>
              <div className="row">
                <label>
                  {S.settings.username}
                  <input value={c.username} onChange={(e) => setConn({ username: e.target.value })} autoComplete="username" />
                </label>
                <label>
                  {S.settings.password}
                  <input type="password" value={c.password} onChange={(e) => setConn({ password: e.target.value })} autoComplete="current-password" />
                </label>
              </div>
              <label className="check">
                <input type="checkbox" checked={c.rememberPassword} onChange={(e) => setConn({ rememberPassword: e.target.checked })} />
                {S.settings.remember}
              </label>
            </>
          )}
          <label>
            {S.settings.operator}
            <input value={c.operator} onChange={(e) => setConn({ operator: e.target.value })} />
            <span className="muted small">{S.settings.operatorHint}</span>
          </label>
          <div className="row">
            <label>
              {S.settings.clientIdPrefix}
              <input className="mono" value={c.clientIdPrefix} onChange={(e) => setConn({ clientIdPrefix: e.target.value })} />
            </label>
            <label>
              {S.settings.topicPrefix}
              <input className="mono" value={c.topicPrefix} onChange={(e) => setConn({ topicPrefix: e.target.value })} />
            </label>
          </div>
        </fieldset>
        {live && <p className="muted small">{S.settings.lockedWhileConnected}</p>}
        {conn === 'error' && connError && (
          <p className="warn" role="alert">
            {connError}
          </p>
        )}
        <div className="actions start">
          {live ? (
            <button onClick={() => engine.disconnect()}>{S.settings.disconnect}</button>
          ) : (
            <button className="primary" disabled={busy || (!c.simulator && !c.url)} onClick={connect}>
              {S.settings.connect}
            </button>
          )}
          {live && <span className="muted small mono">{S.settings.clientId(clientId)}</span>}
        </div>
      </fieldset>

      {c.simulator && (
        <fieldset className="card">
          <legend>{S.settings.sim}</legend>
          <p className="muted small">{S.settings.simHint}</p>
          <div className="row">
            <label>
              {S.settings.simCount}
              <input type="number" min={1} max={5000} value={settings.sim.count} onChange={(e) => set({ sim: { ...settings.sim, count: num(e.target.value, 200) } })} />
            </label>
            <label>
              {S.settings.simFlap}
              <input type="number" min={0} max={100} value={Math.round(settings.sim.flapRate * 100)} onChange={(e) => set({ sim: { ...settings.sim, flapRate: num(e.target.value, 5) / 100 } })} />
            </label>
            <label>
              {S.settings.simFail}
              <input type="number" min={0} max={100} value={Math.round(settings.sim.failureRate * 100)} onChange={(e) => set({ sim: { ...settings.sim, failureRate: num(e.target.value, 15) / 100 } })} />
            </label>
            <label>
              {S.settings.simSpeed}
              <input type="number" min={1} max={1000} value={settings.sim.speed} onChange={(e) => set({ sim: { ...settings.sim, speed: Math.max(1, num(e.target.value, 10)) } })} />
            </label>
          </div>
        </fieldset>
      )}

      <fieldset className="card">
        <legend>{S.settings.timeouts}</legend>
        <div className="row">
          <label>
            {S.settings.ackTimeout}
            <input type="number" min={5} value={settings.timeouts.ackMs / 1000} onChange={(e) => set({ timeouts: { ...settings.timeouts, ackMs: num(e.target.value, 60) * 1000 } })} />
          </label>
          <label>
            {S.settings.stallTimeout}
            <input type="number" min={1} value={settings.timeouts.stallMs / 60_000} onChange={(e) => set({ timeouts: { ...settings.timeouts, stallMs: num(e.target.value, 5) * 60_000 } })} />
          </label>
          <label>
            {S.settings.rebootTimeout}
            <input type="number" min={1} value={settings.timeouts.rebootMs / 60_000} onChange={(e) => set({ timeouts: { ...settings.timeouts, rebootMs: num(e.target.value, 10) * 60_000 } })} />
          </label>
          <label>
            {S.settings.maxInFlight}
            <input type="number" min={1} value={settings.defaultMaxInFlight} onChange={(e) => set({ defaultMaxInFlight: Math.max(1, num(e.target.value, 50)) })} />
          </label>
        </div>
      </fieldset>

      <fieldset className="card">
        <legend>{S.settings.appearance}</legend>
        <label className="narrow">
          {S.settings.theme}
          <select value={settings.theme} onChange={(e) => set({ theme: e.target.value as Theme })}>
            {(['system', 'light', 'dark'] as const).map((t) => (
              <option key={t} value={t}>
                {S.settings.themes[t]}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
    </section>
  );
}
