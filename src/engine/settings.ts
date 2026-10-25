import { DEFAULT_TIMEOUTS, type Timeouts } from '../core/types';
import { DEFAULT_SIM, type SimConfig } from '../sim/fleet';

export type ConnectionSettings = {
  url: string;
  username: string;
  password: string;
  rememberPassword: boolean;
  clientIdPrefix: string;
  topicPrefix: string;
  operator: string;
  simulator: boolean;
};

export type Theme = 'system' | 'light' | 'dark';

export type Settings = {
  conn: ConnectionSettings;
  timeouts: Timeouts;
  defaultMaxInFlight: number;
  sim: SimConfig;
  theme: Theme;
  /** Reconnect on load; set after a successful connect, cleared on manual disconnect. */
  autoConnect: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  conn: {
    url: 'wss://broker.example.com:8084/mqtt',
    username: '',
    password: '',
    rememberPassword: false,
    clientIdPrefix: 'ota-ui',
    topicPrefix: 'ota',
    operator: '',
    simulator: true,
  },
  timeouts: DEFAULT_TIMEOUTS,
  defaultMaxInFlight: 50,
  sim: DEFAULT_SIM,
  theme: 'system',
  autoConnect: false,
};

const KEY = 'ota-webui.settings';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const v = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...v,
      conn: { ...DEFAULT_SETTINGS.conn, ...v.conn },
      timeouts: { ...DEFAULT_SETTINGS.timeouts, ...v.timeouts },
      sim: { ...DEFAULT_SETTINGS.sim, ...v.sim },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  const stored: Settings = s.conn.rememberPassword ? s : { ...s, conn: { ...s.conn, password: '' } };
  try {
    localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Storage blocked (private window etc.): settings just won't persist.
  }
}
