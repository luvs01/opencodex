import { describe, expect, test } from "bun:test";
import { isModerationRefusalProse } from "../../src/combos/failover";

/**
 * Direct coverage of the moderation-refusal prose matcher. The pipeline-level
 * classification lives in router-combo-failover-classification.test.ts; this
 * file pins the matcher's accepted language and its linear bound.
 */
describe("moderation refusal prose matcher", () => {
  const accepted = [
    "refused",
    "Content refused.",
    "The input was refused by moderation.",
    "Prompt was blocked by moderation.",
    "Input was flagged by moderation.",
    "Your request was rejected by the content filter system.",
    "the response was filtered due to the prompt triggering azure openai's content management policy.",
    "the response was filtered due to the prompt triggering azure openais content management policy.",
    // A shorter verdict alternative must not win over the noun-phrased one that
    // reaches `by ... system` — the scan commits to the first verdict match.
    "content refused by moderation system.",
    "The request was blocked by the content filter system.",
    // `, and ` must not swallow retry-advice openings as category names.
    "refused category: harassment, and retry later.",
    "refused category: harassment, and please change your prompt.",
    "content refused. category: spam, and please",
    "refused category: a, and and b",
    "Your input violated the content safety policies.",
    "input violated content filtering policy",
    "refused category: a, b and c. please change your prompt and retry.",
    "refused categories: a, and b, c. retry later.",
    "refused please modify the prompt",
    "refused try again",
    "refused. to learn more about our content filtering policies please read our documentation: https://example.com/x",
    "flagged by content filter. category: harassment, hate. please revise your input.",
  ];
  test.each(accepted)("admits %s", prose => {
    expect(isModerationRefusalProse(prose)).toBe(true);
  });

  const rejected = [
    "your account is suspended",
    "quota exceeded: billing required",
    "model not found",
    "refused category: a!",
    "refused and retried",
    "please retry",
    "category: harassment",
    "",
  ];
  test.each(rejected)("keeps dev's decision on %s", prose => {
    expect(isModerationRefusalProse(prose)).toBe(false);
  });

  test("rejects a crafted category list in bounded time", () => {
    // CodeQL js/redos: the old single-regex shape backtracked exponentially on
    // "refused category: a" + ", and retry category: a" repeated before failing.
    const attack = "refused category: a" + ", and retry category: a".repeat(80) + "!";
    const started = performance.now();
    expect(isModerationRefusalProse(attack)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("matches a crafted category list that happens to be accepted in bounded time", () => {
    const attack = "refused category: a" + ", and retry category: a".repeat(80);
    const started = performance.now();
    expect(isModerationRefusalProse(attack)).toBe(true);
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});
