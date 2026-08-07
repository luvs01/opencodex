import { describe, expect, test } from "bun:test";
import { evidenceFromBody } from "../src/routing/request-evidence";

describe("request evidence extraction (RI-05)", () => {
  test("top-level responses input image part is detected", () => {
    const evidence = evidenceFromBody({
      input: [{ type: "input_image", image_url: "https://example.test/i.png" }],
    });
    expect(evidence.imageInputRequired).toBe(true);
  });

  test("images nested under input[].content are detected", () => {
    const evidence = evidenceFromBody({
      input: [{ type: "message", content: [{ type: "input_image", image_url: "https://example.test/i.png" }] }],
    });
    expect(evidence.imageInputRequired).toBe(true);
  });

  test("images nested under messages[].content are detected (chat/claude bodies)", () => {
    const evidence = evidenceFromBody({
      messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.test/i.png" } }] }],
    });
    expect(evidence.imageInputRequired).toBe(true);
  });

  test("text-only bodies produce no image requirement", () => {
    const evidence = evidenceFromBody({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(evidence.imageInputRequired).toBeUndefined();
  });

  test("deeply nested and cyclic content is scanned without recursion", () => {
    let content: unknown = [{ type: "input_image", image_url: "https://example.test/i.png" }];
    for (let depth = 0; depth < 20_000; depth += 1) content = [{ content }];
    expect(evidenceFromBody({ input: content }).imageInputRequired).toBe(true);

    const cyclic: { content?: unknown } = {};
    cyclic.content = cyclic;
    expect(evidenceFromBody({ messages: [cyclic] }).imageInputRequired).toBeUndefined();
  });

  test("tools array produces toolsRequired", () => {
    const evidence = evidenceFromBody({
      tools: [{ type: "function", function: { name: "x" } }],
    });
    expect(evidence.toolsRequired).toBe(true);
  });
});
