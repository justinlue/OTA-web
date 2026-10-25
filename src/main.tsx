import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { OtaEngine } from './engine/engine';
import { loadSettings } from './engine/settings';
import { App } from './ui/App';
import { EngineContext } from './ui/hooks';
import './ui/styles.css';

const settings = loadSettings();
const engine = new OtaEngine(settings);

if (settings.autoConnect) {
  engine.connect().catch(() => {
    // The error is shown on the connection page.
  });
} else if (!location.hash) {
  location.hash = '#/settings';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EngineContext.Provider value={engine}>
      <App />
    </EngineContext.Provider>
  </StrictMode>,
);
