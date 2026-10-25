// Topic builders and the inverse parser. Every topic lives under a configurable prefix.

export type ParsedTopic =
  | { kind: 'status'; deviceId: string }
  | { kind: 'ota'; deviceId: string }
  | { kind: 'cmd'; deviceId: string }
  | { kind: 'batch'; batchId: string }
  | { kind: 'lease'; batchId: string }
  | { kind: 'catalog' };

export function topics(prefix: string) {
  const p = prefix.replace(/\/+$/, '');
  return {
    status: (id: string) => `${p}/dev/${id}/status`,
    ota: (id: string) => `${p}/dev/${id}/ota`,
    cmd: (id: string) => `${p}/dev/${id}/cmd`,
    batch: (id: string) => `${p}/batch/${id}`,
    lease: (id: string) => `${p}/batch/${id}/lease`,
    catalog: () => `${p}/firmware/catalog`,
    /** What the UI subscribes to. */
    subscriptions: () => [`${p}/dev/+/status`, `${p}/dev/+/ota`, `${p}/batch/#`, `${p}/firmware/catalog`],
  };
}

export function parseTopic(prefix: string, topic: string): ParsedTopic | null {
  const p = prefix.replace(/\/+$/, '') + '/';
  if (!topic.startsWith(p)) return null;
  const parts = topic.slice(p.length).split('/');
  if (parts[0] === 'dev' && parts.length === 3 && parts[1]) {
    const kind = parts[2];
    if (kind === 'status' || kind === 'ota' || kind === 'cmd') return { kind, deviceId: parts[1] };
    return null;
  }
  if (parts[0] === 'batch' && parts[1]) {
    if (parts.length === 2) return { kind: 'batch', batchId: parts[1] };
    if (parts.length === 3 && parts[2] === 'lease') return { kind: 'lease', batchId: parts[1] };
    return null;
  }
  if (parts.length === 2 && parts[0] === 'firmware' && parts[1] === 'catalog') return { kind: 'catalog' };
  return null;
}

/** MQTT wildcard match (`+` one level, `#` the rest). */
export function topicMatches(filter: string, topic: string): boolean {
  const f = filter.split('/');
  const t = topic.split('/');
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '#') return true;
    if (i >= t.length) return false;
    if (f[i] !== '+' && f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}
