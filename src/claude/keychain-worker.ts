import { runKeychainRequest } from "./keychain-process";
import {
  KEYCHAIN_HEADER_BYTES, KEYCHAIN_MAX_BYTES, KEYCHAIN_PENDING, keychainControl, type KeychainRequest,
} from "./keychain-protocol";

declare const self: Worker;
let active: KeychainRequest | undefined;

function isRequest(data: unknown): data is KeychainRequest {
  if (!data || typeof data !== "object") return false;
  const request = data as KeychainRequest;
  return (request.operation === "read" || request.operation === "probe")
    && request.buffer instanceof SharedArrayBuffer
    && request.buffer.byteLength === KEYCHAIN_HEADER_BYTES + (request.operation === "read" ? KEYCHAIN_MAX_BYTES : 0);
}

// Install synchronously: the parent may post immediately and then block in Atomics.wait.
self.addEventListener("message", ({ data }: MessageEvent<unknown>) => {
  if (!isRequest(data)) return;
  if (active && Atomics.load(keychainControl(active.buffer), 0) === KEYCHAIN_PENDING) return;
  active = data;
  void runKeychainRequest(data).then(confirmed => {
    if (!confirmed) return; // Unconfirmed exit retains ownership indefinitely.
    if (active === data) active = undefined;
    // The payload stays exclusively in shared memory; no credential-bearing messages/logs.
    self.postMessage({ type: "complete" });
  }).catch(() => {
    // Unexpected failures also keep the slot. Never terminate the worker/child or
    // retry a potentially live Keychain prompt, and never serialize its errors.
  });
});
