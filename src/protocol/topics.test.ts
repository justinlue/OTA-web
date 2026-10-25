import { describe, expect, it } from 'vitest';
import { parseTopic, topicMatches, topics } from './topics';

describe('topics', () => {
  const t = topics('ota');

  it('builds device and batch topics under the prefix', () => {
    expect(t.status('d1')).toBe('ota/dev/d1/status');
    expect(t.cmd('d1')).toBe('ota/dev/d1/cmd');
    expect(t.lease('b1')).toBe('ota/batch/b1/lease');
    expect(topics('fleet/a/').catalog()).toBe('fleet/a/firmware/catalog');
  });

  it('round-trips through parseTopic', () => {
    expect(parseTopic('ota', t.status('d1'))).toEqual({ kind: 'status', deviceId: 'd1' });
    expect(parseTopic('ota', t.ota('d1'))).toEqual({ kind: 'ota', deviceId: 'd1' });
    expect(parseTopic('ota', t.batch('b1'))).toEqual({ kind: 'batch', batchId: 'b1' });
    expect(parseTopic('ota', t.lease('b1'))).toEqual({ kind: 'lease', batchId: 'b1' });
    expect(parseTopic('ota', t.catalog())).toEqual({ kind: 'catalog' });
  });

  it('rejects foreign and malformed topics', () => {
    expect(parseTopic('ota', 'other/dev/d1/status')).toBeNull();
    expect(parseTopic('ota', 'ota/dev/d1/weird')).toBeNull();
    expect(parseTopic('ota', 'ota/dev//status')).toBeNull();
    expect(parseTopic('ota', 'ota/batch/b1/lease/x')).toBeNull();
  });

  it('matches MQTT wildcards', () => {
    expect(topicMatches('ota/dev/+/status', 'ota/dev/d1/status')).toBe(true);
    expect(topicMatches('ota/dev/+/status', 'ota/dev/d1/ota')).toBe(false);
    expect(topicMatches('ota/batch/#', 'ota/batch/b1/lease')).toBe(true);
    expect(topicMatches('ota/batch/#', 'ota/batch')).toBe(true);
    expect(topicMatches('ota/dev/+', 'ota/dev/d1/status')).toBe(false);
  });
});
