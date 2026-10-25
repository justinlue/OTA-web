// Human explanations for OTA error codes. Keep in sync with docs/protocol.md.

export const ERROR_TEXT: Record<string, string> = {
  DOWNLOAD_FAILED: 'The device could not download the firmware image (HTTP error, DNS failure or connection reset).',
  CHECKSUM_MISMATCH: 'The downloaded image did not match the expected SHA-256. The file on the server may be wrong or corrupted.',
  INSUFFICIENT_STORAGE: 'The device does not have enough free flash to store the new image.',
  LOW_BATTERY: 'Battery too low to update safely. Charge or power the device, then retry.',
  SIGNAL_LOST: 'The LTE connection dropped during the update and the device gave up.',
  FLASH_WRITE_FAILED: 'Writing the image to flash failed. Repeated failures can indicate worn or faulty flash.',
  ROLLED_BACK: 'The new firmware failed to boot and the device rolled back to its previous version.',
  BUSY: 'The device refused because it is busy (another update or a critical task in progress).',
  VERSION_REJECTED: 'The device refused this version (for example, an anti-rollback policy).',
  NO_ACK: 'The device never acknowledged the update command. It may have gone offline or missed the message.',
  STALLED: 'The device stopped reporting progress before the update finished.',
  UNKNOWN: 'The device reported a failure without an error code.',
};

export function explainError(code: string): string {
  return ERROR_TEXT[code] ?? `Unrecognized error code "${code}".`;
}
