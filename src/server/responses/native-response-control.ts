import type { NativeSteeringReplayObserver } from "./native-steering-replay";
import type { OcxProviderConfig } from "../../types";
import { isCanonicalOpenAiForwardProvider, isOpenAiOperatedResponsesDestination } from "../../providers/openai-tiers";

/** An admitted downstream turn owns this control surface, never an arbitrary response ID. */
export interface NativeResponseControl {
  readonly kind: "steering" | "injection";
  relayActive: boolean;
  replayFactory?: () => NativeSteeringReplayObserver;
  readonly attached: boolean;
  readonly ended: boolean;
  attach(send: (frame: Record<string, unknown>) => void, onFailure: (error: Error) => void): () => void;
  steer(frame: Record<string, unknown>): void;
  inject?(frame: Record<string, unknown>): void;
  continue(frame: Record<string, unknown>): boolean;
  observe(frame: Record<string, unknown>): boolean;
}

/** Controls cannot follow translated routes; API injection additionally requires operator WS opt-in. */
export function supportsNativeControlRoute(provider: OcxProviderConfig, control?: NativeResponseControl): boolean {
  return isCanonicalOpenAiForwardProvider(provider) || (control?.kind === "injection"
    && provider.authMode !== "forward" && provider.upstreamWebsocket === true
    && isOpenAiOperatedResponsesDestination(provider));
}
