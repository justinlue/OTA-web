// In-memory MQTT-like broker: retained messages, wildcard subscriptions, Last Will, and
// asynchronous (microtask) delivery so ordering behaves like a real network. Backs the
// simulator and the engine tests.
import { topicMatches } from '../protocol/topics';
import { Emitter, type ConnState, type PublishOptions, type Transport } from './types';

type Will = { topic: string; payload: string; retain: boolean };

export class MemoryBroker {
  readonly retained = new Map<string, string>();
  private clients = new Set<MemoryClient>();

  publish(topic: string, payload: string, retain = false): void {
    if (retain) {
      if (payload === '') this.retained.delete(topic);
      else this.retained.set(topic, payload);
    }
    for (const c of this.clients) c.offer(topic, payload);
  }

  attach(c: MemoryClient): void {
    this.clients.add(c);
  }

  detach(c: MemoryClient): void {
    this.clients.delete(c);
  }

  client(clientId: string, will?: Will): MemoryClient {
    return new MemoryClient(this, clientId, will);
  }
}

export class MemoryClient implements Transport {
  private filters: string[] = [];
  private connected = false;
  private messages = new Emitter<[string, string]>();
  private states = new Emitter<[ConnState, string?]>();

  constructor(
    private broker: MemoryBroker,
    readonly clientId: string,
    private will?: Will,
  ) {}

  async connect(): Promise<void> {
    this.states.emit('connecting');
    this.connected = true;
    this.broker.attach(this);
    this.states.emit('connected');
  }

  /** Clean disconnect: no Last Will. */
  async disconnect(): Promise<void> {
    this.drop(false);
    this.states.emit('disconnected');
  }

  /** Abrupt loss of connection: the broker publishes the Last Will. */
  kill(): void {
    this.drop(true);
    this.states.emit('disconnected');
  }

  private drop(sendWill: boolean): void {
    if (!this.connected) return;
    this.connected = false;
    this.filters = [];
    this.broker.detach(this);
    if (sendWill && this.will) this.broker.publish(this.will.topic, this.will.payload, this.will.retain);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async subscribe(filters: string[]): Promise<void> {
    this.filters.push(...filters);
    for (const [topic, payload] of this.broker.retained) {
      if (filters.some((f) => topicMatches(f, topic))) this.deliver(topic, payload);
    }
  }

  publish(topic: string, payload: string, opts: PublishOptions = {}): void {
    if (!this.connected) return;
    this.broker.publish(topic, payload, opts.retain ?? false);
  }

  /** Called by the broker for every published message. */
  offer(topic: string, payload: string): void {
    if (this.filters.some((f) => topicMatches(f, topic))) this.deliver(topic, payload);
  }

  private deliver(topic: string, payload: string): void {
    queueMicrotask(() => {
      if (this.connected) this.messages.emit(topic, payload);
    });
  }

  onMessage(cb: (topic: string, payload: string) => void): () => void {
    return this.messages.on(cb);
  }

  onState(cb: (state: ConnState, error?: string) => void): () => void {
    return this.states.on(cb);
  }
}
