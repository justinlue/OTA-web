# OTA MQTT protocol

The contract between LTE devices and the OTA web UI. Both sides talk to the same MQTT
broker; there is no other server. The browser connects over WebSocket (`wss://`), devices
over whatever transport they use (TCP/TLS). All payloads are UTF-8 JSON. Timestamps are
Unix epoch **milliseconds**; device clocks are expected to be network-synced.

Every topic sits under a configurable prefix `P` (default `ota`).

## Topics

| Topic | Publisher | Retained | QoS | Purpose |
|---|---|---|---|---|
| `P/dev/{deviceId}/status` | device (+ broker LWT) | yes | 1 | Presence and firmware version |
| `P/dev/{deviceId}/cmd` | UI | no | 1 | OTA and cancel commands |
| `P/dev/{deviceId}/ota` | device | yes | 1 | Latest OTA progress/result |
| `P/batch/{batchId}` | UI | yes | 1 | Batch manifest (UI ↔ UI) |
| `P/batch/{batchId}/lease` | UI | yes | 1 | Which UI tab dispatches the batch |
| `P/firmware/catalog` | UI | yes | 1 | Shared firmware catalog |

`deviceId` must not contain `/`, `+` or `#`. Publishing an empty retained payload
deletes a retained record.

## Device side

### Status — `P/dev/{id}/status`

On every connect, publish retained:

```json
{ "online": true, "fw": "1.4.2", "model": "LT-100", "ts": 1761400000000 }
```

Set the MQTT **Last Will** to the same topic, retained, QoS 1, with payload
`{"online": false}` (the full object is also fine). The UI keeps the last known `fw` and
`model` when it receives a bare will.

After an update reboots, publish a fresh status with the new `fw` **before** the final
`done` report.

### Commands — `P/dev/{id}/cmd` (subscribe, QoS 1)

```json
{ "type": "ota", "jobId": "b-20261025-101500-x7k2:lt-100-00012:1",
  "version": "1.5.0", "url": "https://fw.example.com/lt100/1.5.0.bin",
  "sha256": "a3f1…e9", "size": 1843200 }
```

```json
{ "type": "cancel", "jobId": "b-20261025-101500-x7k2:lt-100-00012:1" }
```

- `jobId` is opaque to the device; echo it in every report for that job. Each retry is a
  new `jobId`.
- Download the image from `url` yourself and check its SHA-256 and size.
- If a job is already running, reply to the new `jobId` with `failed` / `BUSY`.
- Honour `cancel` only while downloading (report `cancelled`); ignore it afterwards.
- Commands are not retained: a device that is offline when the command is sent never
  sees it (the UI skips offline devices).

### OTA report — `P/dev/{id}/ota` (retained, QoS 1)

```json
{ "jobId": "…", "phase": "downloading", "percent": 40, "ts": 1761400012345 }
```

| `phase` | Meaning | `percent` |
|---|---|---|
| `accepted` | Command received and validated, about to start | — |
| `downloading` | Fetching the image | 0–100 |
| `verifying` | Checking SHA-256 / signature | — |
| `installing` | Writing to flash | 0–100 |
| `rebooting` | About to reboot into the new image (going offline is expected) | — |
| `done` | Running the new image (status already shows the new `fw`) | — |
| `failed` | Gave up; `error` is required | — |
| `cancelled` | Stopped on a `cancel` command | — |

Report at least every few minutes while a phase is long-running; the UI marks a job
`STALLED` after 5 minutes without a report (10 minutes while `rebooting`).

Failure:

```json
{ "jobId": "…", "phase": "failed", "ts": 1761400099000,
  "error": { "code": "CHECKSUM_MISMATCH", "phase": "verifying",
             "message": "sha256 mismatch", "detail": "optional free text" } }
```

`error.phase` is the phase the job was in when it failed. `message` is shown to operators
verbatim, so keep it short and specific.

## Error codes

| Code | Raised by | Meaning |
|---|---|---|
| `DOWNLOAD_FAILED` | device | Could not download the image (HTTP error, DNS, reset) |
| `CHECKSUM_MISMATCH` | device | Image did not match `sha256` / `size` |
| `INSUFFICIENT_STORAGE` | device | Not enough free flash for the image |
| `LOW_BATTERY` | device | Battery too low to update safely |
| `SIGNAL_LOST` | device | LTE connection dropped and the device gave up |
| `FLASH_WRITE_FAILED` | device | Writing to flash failed |
| `ROLLED_BACK` | device or UI | New image failed to boot; running the old version. The UI also raises it when a device reports `done` but its fresh status shows a different `fw` |
| `BUSY` | device | Another job or a critical task is running |
| `VERSION_REJECTED` | device | Version refused (e.g. anti-rollback) |
| `NO_ACK` | UI | No report for this `jobId` within 60 s of sending |
| `STALLED` | UI | No new report within the stall/reboot allowance |

Unknown codes are displayed as-is. A `failed` report without `error` is shown as `UNKNOWN`.

A job succeeds only when the device reports `done` **and** its status shows
`fw == version`.

## UI side (UI ↔ UI)

These topics let several operator tabs share state without a backend. Devices ignore them.

### Batch manifest — `P/batch/{batchId}`

```json
{
  "id": "b-20261025-101500-x7k2", "name": "LT-100 1.5.0 wave 1",
  "createdAt": 1761400000000, "createdBy": "Ann",
  "firmware": { "version": "1.5.0", "url": "…", "sha256": "…", "size": 1843200, "models": ["LT-100"], "notes": "" },
  "maxInFlight": 50, "allowDowngrade": false, "archived": false,
  "rev": 17, "writer": "ota-ui-k3j9x2",
  "entries": {
    "lt-100-00012": { "state": "dispatched", "jobId": "…:lt-100-00012:1", "sentAt": 1761400001000, "attempts": 1 },
    "lt-100-00013": { "state": "skipped", "reason": "offline", "attempts": 0 },
    "lt-100-00014": { "state": "queued", "attempts": 0 }
  }
}
```

Entry `state`: `queued | dispatched | skipped | cancelled`. Skip `reason`: `offline |
incompatible | up-to-date | busy | downgrade`. Everything finer (progress, success,
failure, timeouts) is derived from the device topics, never stored here.

Job ids are `{batchId}:{deviceId}:{attempt}`.

### Lease — `P/batch/{batchId}/lease`

```json
{ "owner": "ota-ui-k3j9x2", "operator": "Ann", "heartbeat": 1761400010000 }
```

Only the owner (by MQTT client id) writes the manifest and sends commands. It refreshes
`heartbeat` every 10 s. Another tab may take over at any time (with a confirmation while
the heartbeat is fresh, i.e. under 30 s old) by publishing a lease naming itself.

### Firmware catalog — `P/firmware/catalog`

```json
{ "rev": 3, "writer": "ota-ui-k3j9x2",
  "entries": [ { "version": "1.5.0", "url": "…", "sha256": "…", "size": 1843200,
                 "models": ["LT-100"], "notes": "…" } ] }
```

`models` empty means any model. Last writer wins.

## Broker requirements

- MQTT 3.1.1 or 5 with a WebSocket listener reachable from operator browsers (`wss://`
  in production).
- Retained messages and Last Will enabled.
- Suggested ACLs: devices may publish `P/dev/{own id}/status|ota` and subscribe
  `P/dev/{own id}/cmd`; operators may subscribe `P/#` and publish `P/dev/+/cmd`,
  `P/batch/#`, `P/firmware/catalog`.
