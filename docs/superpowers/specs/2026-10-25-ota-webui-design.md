# OTA Web UI — design

Date: 2026-10-25. Status: agreed (grilling session, three rounds).

A frontend-only web app for pushing firmware OTA updates to LTE devices, singly
or in batches, and following each update to completion. There is no backend we
write: the browser talks straight to an MQTT broker over WebSocket (WSS), and
the devices talk to the same broker. Firmware images are hosted elsewhere
(HTTP/CDN); the UI only sends the device a URL, checksum and size.

## Decisions

| # | Decision |
|---|---|
| Transport | MQTT over WSS via `mqtt.js`, behind a `Transport` interface so a raw-WS adapter can be added later. |
| Protocol | We own it; documented in `docs/protocol.md`. |
| Inventory | Discovered from the broker: retained `status` per device; MQTT Last Will flips it offline. |
| Firmware | Not uploaded by the UI. Command carries `{version, url, sha256, size}`. |
| Stack | Vite + React + TypeScript, Zustand (vanilla store), `@tanstack/react-virtual`, plain CSS variables. Static build. |
| Simulator | Built-in in-memory broker + fake devices, switchable on the connection screen. |
| Scale | ~2,000 devices in view, batches of a few hundred. |
| Language | English; all strings in one module. |

## Topics

Prefix `P` is configurable (default `ota`).

| Topic | Dir | Retained | QoS | Payload |
|---|---|---|---|---|
| `P/dev/{id}/status` | dev → UI | yes (and LWT) | 1 | `{online, fw, model, ts}` |
| `P/dev/{id}/cmd` | UI → dev | no | 1 | `{type:"ota", jobId, version, url, sha256, size}` / `{type:"cancel", jobId}` |
| `P/dev/{id}/ota` | dev → UI | yes | 1 | `{jobId, phase, percent?, error?, ts}` |
| `P/batch/{batchId}` | UI ↔ UI | yes | 1 | batch manifest |
| `P/batch/{batchId}/lease` | UI ↔ UI | yes | 1 | `{owner, operator, heartbeat}` |
| `P/firmware/catalog` | UI ↔ UI | yes | 1 | `{entries:[{version, url, sha256, size, models[], notes}]}` |

An empty retained payload deletes the record.

## Per-device OTA state

Device-reported phases: `accepted → downloading(%) → verifying → installing(%)
→ rebooting → done`, or `failed` / `cancelled`. UI-side states: `queued` (in the
batch, not yet sent), `sent` (command published, no matching report yet),
`skipped` (ineligible at dispatch), `success`.

The effective state of a device in a batch is a **pure function** of the batch
entry, the device's retained `ota` and `status`, the current time and the
timeout settings. Nothing the watchdog decides is written back, so every tab
reaches the same verdict from the same broker data.

- Reports whose `jobId` differs from the entry's current `jobId` are ignored.
- `done` + `status.fw == target` → `success`.
- `done` + a `status` at least as new as the report with a different `fw` → `failed / ROLLED_BACK`.
- `done` without a confirming status yet → still `rebooting`.
- No report `ackTimeout` (60 s) after sending → `failed / NO_ACK`.
- No report change for `stallTimeout` (5 min) → `failed / STALLED`; the
  `rebooting` phase gets `rebootTimeout` (10 min) instead, and going offline
  while rebooting is expected.
- Device timestamps are trusted (LTE devices carry network time); a timestamp
  in the future is treated as now.

## Errors

`error: {code, message, detail?}`, reported with the phase it failed in. The UI
shows a human explanation from the error table, the raw message and the phase.
Unknown codes are shown raw. Device codes: `DOWNLOAD_FAILED`,
`CHECKSUM_MISMATCH`, `INSUFFICIENT_STORAGE`, `LOW_BATTERY`, `SIGNAL_LOST`,
`FLASH_WRITE_FAILED`, `ROLLED_BACK`, `BUSY`, `VERSION_REJECTED`. UI-derived:
`NO_ACK`, `STALLED`.

## Batches

Manifest: `{id, name, createdAt, createdBy, firmware (snapshot), maxInFlight,
allowDowngrade, archived, rev, writer, entries: {deviceId: {state, reason?,
jobId?, sentAt?, attempts}}}` where `state` is `queued | skipped | dispatched |
cancelled`. A single-device OTA is a batch of one.

- **Single writer.** Only the lease owner mutates the manifest or sends
  commands. The owner heartbeats the lease every 10 s. Other tabs show
  "Dispatched by X" and offer **Take over**: immediately when the heartbeat is
  over 30 s old, behind a confirmation otherwise. Retry/cancel from a non-owner
  tab requires taking over first.
- **Echo guard.** Our own publishes come back to us. An incoming manifest from
  ourselves with a lower `rev` than our local copy is ignored, so a late echo
  can never make the dispatcher re-send.
- **Eligibility** is checked in the Start dialog (preview) and again when each
  device's turn comes. Skip reasons: `offline`, `incompatible` (model not in
  `models[]`, when non-empty), `up-to-date`, `busy` (fresh non-terminal report
  from another job), `downgrade` (unless the batch allows it, after a second
  confirmation).
- **Throttle.** At most `maxInFlight` (default 50) entries in a non-terminal
  dispatched state; the rest stay `queued` in the manifest. The queue only
  drains while the owner tab is open; the UI says so.
- **Retry** (single, or "Retry failed & skipped") puts entries back to
  `queued`; at send time `attempts` increments and a new `jobId`
  (`{batchId}:{deviceId}:{attempt}`) is used. Manual only.
- **Cancel** removes `queued` entries (`cancelled`) and sends `cancel` to
  devices still in `downloading`.
- **Archive** sets `archived: true` (read-only, listed under Archived).
  **Delete** clears both retained topics.

## Screens

Left nav: **Devices**, **Batches**, **Firmware**, **Connection / Settings**;
header shows broker connection state.

- **Devices**: virtualized table — ID, Model, Online, Firmware, OTA state
  (progress bar or error badge), Last seen. Search, filters (online, version,
  model, OTA state), select all matching, paste-a-list-of-IDs selection.
  "Start OTA…" dialog: firmware pick, eligibility preview with skip reasons,
  max in flight, downgrade confirmation.
- **Failure drawer**: code, explanation, raw message, failed phase, attempt,
  phase timeline ("since this tab connected"), Retry.
- **Batches**: active and archived lists; detail with state counters, overall
  progress, per-device table filtered by clicking a counter, Retry failed &
  skipped, Cancel queued, Archive, Delete.
- **Firmware**: catalog CRUD.
- **Settings**: broker URL, username, password (stored only if "remember"),
  client-id prefix, topic prefix, operator name, simulator toggle and
  parameters, timeouts, default max in flight, theme.
- Toasts on device failure and batch completion; tab title shows the failure
  count, e.g. `(3) OTA`. Theme follows the system, with a toggle.

## Simulator

In-memory broker (retained messages, `+`/`#` matching, async delivery) with
fake devices as clients. Defaults: 200 devices over 2 models, 5% flapping
online/offline, 15% OTA failure rate spread over the device error codes
(including rollback and a silent no-ack), 10× speed. Adjustable in Settings.

## Testing

Vitest, core logic test-first: topic/payload parsing, version compare,
eligibility, effective-state/watchdog, dispatcher, lease, batch summary, and
an engine integration suite running against the in-memory broker and
simulator. Light Testing Library coverage of UI components.
