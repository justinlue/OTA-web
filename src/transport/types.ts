// The only thing the engine knows about the network. MQTT today; a raw-WebSocket adapter
// would implement the same interface.

export type ConnState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export type PublishOptions = { retain?: boolean; qos?: 0 | 1 };

export interface Transport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(filters: string[]): Promise<void>;
  /** An empty payload with retain clears the retained message. */
  publish(topic: string, payload: string, opts?: PublishOptions): void;
  onMessage(cb: (topic: string, payload: string) => void): () => void;
  onState(cb: (state: ConnState, error?: string) => void): () => void;
}

/** Small listener set shared by the transport implementations. */
export class Emitter<A extends unknown[]> {
  private listeners = new Set<(...args: A) => void>();
  on(cb: (...args: A) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  emit(...args: A): void {
    for (const cb of [...this.listeners]) cb(...args);
  }
}
