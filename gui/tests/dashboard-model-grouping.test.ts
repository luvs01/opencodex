import { expect, test } from "bun:test";
import { groupDashboardModels } from "../src/pages/use-dashboard-data";

test("Dashboard groups models whose provider names match object prototype properties", () => {
  const models = [
    { id: "proto-model", provider: "__proto__" },
    { id: "constructor-model", provider: "constructor" },
    { id: "string-model", provider: "toString" },
    { id: "second-proto-model", provider: "__proto__" },
  ];

  expect(groupDashboardModels(models)).toEqual([
    ["__proto__", [models[0], models[3]]],
    ["constructor", [models[1]]],
    ["toString", [models[2]]],
  ]);
});
