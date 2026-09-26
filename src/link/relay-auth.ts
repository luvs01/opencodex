import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LINK_RELAY_AUTH_PATH = "/.well-known/opencodex/link-relay-auth";

function proof(fingerprint: string, nonce: string): string {
  return createHmac("sha256", fingerprint)
    .update("opencodex-link-relay-v1\0")
    .update(nonce)
    .digest("hex");
}

export function linkRelayChallenge(fingerprint: string): { nonce: string; expectedProof: string } {
  const nonce = randomBytes(32).toString("hex");
  return { nonce, expectedProof: proof(fingerprint, nonce) };
}

export function linkRelayProof(fingerprint: string, nonce: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(fingerprint) || !/^[a-f0-9]{64}$/.test(nonce)) return null;
  return proof(fingerprint, nonce);
}

export function linkRelayProofMatches(actual: string | null, expected: string): boolean {
  if (!actual || !/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
