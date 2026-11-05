/** In-memory handoff between bounded callers and the worker that owns `security`. */
export const CLAUDE_KEYCHAIN_SERVICE = "Claude Code-credentials";
export const KEYCHAIN_MAX_BYTES = 1024 * 1024;
export const KEYCHAIN_HEADER_BYTES = Int32Array.BYTES_PER_ELEMENT * 2;
export const KEYCHAIN_PENDING = 0;
export const KEYCHAIN_SUCCESS = 1;
export const KEYCHAIN_NOT_FOUND = 2;
export const KEYCHAIN_UNAVAILABLE = 3;

export type KeychainOperation = "read" | "probe";
export interface KeychainRequest {
  operation: KeychainOperation;
  buffer: SharedArrayBuffer;
}

export function keychainControl(buffer: SharedArrayBuffer): Int32Array {
  return new Int32Array(buffer, 0, 2);
}

export function keychainOutput(buffer: SharedArrayBuffer): Uint8Array {
  return new Uint8Array(buffer, KEYCHAIN_HEADER_BYTES);
}

/** Publish only after the child has closed (or failed to spawn), never on a caller deadline. */
export function finishKeychainRequest(request: KeychainRequest, status: number, length = 0): void {
  const control = keychainControl(request.buffer);
  Atomics.store(control, 1, length);
  Atomics.store(control, 0, status);
  Atomics.notify(control, 0);
}
