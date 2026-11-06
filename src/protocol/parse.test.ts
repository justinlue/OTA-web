import { describe, expect, it } from 'vitest';
import { parseBatch, parseCatalog, parseLease, parseOtaReport, parseStatus } from './parse';

const fw = { module: 'lte', version: '2.0.0', url: 'https://cdn/x.bin', sha256: 'ab', size: 10, models: [], notes: '' };

describe('parseStatus', () => {
  it('accepts a well-formed status with per-module versions', () => {
    const raw = { online: true, fw: '1.0.0', model: 'LT-100', ts: 5, modules: { ble: '3.1.0', mcu: '1.0.0', lte: '2.0.4', sensor: '0.9.1' } };
    expect(parseStatus(JSON.stringify(raw))).toEqual(raw);
  });

  it('drops unknown modules and non-string versions', () => {
    const s = parseStatus('{"online":true,"fw":"1","model":"m","ts":5,"modules":{"ble":"3.1.0","gps":"1.0","lte":7}}');
    expect(s?.modules).toEqual({ ble: '3.1.0' });
  });

  it('reads a status without modules as the MCU running fw', () => {
    expect(parseStatus('{"online":true,"fw":"1.0.0","model":"LT-100","ts":5}')?.modules).toEqual({ mcu: '1.0.0' });
  });

  it('rejects bad JSON and wrong field types', () => {
    expect(parseStatus('nope')).toBeNull();
    expect(parseStatus('{"online":"yes","fw":"1","model":"m","ts":1}')).toBeNull();
    expect(parseStatus('{"online":true,"fw":"1","model":"m"}')).toBeNull();
  });

  it('tolerates a Last Will that only says offline, defaulting the rest', () => {
    expect(parseStatus('{"online":false}')).toEqual({ online: false, fw: '', model: '', ts: 0, modules: {} });
  });
});

describe('parseOtaReport', () => {
  it('accepts progress and error reports', () => {
    expect(parseOtaReport('{"jobId":"j","phase":"downloading","percent":40,"ts":9}')).toEqual({
      jobId: 'j',
      phase: 'downloading',
      percent: 40,
      ts: 9,
    });
    const failed = parseOtaReport(
      '{"jobId":"j","phase":"failed","error":{"code":"LOW_BATTERY","message":"12%"},"ts":9}',
    );
    expect(failed?.error).toEqual({ code: 'LOW_BATTERY', message: '12%' });
  });

  it('keeps the module a multi-module job is working on', () => {
    expect(parseOtaReport('{"jobId":"j","phase":"installing","module":"ble","percent":20,"ts":9}')?.module).toBe('ble');
    expect(parseOtaReport('{"jobId":"j","phase":"installing","module":"gps","ts":9}')?.module).toBeUndefined();
  });

  it('rejects unknown phases and malformed errors', () => {
    expect(parseOtaReport('{"jobId":"j","phase":"exploding","ts":1}')).toBeNull();
    expect(parseOtaReport('{"jobId":"j","phase":"failed","error":"boom","ts":1}')).toBeNull();
  });

  it('clamps percent into 0..100', () => {
    expect(parseOtaReport('{"jobId":"j","phase":"installing","percent":140,"ts":1}')?.percent).toBe(100);
  });

  it('gives a failure without an error object an UNKNOWN code', () => {
    expect(parseOtaReport('{"jobId":"j","phase":"failed","ts":1}')?.error).toEqual({
      code: 'UNKNOWN',
      message: '',
    });
  });
});

describe('parseBatch / parseLease / parseCatalog', () => {
  const manifest = {
    id: 'b1',
    name: 'n',
    createdAt: 1,
    createdBy: 'op',
    firmware: [fw],
    maxInFlight: 5,
    allowDowngrade: false,
    archived: false,
    rev: 1,
    writer: 'c1',
    entries: { d1: { state: 'queued', attempts: 0 } },
  };

  it('accepts a manifest', () => {
    expect(parseBatch(JSON.stringify(manifest))).toEqual(manifest);
  });

  it('reads a legacy single-image manifest as one MCU image', () => {
    const { module: _, ...legacy } = fw;
    const m = parseBatch(JSON.stringify({ ...manifest, firmware: legacy }));
    expect(m?.firmware).toEqual([{ ...fw, module: 'mcu' }]);
  });

  it('rejects a manifest with an unknown module or the same module twice', () => {
    expect(parseBatch(JSON.stringify({ ...manifest, firmware: [{ ...fw, module: 'gps' }] }))).toBeNull();
    expect(parseBatch(JSON.stringify({ ...manifest, firmware: [fw, fw] }))).toBeNull();
    expect(parseBatch(JSON.stringify({ ...manifest, firmware: [] }))).toBeNull();
  });

  it('rejects a manifest with a bad entry state', () => {
    const bad = { ...manifest, entries: { d1: { state: 'flying', attempts: 0 } } };
    expect(parseBatch(JSON.stringify(bad))).toBeNull();
  });

  it('accepts a lease and a catalog', () => {
    expect(parseLease('{"owner":"c1","operator":"Ann","heartbeat":3}')).toEqual({
      owner: 'c1',
      operator: 'Ann',
      heartbeat: 3,
    });
    expect(parseCatalog(JSON.stringify({ entries: [fw], rev: 2, writer: 'c1' }))?.entries).toHaveLength(1);
    expect(parseCatalog('{"entries":[{"version":1}],"rev":1,"writer":"c"}')).toBeNull();
    // Entries written before modules existed are MCU images.
    const { module: _, ...legacy } = fw;
    expect(parseCatalog(JSON.stringify({ entries: [legacy], rev: 2, writer: 'c1' }))?.entries).toEqual([{ ...fw, module: 'mcu' }]);
  });
});
