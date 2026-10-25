# OTA Web UI

A browser-only console for pushing firmware updates to LTE devices, singly or in batches,
and following each one to completion. No backend: the page connects straight to your MQTT
broker over WebSocket, and the devices talk to the same broker.

- Fleet table with online/offline and firmware version, filters, and paste-a-list
  selection.
- Batches with an eligibility preview, throttled dispatch, live progress, and failure
  causes reported by the device (or detected by the UI: no ack, stalled, rolled back).
- Retry per device or "retry all failed", cancel, archive.
- Shared state across operators through retained messages (batches, firmware catalog),
  with a lease so only one tab dispatches a batch.
- A built-in simulator (200 fake devices) so you can try it without a broker.

The device-side contract is in [docs/protocol.md](docs/protocol.md).

## Run

```
npm install
npm run dev        # http://localhost:5173, simulator selected by default
npm test           # vitest (unit, engine integration, app smoke test on the simulator)
OTA_TEST_BROKER=ws://localhost:9001 npm test   # also runs the live mqtt.js test against a real broker
npm run build      # static files in dist/ — host them anywhere
```

To use a real broker, open **Connection**, untick the simulator, and enter the broker's
WebSocket URL (for example `wss://broker.example.com:8084/mqtt` for EMQX, `wss://host:8081`
for HiveMQ, or a Mosquitto `listener 9001` with `protocol websockets`).

## Things to know

- The batch queue only drains while the dispatching tab is open. If it closes, another
  operator can take the batch over after 30 seconds.
- The per-device timeline shows only the transitions this tab saw. The broker keeps only
  each device's latest report.
- Batches stay on the broker as retained messages until someone deletes them. Archiving
  hides a batch and makes it read-only.
