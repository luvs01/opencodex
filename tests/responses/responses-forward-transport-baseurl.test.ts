import { describe, expect, test } from "bun:test";
import { buildResponsesTransport } from "../../src/adapters/openai-responses/transport";
import type { OcxProviderConfig } from "../../src/types";

// Regression coverage for CodeQL js/polynomial-redos alert #250: the forward-mode base URL was
// normalized with `replace(/\/+$/, "")`, which backtracks polynomially on a long slash run.
// The replacement is a linear scan, pinned here on the shapes that made the regex slow.
const forwardProvider = (baseUrl: string): OcxProviderConfig => ({
  adapter: "openai-responses",
  authMode: "forward",
  baseUrl,
});

const incoming = { headers: new Headers() };

describe("buildResponsesTransport baseUrl normalization", () => {
  test("noncanonical forward baseUrl drops every trailing slash", () => {
    const { url } = buildResponsesTransport(forwardProvider("https://relay.example.test/v1///"), incoming);
    expect(url).toBe("https://relay.example.test/v1/responses");
  });

  test("a baseUrl that is all trailing slashes still produces the endpoint", () => {
    const { url } = buildResponsesTransport(forwardProvider("https://relay.example.test/"), incoming);
    expect(url).toBe("https://relay.example.test/responses");
  });

  test("a long slash run away from the end does not stall normalization", () => {
    // The pathological input for `/\/+$/`: a long slash run that is NOT at the end makes the
    // backtracking engine retry every suffix. The linear scan treats it like any other URL.
    const baseUrl = `https://relay.example.test${"/".repeat(20_000)}v1`;
    const { url } = buildResponsesTransport(forwardProvider(baseUrl), incoming);
    expect(url).toBe(`${baseUrl}/responses`);
  });
});
