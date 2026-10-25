import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import { deviceJobIndex } from '../core/deviceView';
import type { EngineState, OtaEngine } from '../engine/engine';

export const EngineContext = createContext<OtaEngine | null>(null);

export function useEngine(): OtaEngine {
  const e = useContext(EngineContext);
  if (!e) throw new Error('EngineContext missing');
  return e;
}

export function useEngineState<T>(selector: (s: EngineState) => T): T {
  return useStore(useEngine().store, selector);
}

/** device → newest active batch containing it. */
export function useJobIndex() {
  const batches = useEngineState((s) => s.batches);
  return useMemo(() => deviceJobIndex(batches.values()), [batches]);
}

export type Route =
  | { view: 'devices' }
  | { view: 'batches'; archived: boolean }
  | { view: 'batch'; id: string }
  | { view: 'firmware' }
  | { view: 'settings' };

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  switch (parts[0]) {
    case 'batches':
      if (parts[1] === 'archived') return { view: 'batches', archived: true };
      return parts[1] ? { view: 'batch', id: parts[1] } : { view: 'batches', archived: false };
    case 'firmware':
      return { view: 'firmware' };
    case 'settings':
      return { view: 'settings' };
    default:
      return { view: 'devices' };
  }
}

export const href = {
  devices: '#/devices',
  batches: '#/batches',
  archived: '#/batches/archived',
  batch: (id: string) => `#/batches/${encodeURIComponent(id)}`,
  firmware: '#/firmware',
  settings: '#/settings',
};

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function navigate(to: string): void {
  location.hash = to;
}
