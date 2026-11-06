// Firmware images: catalog identity and the label for a set of module images.
import { MODULE_LABELS, type FirmwareEntry } from '../protocol/types';

/** Catalog identity: one entry per module and version. */
export type ImageKey = Pick<FirmwareEntry, 'module' | 'version'>;

export const sameImage = (a: ImageKey, b: ImageKey) => a.module === b.module && a.version === b.version;

/** "BLE 3.2.0 + LTE 2.1.0": what a batch installs, for names and tables. */
export function firmwareLabel(images: readonly FirmwareEntry[]): string {
  return images.map((img) => `${MODULE_LABELS[img.module]} ${img.version}`).join(' + ');
}
