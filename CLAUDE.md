# CLAUDE.md

Frontend-only OTA console for LTE devices: Vite + React + TypeScript. The browser talks
MQTT over WebSocket straight to the broker; there is no backend. Design:
`docs/superpowers/specs/2026-10-25-ota-webui-design.md`. Wire contract:
`docs/protocol.md`. Read both before changing behaviour.

## Commands

```
npm run dev         # dev server; the simulator is the default connection
npm test            # vitest run (jsdom)
npm run typecheck   # tsc -b
npm run build       # typecheck + static build into dist/
```

## Layout

- `src/protocol/`: wire types, topic builders/parser, payload validation, error texts.
- `src/core/`: pure logic. `jobState.ts` derives each device's effective state
  (including NO_ACK/STALLED/ROLLED_BACK) from the batch entry, the retained device
  topics and the clock. `dispatch.ts` handles throttled sending, retry and cancel.
  `eligibility.ts` gives skip reasons. `batch.ts` has summaries and the lease constants.
- `src/transport/`: the `Transport` interface, the `mqtt.js` adapter, and the in-memory
  broker used by the simulator and tests.
- `src/sim/`: simulated devices speaking the real protocol.
- `src/engine/`: `OtaEngine` folds messages into a vanilla Zustand store and runs the
  1 s tick (dispatch, heartbeat, toasts). Also holds the user actions and settings
  persistence.
- `src/ui/`: React views. Every user-visible string goes in `ui/strings.ts`.

## Rules

- Watchdog verdicts are never written back. Keep `jobView` pure so every tab reaches
  the same answer.
- Only the lease owner writes a batch manifest or sends commands. Mutating actions go
  through `OtaEngine.mutate`.
- Keep the echo guard (`rev`/`writer`) on manifests. A late echo of our own publish
  must not roll state back, or the dispatcher re-sends commands.
- Protocol changes update `docs/protocol.md`, `protocol/parse.ts` and the simulator
  together.
