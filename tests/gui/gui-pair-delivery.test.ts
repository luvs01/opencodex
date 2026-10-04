import { describe, expect, test } from "bun:test";
import type { OcxConfig } from "../../src/types";
import type { GuiSessionState } from "../../src/server/gui-session";
import { deliverGuiPairingGrant, GuiPairingTerminalRequiredError } from "../../src/server/gui-pair-delivery";

const ORIGIN = "http://127.0.0.1:10100";
const config = (): OcxConfig => ({ providers: {}, runtimeRole: "standalone", hostname: "127.0.0.1", port: 10100 } as OcxConfig);
const state = (): GuiSessionState => ({ sessions: new Map(), pairingGrants: new Map() });
function terminal(maxWrite = Number.MAX_SAFE_INTEGER) {
  let text = "";
  return {
    read: () => text,
    deps: {
      terminalAvailable: () => true,
      writeTerminal: (data: Buffer, offset: number, length: number) => {
        const n = Math.min(maxWrite, length);
        text += data.subarray(offset, offset + n).toString("utf8");
        return n;
      },
    },
  };
}
describe("standalone GUI pairing delivery", () => {
  test("returns only delivery metadata while the terminal receives the one-use code", () => {
    const tty = terminal(); const s = state();
    const result = deliverGuiPairingGrant(ORIGIN, config(), s, tty.deps);
    expect(result).toHaveProperty("delivery", "server-terminal");
    expect(result).not.toHaveProperty("grant");
    const code = tty.read().match(/ocx_pair_[A-Za-z0-9_-]{43}/)?.[0];
    expect(code).toBeDefined();
    expect(JSON.stringify(result)).not.toContain(code!);
    expect(s.pairingGrants.size).toBe(1);
    expect(s.sessions.size).toBe(0);
  });
  test("a service without a terminal refuses before minting", () => {
    const s = state();
    expect(() => deliverGuiPairingGrant(ORIGIN, config(), s, { terminalAvailable: () => false }))
      .toThrow(GuiPairingTerminalRequiredError);
    expect(s.pairingGrants.size).toBe(0);
  });
  test("wrong origins are rejected without touching the terminal", () => {
    const tty = terminal(); const s = state();
    expect(() => deliverGuiPairingGrant("http://127.0.0.1:10200", config(), s, tty.deps)).toThrow();
    expect(tty.read()).toBe(""); expect(s.pairingGrants.size).toBe(0);
  });
  test("client and wildcard-bound runtimes are not standalone pairing targets", () => {
    const tty = terminal(); const client = config(); client.runtimeRole = "client";
    const wildcard = config(); wildcard.hostname = "0.0.0.0";
    expect(() => deliverGuiPairingGrant(ORIGIN, client, state(), tty.deps)).toThrow();
    expect(() => deliverGuiPairingGrant(ORIGIN, wildcard, state(), tty.deps)).toThrow();
    expect(tty.read()).toBe("");
  });
  test("literal IPv6 origins are preserved", () => {
    const cfg = config(); cfg.hostname = "::1"; const tty = terminal();
    expect(deliverGuiPairingGrant("http://[::1]:10100", cfg, state(), tty.deps).serverOrigin).toBe("http://[::1]:10100");
  });
  test("partial terminal writes finish without duplicating the code", () => {
    const tty = terminal(7);
    deliverGuiPairingGrant(ORIGIN, config(), state(), tty.deps);
    expect(tty.read().match(/ocx_pair_[A-Za-z0-9_-]{43}/g)?.length).toBe(1);
  });
  test("failed or non-progressing terminal writes cannot return a successful result", () => {
    for (const count of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => deliverGuiPairingGrant(ORIGIN, config(), state(), {
        terminalAvailable: () => true, writeTerminal: () => count,
      })).toThrow();
    }
    expect(() => deliverGuiPairingGrant(ORIGIN, config(), state(), {
      terminalAvailable: () => true, writeTerminal: () => { throw new Error("fixture write failure"); },
    })).toThrow("fixture write failure");
  });
  test("the existing hub grant response is unchanged and does not require a terminal", () => {
    const cfg = config(); cfg.runtimeRole = "hub"; cfg.hub = { managementPublicOrigin: "https://hub.example" } as OcxConfig["hub"];
    const result = deliverGuiPairingGrant("https://hub.example", cfg, state(), {
      terminalAvailable: () => false, writeTerminal: () => { throw new Error("must not write"); },
    });
    expect(result).toHaveProperty("grant");
    expect(result).not.toHaveProperty("delivery");
  });
});
