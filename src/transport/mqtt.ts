// mqtt.js adapter: the browser connects straight to the broker's WebSocket listener.
// mqtt.js is loaded on first connect so simulator-only sessions never download it.
import type { MqttClient } from 'mqtt';
import { Emitter, type ConnState, type PublishOptions, type Transport } from './types';

export type MqttOptions = {
  url: string;
  username?: string;
  password?: string;
  clientId: string;
};

export class MqttTransport implements Transport {
  private client: MqttClient | null = null;
  private messages = new Emitter<[string, string]>();
  private states = new Emitter<[ConnState, string?]>();
  private decoder = new TextDecoder();

  constructor(private opts: MqttOptions) {}

  async connect(): Promise<void> {
    this.states.emit('connecting');
    const { default: mqtt } = await import('mqtt');
    return new Promise((resolve, reject) => {
      let settled = false;
      const client = mqtt.connect(this.opts.url, {
        clientId: this.opts.clientId,
        username: this.opts.username || undefined,
        password: this.opts.password || undefined,
        clean: true,
        reconnectPeriod: 3000,
        connectTimeout: 10_000,
        protocolVersion: 4,
      });
      this.client = client;
      client.on('connect', () => {
        this.states.emit('connected');
        if (!settled) {
          settled = true;
          resolve();
        }
      });
      client.on('reconnect', () => this.states.emit('reconnecting'));
      client.on('close', () => {
        if (settled) this.states.emit(client.disconnecting ? 'disconnected' : 'reconnecting');
      });
      client.on('error', (err) => {
        this.states.emit('error', err.message);
        if (!settled) {
          settled = true;
          client.end(true);
          reject(err);
        }
      });
      client.on('message', (topic, payload) => this.messages.emit(topic, this.decoder.decode(payload)));
    });
  }

  async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    if (c) await c.endAsync();
    this.states.emit('disconnected');
  }

  async subscribe(filters: string[]): Promise<void> {
    if (!this.client) throw new Error('Not connected');
    await this.client.subscribeAsync(filters, { qos: 1 });
  }

  publish(topic: string, payload: string, opts: PublishOptions = {}): void {
    this.client?.publish(topic, payload, { qos: opts.qos ?? 1, retain: opts.retain ?? false });
  }

  onMessage(cb: (topic: string, payload: string) => void): () => void {
    return this.messages.on(cb);
  }

  onState(cb: (state: ConnState, error?: string) => void): () => void {
    return this.states.on(cb);
  }
}
