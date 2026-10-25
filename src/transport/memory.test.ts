import { describe, expect, it } from 'vitest';
import { MemoryBroker } from './memory';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('MemoryBroker', () => {
  it('delivers live and retained messages to matching subscribers', async () => {
    const broker = new MemoryBroker();
    const pub = broker.client('pub');
    await pub.connect();
    pub.publish('a/1/status', 'r1', { retain: true });

    const sub = broker.client('sub');
    const got: string[] = [];
    sub.onMessage((t, p) => got.push(`${t}=${p}`));
    await sub.connect();
    await sub.subscribe(['a/+/status']);
    pub.publish('a/2/status', 'live');
    pub.publish('a/2/other', 'ignored');
    await flush();
    expect(got).toEqual(['a/1/status=r1', 'a/2/status=live']);
  });

  it('clears retained messages on an empty retained publish', async () => {
    const broker = new MemoryBroker();
    const c = broker.client('c');
    await c.connect();
    c.publish('x', 'v', { retain: true });
    c.publish('x', '', { retain: true });
    expect(broker.retained.has('x')).toBe(false);
  });

  it('publishes the Last Will on an abrupt disconnect only', async () => {
    const broker = new MemoryBroker();
    const dev = broker.client('dev', { topic: 'd/status', payload: '{"online":false}', retain: true });
    await dev.connect();
    await dev.disconnect();
    expect(broker.retained.has('d/status')).toBe(false);
    await dev.connect();
    dev.kill();
    expect(broker.retained.get('d/status')).toBe('{"online":false}');
  });
});
