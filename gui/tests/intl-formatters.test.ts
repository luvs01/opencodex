import { describe, expect, test } from "bun:test";
import { formatCreditDate, formatCreditDateTime } from "../src/intl-formatters";
import { formatResetFuture } from "../src/components/QuotaBars";
import type { TFn } from "../src/i18n";

describe("credit date formatting", () => {
  test("keeps the compact date format for grant dates", () => {
    const iso = "2026-07-31T12:34:56Z";
    const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

    expect(formatCreditDate(iso, "de-DE")).not.toContain(time);
  });

  test("includes the local time for expiration dates", () => {
    const iso = "2026-07-31T12:34:56Z";

    const time = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

    expect(formatCreditDateTime(iso, "de-DE")).toContain(time);
    expect(formatCreditDateTime(iso, "de-DE")).not.toBe("—");
  });

  test("handles invalid dates consistently", () => {
    expect(formatCreditDateTime("invalid")).toBe("—");
  });
});

describe("quota reset formatting", () => {
  test("ignores timestamps outside the JavaScript Date range", () => {
    const t = ((key: string) => key) as TFn;

    expect(formatResetFuture(1e20, t)).toBe("");
  });
});
