import { expect, test } from "bun:test";
import { readStoredTheme, writeStoredTheme } from "../src/theme-storage";

function throwingStorage(): Storage {
  return {
    getItem: () => { throw new DOMException("Blocked", "SecurityError"); },
    setItem: () => { throw new DOMException("Blocked", "SecurityError"); },
    removeItem: () => { throw new DOMException("Blocked", "SecurityError"); },
  } as Storage;
}

test("falls back to the system theme when storage reads are blocked", () => {
  expect(readStoredTheme(throwingStorage())).toBe("system");
});

test("theme updates do not fail when storage writes are blocked", () => {
  expect(() => writeStoredTheme("dark", throwingStorage())).not.toThrow();
  expect(() => writeStoredTheme("system", throwingStorage())).not.toThrow();
});
