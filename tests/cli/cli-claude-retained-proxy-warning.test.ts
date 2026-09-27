import { expect, spyOn, test } from "bun:test";
import { handleClaudeConfigCommand } from "../../src/cli/integrations";
import { createTempHome } from "../helpers/temp-home";

for (const json of [false, true]) {
  test(`CLI ${json ? "JSON" : "human"} output retains the shared-proxy warning`, async () => {
    const home = createTempHome("ocx-retained-proxy-cli-");
    const output: string[] = [];
    const log = spyOn(console, "log").mockImplementation((...args: unknown[]) => { output.push(args.join(" ")); });
    const payload = { ok: true, cliFirstParty: false, warnings: ["shared_proxy_retained"] };
    try {
      await handleClaudeConfigCommand(["set", "--first-party", "off", ...(json ? ["--json"] : [])], {
        baseUrl: "http://127.0.0.1:19100",
        fetchImpl: (async () => Response.json(payload)) as typeof fetch,
      });
      const text = output.join("\n");
      if (json) expect(JSON.parse(text)).toEqual(payload);
      else { expect(text).toContain("CLI traffic may still use it"); expect(text).toContain("ocx claude desktop apply --gateway"); }
    } finally { log.mockRestore(); home.remove(); }
  });
}
