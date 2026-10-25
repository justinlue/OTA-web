import { describe, expect, it } from 'vitest';
import { filterRows, NO_FILTERS, parseIdList, type DeviceRow } from './deviceFilter';

const row = (id: string, online: boolean, fw: string, model: string, state?: string): DeviceRow => ({
  device: { id, status: { online, fw, model, ts: 0 } },
  view: state ? ({ state, terminal: false, progress: 0 } as DeviceRow['view']) : null,
});

const rows = [
  row('lt-100-001', true, '1.4.2', 'LT-100', 'downloading'),
  row('lt-100-002', false, '1.3.9', 'LT-100', 'failed'),
  row('lt-200-001', true, '2.1.0', 'LT-200'),
];

const ids = (r: DeviceRow[]) => r.map((x) => x.device.id);

describe('filterRows', () => {
  it('filters by search, online, version, model and OTA state', () => {
    expect(ids(filterRows(rows, { ...NO_FILTERS, search: '200' }))).toEqual(['lt-200-001']);
    expect(ids(filterRows(rows, { ...NO_FILTERS, online: 'offline' }))).toEqual(['lt-100-002']);
    expect(ids(filterRows(rows, { ...NO_FILTERS, fw: '1.4.2' }))).toEqual(['lt-100-001']);
    expect(ids(filterRows(rows, { ...NO_FILTERS, model: 'LT-100' }))).toHaveLength(2);
    expect(ids(filterRows(rows, { ...NO_FILTERS, ota: 'inprogress' }))).toEqual(['lt-100-001']);
    expect(ids(filterRows(rows, { ...NO_FILTERS, ota: 'none' }))).toEqual(['lt-200-001']);
    expect(ids(filterRows(rows, { ...NO_FILTERS, ota: 'failed', model: 'LT-100' }))).toEqual(['lt-100-002']);
  });
});

describe('parseIdList', () => {
  it('splits on newlines, commas and spaces, dedupes and separates unknown IDs', () => {
    const known = new Set(['a', 'b', 'c']);
    expect(parseIdList('a\nb, x  a;c\r\n', known)).toEqual({ found: ['a', 'b', 'c'], unknown: ['x'] });
  });
});
