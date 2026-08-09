import { expect, test } from "bun:test";
import { readCollapsedProviders, writeCollapsedProviders } from "../src/pages/models-shared";

test("model preferences tolerate unavailable global storage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  try {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(readCollapsedProviders()).toBeNull();
    expect(() => writeCollapsedProviders(new Set(["openai"]))).not.toThrow();

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => { throw new Error("SecurityError"); },
    });
    expect(readCollapsedProviders()).toBeNull();
    expect(() => writeCollapsedProviders(new Set(["openai"]))).not.toThrow();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete (globalThis as { localStorage?: Storage }).localStorage;
  }
});
