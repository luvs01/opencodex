import { isatty } from "node:tty";
import { writeSync } from "node:fs";
import type { OcxConfig } from "../types";
import { standaloneGuiPairingOrigin } from "../lib/gui-pair-capability";
import { createGuiPairingGrant, type GuiSessionState } from "./gui-session";

type CreatedGrant = ReturnType<typeof createGuiPairingGrant>;
export type GuiPairDelivery = CreatedGrant | {
  delivery: "server-terminal";
  browserOrigin: string;
  serverOrigin: string;
  expiresAt: number;
};

export class GuiPairingTerminalRequiredError extends Error {
  constructor() {
    super("Standalone GUI pairing requires the foreground server's terminal");
    this.name = "GuiPairingTerminalRequiredError";
  }
}

export interface GuiPairDeliveryDeps {
  terminalAvailable?: () => boolean;
  writeTerminal?: (data: Buffer, offset: number, length: number) => number;
}

/** Standalone codes leave through the serving process's terminal, not its HTTP response. */
export function deliverGuiPairingGrant(
  browserOrigin: string,
  config: OcxConfig,
  state: GuiSessionState,
  deps: GuiPairDeliveryDeps = {},
): GuiPairDelivery {
  if (config.runtimeRole === "hub") return createGuiPairingGrant(browserOrigin, config, state);
  const origin = standaloneGuiPairingOrigin(config);
  // Refuse before minting, including when stderr is redirected to a log or a pipe.
  // Background services need a separately reviewed operator-presence channel; no HTTP fallback.
  if (!origin || browserOrigin !== origin) throw new TypeError("Standalone GUI pairing origin refused");
  if (!(deps.terminalAvailable ?? (() => isatty(2)))()) throw new GuiPairingTerminalRequiredError();
  const created = createGuiPairingGrant(browserOrigin, config, state);
  const text = Buffer.from(
    `\nOpenCodex local dashboard pairing for ${origin}\n`
      + "Only enter this code into that dashboard if you requested pairing.\n"
      + `${created.grant}\n`
      + "This one-use code expires shortly. Do not save or share it.\n",
    "utf8",
  );
  let written = 0;
  while (written < text.length) {
    const count = (deps.writeTerminal ?? ((data, offset, length) => writeSync(2, data, offset, length)))(text, written, text.length - written);
    if (!Number.isInteger(count) || count <= 0 || count > text.length - written) throw new Error("Could not deliver GUI pairing code to server terminal");
    written += count;
  }
  // Deliberately construct a fresh public response, rather than spreading a secret-bearing row.
  return {
    delivery: "server-terminal",
    browserOrigin: created.browserOrigin,
    serverOrigin: created.serverOrigin,
    expiresAt: created.expiresAt,
  };
}
