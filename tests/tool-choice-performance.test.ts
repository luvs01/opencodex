import { expect, test } from "bun:test";
import type { OcxTool } from "../src/types";
import { toolChoiceToolPredicate } from "../src/types";

test("allowed_tools resolves an ambiguous bare name with one catalog pass", () => {
  const size = 256;
  const backingTools: OcxTool[] = Array.from({ length: size }, (_, index) => ({
    namespace: `namespace_${index}`,
    name: "shared_name",
    description: "",
    parameters: {},
  }));
  let catalogReads = 0;
  const tools = new Proxy(backingTools, {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) catalogReads += 1;
      return Reflect.get(target, property, receiver);
    },
  });

  const allowed = toolChoiceToolPredicate(
    { allowedTools: ["shared_name"], mode: "auto" },
    tools,
  );

  expect(tools.filter(allowed)).toEqual([]);
  expect(catalogReads).toBeLessThanOrEqual(size * 2);
});
