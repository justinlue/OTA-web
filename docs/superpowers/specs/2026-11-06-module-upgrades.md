# Module-by-module upgrades: design

Date: 2026-11-06. Status: agreed. This note extends `2026-10-25-ota-webui-design.md`.
The wire details are in `docs/protocol.md`.

Devices are made of separately upgradable modules: **BLE, MCU, LTE, Sensor**. When an
operator selects devices and clicks **Upgrade…**, they tick the modules to upgrade and
pick a catalog image for each one.

## Decisions

| # | Decision |
|---|---|
| Delivery | One batch, one job per device. The `ota` command carries a `modules` list. The device installs the modules in order and reboots once. Batch, lease, retry and cancel are unchanged. |
| Single image | Replaced. Every catalog entry belongs to one module. Old entries, manifests and statuses without a module are read as MCU. The old single-image command is gone, so device firmware has to speak the `modules` command before the UI can upgrade it. |
| Device versions | Status carries `modules: {ble, mcu, lte, sensor}`. `fw` stays as an overall display label. |
| Per-device subset | Each device is sent only the chosen modules it does not already run at the target version. The device is skipped as `up-to-date` only when all chosen modules are on target. |
| Incompatible | The device is skipped if any chosen image does not list its model. The operator then starts a separate batch per model, as before. |
| Downgrade | Checked only on the modules that would be sent. |
| Success | `done` plus a status showing every module of the batch on its target version. Modules that were already on target pass this trivially. |
| Rollback | `done` plus a fresh status with a module still behind gives `ROLLED_BACK`, naming that module. |
| Progress | Reports carry `module` during per-module phases. The UI shows it in the OTA cell, in the failure drawer ("Failed during: Installing (LTE)") and on the timeline. |
| Catalog identity | `(module, version)`. Two modules may use the same version number. |
| Install order | Fixed module order (BLE, MCU, LTE, Sensor), however the operator ticked them. |

## Not done

- One batch cannot pick a different image per model. That needs one batch per model.
- The device table shows `fw` and lists the module versions in a tooltip. The drawer
  shows them in full. There are no per-module columns or filters yet.
