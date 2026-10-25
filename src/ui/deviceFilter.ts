import { IN_PROGRESS_STATES } from '../core/batch';
import type { DeviceJobRef } from '../core/deviceView';
import type { DeviceRecord, JobView } from '../core/types';

export type DeviceRow = { device: DeviceRecord; view: JobView | null; ref?: DeviceJobRef };

export type OtaFilter = '' | 'none' | 'inprogress' | 'queued' | 'success' | 'failed' | 'skipped' | 'cancelled';

export type DeviceFilters = {
  search: string;
  online: '' | 'online' | 'offline';
  fw: string;
  model: string;
  ota: OtaFilter;
};

export const NO_FILTERS: DeviceFilters = { search: '', online: '', fw: '', model: '', ota: '' };

function otaMatches(view: JobView | null, f: OtaFilter): boolean {
  if (!f) return true;
  if (f === 'none') return view === null;
  if (!view) return false;
  if (f === 'inprogress') return IN_PROGRESS_STATES.includes(view.state);
  return view.state === f;
}

export function filterRows(rows: readonly DeviceRow[], f: DeviceFilters): DeviceRow[] {
  const q = f.search.trim().toLowerCase();
  return rows.filter(({ device, view }) => {
    const st = device.status;
    if (q && !device.id.toLowerCase().includes(q)) return false;
    if (f.online === 'online' && !st?.online) return false;
    if (f.online === 'offline' && st?.online) return false;
    if (f.fw && st?.fw !== f.fw) return false;
    if (f.model && st?.model !== f.model) return false;
    return otaMatches(view, f.ota);
  });
}

/** Split pasted text into IDs, and sort them into known and unknown. */
export function parseIdList(text: string, known: ReadonlySet<string>): { found: string[]; unknown: string[] } {
  const ids = [...new Set(text.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  return { found: ids.filter((id) => known.has(id)), unknown: ids.filter((id) => !known.has(id)) };
}
