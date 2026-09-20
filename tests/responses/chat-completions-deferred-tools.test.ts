import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveConfig } from "../../src/config";
import { startServer } from "../../src/server";
import type { OcxConfig, OcxProviderConfig } from "../../src/types";
import { installIsolatedCodexHome, type IsolatedCodexHome } from "../helpers/isolated-codex-home";
import { removeTreeWithRetry } from "../helpers/remove-tree";
import { resetProviderRequestPacingForTest } from "../../src/providers/request-pacing";

/**
 * An upstream tool call must stay within the request's effective tool catalog. This applies to
 * Chat Completions as well as Responses: a client-side runner may know additional deferred tools,
 * but that must not let a routed provider select one the current request did not authorize.
 *
 * Lives beside chat-completions-endpoint.test.ts rather than inside it: that file sits against its
 * cap in tests/fixtures/file-size-baseline.json, and the ratchet only lowers.
 */

let testDir = "";
let previousHome: string | undefined;
let isolatedCodexHome: IsolatedCodexHome | null = null;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  previousHome = process.env.OPENCODEX_HOME;
  isolatedCodexHome = installIsolatedCodexHome("ocx-chat-deferred-tools-");
  testDir = mkdtempSync(join(tmpdir(), "ocx-chat-deferred-tools-"));
  process.env.OPENCODEX_HOME = testDir;
  globalThis.fetch = originalFetch;
});

afterEach(() => {
  resetProviderRequestPacingForTest();
  if (previousHome === undefined) delete process.env.OPENCODEX_HOME;
  else process.env.OPENCODEX_HOME = previousHome;
  isolatedCodexHome?.restore();
  isolatedCodexHome = null;
  globalThis.fetch = originalFetch;
  if (testDir) removeTreeWithRetry(testDir);
});

function mockConfig(baseUrl: string, providerOverrides: Partial<OcxProviderConfig> = {}): OcxConfig {
  return {
    port: 0,
    defaultProvider: "mock",
    providers: {
      mock: {
        adapter: "openai-responses",
        baseUrl,
        apiKey: "k",
        allowPrivateNetwork: true,
        ...providerOverrides,
      },
    },
  } as OcxConfig;
}

describe("chat-completions undeclared tool guard", () => {
  function mockResponsesUpstreamWithToolCall(toolName = "todo_write") {
    return Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (!url.pathname.endsWith("/responses")) {
          return Response.json({ error: { message: `unexpected path ${url.pathname}` } }, { status: 404 });
        }
        let isStreaming = true;
        try {
          const body = (await req.json()) as Record<string, unknown>;
          if (body.stream === false) isStreaming = false;
        } catch { /* keep default */ }

        if (!isStreaming) {
          return Response.json({
            id: "resp-test",
            object: "response",
            status: "completed",
            model: "mock/test-model",
            output: [
              { type: "function_call", id: "fc_1", call_id: "call_undeclared_1", name: toolName, arguments: "{\"path\":\"todo.md\"}", status: "completed" },
            ],
            usage: { input_tokens: 10, output_tokens: 15, total_tokens: 25 },
          });
        }

        const frames = [
          `event: response.output_item.added\ndata: ${JSON.stringify({ type: "response.output_item.added", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_undeclared_1", name: toolName, arguments: "" } })}\n\n`,
          `event: response.function_call_arguments.done\ndata: ${JSON.stringify({ type: "response.function_call_arguments.done", output_index: 0, item_id: "fc_1", name: toolName, arguments: "{\"path\":\"todo.md\"}" })}\n\n`,
          `event: response.output_item.done\ndata: ${JSON.stringify({ type: "response.output_item.done", output_index: 0, item: { type: "function_call", id: "fc_1", call_id: "call_undeclared_1", name: toolName, arguments: "{\"path\":\"todo.md\"}", status: "completed" } })}\n\n`,
          `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { id: "resp-test", status: "completed", output: [], usage: { input_tokens: 10, output_tokens: 15, total_tokens: 25 } } })}\n\n`,
        ];
        return new Response(frames.join(""), { headers: { "Content-Type": "text/event-stream" } });
      },
    });
  }

  test("refuses an undeclared function call when client streams with partial tools declared", async () => {
    const upstream = mockResponsesUpstreamWithToolCall("todo_write");
    saveConfig(mockConfig(`${upstream.url.toString().replace(/\/$/, "")}/v1`));
    const server = startServer(0);
    try {
      const response = await fetch(new URL("/v1/chat/completions", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock/test-model",
          stream: true,
          messages: [{ role: "user", content: "write to todo" }],
          tools: [
            {
              type: "function",
              function: {
                name: "lookup",
                description: "lookup symbol",
                parameters: { type: "object", properties: { q: { type: "string" } } },
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");
      const text = await response.text();
      expect(text).toContain("undeclared client tool");
      expect(text).toContain('"error"');
      expect(text).not.toContain('"tool_calls"');
      expect(text).not.toContain("data: [DONE]");
    } finally {
      await server.stop(true);
      upstream.stop(true);
    }
  });

  test("refuses an undeclared function call in buffered mode with partial tools declared", async () => {
    const upstream = mockResponsesUpstreamWithToolCall("todo_write");
    saveConfig(mockConfig(`${upstream.url.toString().replace(/\/$/, "")}/v1`));
    const server = startServer(0);
    try {
      const response = await fetch(new URL("/v1/chat/completions", server.url), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "mock/test-model",
          stream: false,
          messages: [{ role: "user", content: "write to todo" }],
          tools: [
            {
              type: "function",
              function: {
                name: "lookup",
                description: "lookup symbol",
                parameters: { type: "object", properties: { q: { type: "string" } } },
              },
            },
          ],
        }),
      });

      expect(response.status).toBe(502);
      const json = (await response.json()) as {
        choices?: Array<{
          message?: {
            tool_calls?: Array<{
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      expect(JSON.stringify(json)).toContain("undeclared client tool");
    } finally {
      await server.stop(true);
      upstream.stop(true);
    }
  });
});
