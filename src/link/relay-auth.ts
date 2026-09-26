import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const LINK_RELAY_AUTH_PATH = "/.well-known/opencodex/link-relay-auth";

const FINGERPRINT = /^[a-f0-9]{64}$/;
const LINK_ID = /^lnk_[0-9a-f]{16}$/;
const NONCE = /^[a-f0-9]{64}$/;

function proof(fingerprint: string, tag: "caller" | "listener", linkId: string, nonce: string): string {
  return createHmac("sha256", fingerprint)
    .update(`opencodex-link-relay-v1\0${tag}\0${linkId}\0`)
    .update(nonce)
    .digest("hex");
}

export function linkRelayChallenge(
  fingerprint: string,
  linkId: string,
): { nonce: string; callerProof: string; expectedProof: string } {
  const nonce = randomBytes(32).toString("hex");
  return {
    nonce,
    callerProof: proof(fingerprint, "caller", linkId, nonce),
    expectedProof: proof(fingerprint, "listener", linkId, nonce),
  };
}

/**
 * The proof a relay request must carry: anyone reaching the listener can ask for a challenge
 * response, so serving one without it would mint valid proofs for keys the caller does not hold.
 */
export function linkRelayCallerProof(fingerprint: string, linkId: string, nonce: string): string | null {
  if (!FINGERPRINT.test(fingerprint) || !LINK_ID.test(linkId) || !NONCE.test(nonce)) return null;
  return proof(fingerprint, "caller", linkId, nonce);
}

export function linkRelayProof(fingerprint: string, linkId: string, nonce: string): string | null {
  if (!FINGERPRINT.test(fingerprint) || !LINK_ID.test(linkId) || !NONCE.test(nonce)) return null;
  return proof(fingerprint, "listener", linkId, nonce);
}

export function linkRelayProofMatches(actual: string | null, expected: string): boolean {
  if (!actual || !/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
