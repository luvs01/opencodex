import { afterEach, describe, expect, test } from "bun:test";
import { handleResponses } from "../../src/server/responses";
import { UNDECLARED_TOOL_CALL_ERROR_CODE } from "../../src/server/responses-undeclared-tool-guard";
import type { OcxConfig } from "../../src/types";
import { acquireOwnedSpendHome } from "../helpers/owned-spend-home";

let releaseSpendHome: (() => void) | undefined;
const takeSpendHome = (): void => { releaseSpendHome ??= acquireOwnedSpendHome(); };
afterEach(() => { releaseSpendHome?.(); releaseSpendHome = undefined; });

function frame(type: string, payload: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}`;
}

describe("native passthrough inbound tool catalogs", () => {
  const config = {
    port: 0,
    defaultProvider: "fixture",
    providers: {
      fixture: {
        adapter: "openai-responses",
        baseUrl: "https://fixture.test/v1",
        authMode: "key",
        apiKey: "fixture-key",
      },
    },
  } as OcxConfig;

  const call = {
    type: "function_call",
    id: "fc_1",
    call_id: "call_1",
    name: "apply_patch",
    arguments: "{}",
    status: "completed",
  };

  async function post(
    stream: boolean,
    tools: unknown[] | undefined,
    upstream: () => Response,
    additionalTools?: unknown[],
    requestConfig: OcxConfig = config,
    history: unknown[] = [],
    model = "fixture/deepseek-v4-flash",
    previousResponseId?: string,
    toolChoice?: unknown,
    inboundWire?: "chat" | "anthropic",
  ) {
    const savedFetch = globalThis.fetch;
    globalThis.fetch = (async () => upstream()) as typeof fetch;
    try {
      takeSpendHome();
      return await handleResponses(new Request("http://localhost/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model,
          stream,
          ...(previousResponseId ? { previous_response_id: previousResponseId } : {}),
          input: [
            ...history,
            { role: "user", content: [{ type: "input_text", text: "hi" }] },
            ...(additionalTools === undefined
              ? []
              : [{ type: "additional_tools", role: "developer", tools: additionalTools }]),
          ],
          ...(tools === undefined ? {} : { tools }),
          ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
        }),
      }), requestConfig, { model: "", provider: "" }, { inboundWire });
    } finally {
      globalThis.fetch = savedFetch;
    }
  }

  for (const inboundWire of ["chat", "anthropic"] as const) {
    for (const stream of [false, true]) {
      test(`${inboundWire} passthrough refuses undeclared Write calls (${stream ? "streaming" : "JSON"})`, async () => {
        const writeCall = { ...call, name: "Write" };
        const upstream = stream
          ? () => new Response([
            frame("response.output_item.added", { output_index: 0, item: writeCall }),
            frame("response.completed", { response: { id: "resp_1", status: "completed", output: [writeCall] } }),
          ].join("\n\n") + "\n\n", { headers: { "content-type": "text/event-stream" } })
          : () => new Response(
            JSON.stringify({ id: "resp_1", status: "completed", output: [writeCall] }),
            { headers: { "content-type": "application/json" } },
          );
        const response = await post(
          stream,
          [{ type: "function", name: "Read", parameters: { type: "object" } }],
          upstream,
          undefined,
          config,
          [],
          "fixture/deepseek-v4-flash",
          undefined,
          undefined,
          inboundWire,
        );

        if (stream) {
          expect(await response.text()).toContain(UNDECLARED_TOOL_CALL_ERROR_CODE);
        } else {
          expect(response.status).toBe(502);
          expect(await response.text()).toContain("undeclared");
        }
      });
    }
  }

});
