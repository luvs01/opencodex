import { expect, test } from "bun:test";

test("Providers does not expose the disabled full-config save flow", async () => {
  const source = await Bun.file(new URL("../src/pages/Providers.tsx", import.meta.url)).text();

  expect(source).not.toContain("useJsonConfigEditor");
  expect(source).not.toContain("onEditConfig=");
  expect(source).not.toContain("jsonEditor=");
});
