// @vitest-environment node
// Live test against a real broker. Opt-in: OTA_TEST_BROKER=ws://localhost:9001 npm test
import mqtt from 'mqtt';
import { describe, expect, it } from 'vitest';
import { OtaEngine } from '../engine/engine';
import { DEFAULT_SETTINGS, type Settings } from '../engine/settings';
import { topics } from '../protocol/topics';

const url = process.env.OTA_TEST_BROKER;
const prefix = `ota-live-${Date.now()}`;
const t = topics(prefix);
const fw = { version: '2.0.0', url: 'https://cdn/fw.bin', sha256: 'abc', size: 42, models: [], notes: '' };

const until = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe.skipIf(!url)('MqttTransport against a live broker', () => {
  it('discovers a device, runs an OTA to success, and sees the Last Will', async () => {
    const id = 'live-dev-1';
    const device = mqtt.connect(url!, {
      clientId: `dev-${id}-${Date.now()}`,
      will: { topic: t.status(id), payload: Buffer.from('{"online":false}'), retain: true, qos: 1 },
    });
    await new Promise<void>((r) => device.once('connect', () => r()));
    let deviceFw = '1.0.0';
    const status = () =>
      device.publishAsync(t.status(id), JSON.stringify({ online: true, fw: deviceFw, model: 'm', ts: Date.now() }), { retain: true, qos: 1 });
    await device.subscribeAsync(t.cmd(id), { qos: 1 });
    await status();
    device.on('message', async (_topic, payload) => {
      const cmd = JSON.parse(payload.toString());
      if (cmd.type !== 'ota') return;
      const report = (phase: string, extra = {}) =>
        device.publishAsync(t.ota(id), JSON.stringify({ jobId: cmd.jobId, phase, ts: Date.now(), ...extra }), { retain: true, qos: 1 });
      await report('accepted');
      await report('downloading', { percent: 100 });
      await report('installing', { percent: 100 });
      await report('rebooting');
      deviceFw = cmd.version;
      await status();
      await report('done');
    });

    const settings: Settings = { ...DEFAULT_SETTINGS, conn: { ...DEFAULT_SETTINGS.conn, simulator: false, url: url!, topicPrefix: prefix } };
    const engine = new OtaEngine(settings);
    await engine.connect();
    await until(() => engine.store.getState().devices.get(id)?.status?.online === true);

    const batchId = engine.startBatch({ name: 'live', firmware: fw, deviceIds: [id], maxInFlight: 1, allowDowngrade: false });
    await until(() => (engine.tick(), engine.views(batchId).get(id)?.state === 'success'));

    // A second engine (another operator's tab) sees the retained batch and lease.
    const other = new OtaEngine(settings);
    await other.connect();
    await until(() => other.store.getState().batches.has(batchId));
    expect(other.isOwner(batchId)).toBe(false);
    other.tick();
    expect(other.views(batchId).get(id)?.state).toBe('success');

    // Abrupt device loss → broker publishes the Last Will.
    device.stream.destroy();
    await until(() => engine.store.getState().devices.get(id)?.status?.online === false, 10_000);
    expect(engine.store.getState().devices.get(id)?.status?.fw).toBe('2.0.0');

    // Clean up retained state.
    engine.deleteBatch(batchId);
    await engine.disconnect();
    await other.disconnect();
    device.end(true);
  }, 30_000);
});
