import { describe, expect, it } from 'vitest';
import { parseBatch, parseCatalog, parseLease, parseOtaReport, parseStatus } from './parse';

const fw = { version: '2.0.0', url: 'https://cdn/x.bin', sha256: 'ab', size: 10, models: [], notes: '' };

describe('parseStatus', () => {
  it('accepts a well-formed status', () => {
    expect(parseStatus('{"online":true,"fw":"1.0.0","model":"LT-100","ts":5}')).toEqual({
      online: true,
      fw: '1.0.0',
      model: 'LT-100',
      ts: 5,
    });
  });

  it('rejects bad JSON and wrong field types', () => {
    expect(parseStatus('nope')).toBeNull();
    expect(parseStatus('{"online":"yes","fw":"1","model":"m","ts":1}')).toBeNull();
    expect(parseStatus('{"online":true,"fw":"1","model":"m"}')).toBeNull();
  });

  it('tolerates a Last Will that only says offline, defaulting the rest', () => {
    expect(parseStatus('{"online":false}')).toEqual({ online: false, fw: '', model: '', ts: 0 });
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
    firmware: fw,
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
  });
});
