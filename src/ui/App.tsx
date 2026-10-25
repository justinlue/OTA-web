import { useCallback, useEffect, useState } from 'react';
import { DeviceDrawer } from './components/DeviceDrawer';
import { href, navigate, useEngine, useEngineState, useRoute } from './hooks';
import { S } from './strings';
import { BatchDetailView } from './views/BatchDetailView';
import { BatchesView } from './views/BatchesView';
import { DevicesView } from './views/DevicesView';
import { FirmwareView } from './views/FirmwareView';
import { SettingsView } from './views/SettingsView';

const TOAST_MS = 6000;

export function App() {
  const route = useRoute();
  const conn = useEngineState((s) => s.conn);
  const simulator = useEngineState((s) => s.settings.conn.simulator);
  const url = useEngineState((s) => s.settings.conn.url);
  const theme = useEngineState((s) => s.settings.theme);
  const failed = useEngineState((s) => s.failedCount);
  const [drawer, setDrawer] = useState<string | null>(null);
  const closeDrawer = useCallback(() => setDrawer(null), []);

  useEffect(() => {
    document.title = failed > 0 ? `(${failed}) OTA` : 'OTA';
  }, [failed]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const needsConnection = conn !== 'connected' && conn !== 'reconnecting' && route.view !== 'settings';
  const active = route.view === 'batch' ? 'batches' : route.view;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">{S.appName}</span>
        <span className="spacer" />
        <a href={href.settings} className={`conn conn-${conn}`} title={simulator ? S.simulator : url}>
          <span className="dot" aria-hidden />
          {S.conn[conn]}
          <span className="muted small">{simulator ? S.simulator : url.replace(/^wss?:\/\//, '')}</span>
        </a>
      </header>
      <nav className="sidenav">
        {(['devices', 'batches', 'firmware', 'settings'] as const).map((v) => (
          <a key={v} href={href[v]} className={active === v ? 'active' : undefined}>
            {S.nav[v]}
            {v === 'batches' && failed > 0 && <span className="pill-failed">{failed}</span>}
          </a>
        ))}
      </nav>
      <main className="main">
        {needsConnection ? (
          <section className="view">
            <p className="empty">
              {S.notConnected} <a href={href.settings}>{S.goConnect}</a>
            </p>
          </section>
        ) : route.view === 'devices' ? (
          <DevicesView onOpenDevice={setDrawer} />
        ) : route.view === 'batches' ? (
          <BatchesView archived={route.archived} />
        ) : route.view === 'batch' ? (
          <BatchDetailView id={route.id} onOpenDevice={setDrawer} />
        ) : route.view === 'firmware' ? (
          <FirmwareView />
        ) : (
          <SettingsView />
        )}
      </main>
      {drawer && <DeviceDrawer deviceId={drawer} onClose={closeDrawer} />}
      <Toasts />
    </div>
  );
}

function Toasts() {
  const engine = useEngine();
  const toasts = useEngineState((s) => s.toasts);
  useEffect(() => {
    if (toasts.length === 0) return;
    const oldest = toasts[0];
    const h = setTimeout(() => engine.dismissToast(oldest.id), TOAST_MS);
    return () => clearTimeout(h);
  }, [toasts, engine]);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.slice(-4).map((t) => (
        <div
          key={t.id}
          className={`toast toast-${t.kind}`}
          onClick={() => {
            if (t.batchId) navigate(href.batch(t.batchId));
            engine.dismissToast(t.id);
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
