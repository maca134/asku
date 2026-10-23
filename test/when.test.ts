import { expect, test } from "bun:test";
import { conditionProblem, countShown, visibility } from "../ui/form/when";
import type { Item } from "../ui/types";

const go: Item = { id: "go", type: "confirm", label: "Go?" };
const env: Item = { id: "env", type: "single", label: "Env", options: ["staging", { value: "prod", label: "Prod" }] };
const checks: Item = { id: "checks", type: "multi", label: "Checks", options: ["lint", "e2e"], other: true };
const note = (when: { id: string; is: string | boolean }, id = "y"): Item => ({ id, type: "text", label: "Y", when });

test("a when must name an earlier confirm, single or multi, with one of its answers", () => {
  expect(
    conditionProblem([go, env, checks, note({ id: "go", is: false }, "a"), note({ id: "env", is: "prod" }, "b")]),
  ).toBe(null);
  expect(conditionProblem([checks, note({ id: "checks", is: "e2e" })])).toBe(null);
  expect(conditionProblem([go, note({ id: "nope", is: true })])).toBe("/questions/1/when: no earlier question nope");
  expect(conditionProblem([note({ id: "go", is: true }), go])).toBe("/questions/0/when: no earlier question go");
  expect(conditionProblem([note({ id: "y", is: "x" })])).toBe("/questions/0/when: no earlier question y");
  expect(conditionProblem([go, note({ id: "go", is: "yes" })])).toBe("/questions/1/when: go is answered true or false");
  expect(conditionProblem([env, note({ id: "env", is: "Prod" })])).toBe(
    "/questions/1/when: Prod is not an option of env",
  );
  expect(conditionProblem([env, note({ id: "env", is: true })])).toBe(
    "/questions/1/when: true is not an option of env",
  );
  const text: Item = { id: "t", type: "text", label: "T" };
  expect(conditionProblem([text, note({ id: "t", is: "x" })])).toBe(
    "/questions/1/when: only confirm, single or multi questions can be depended on",
  );
});

const field = (item: Item, value?: unknown, delegated = false) => ({
  item,
  value: () => value,
  delegated: () => delegated,
});

test("a dependent shows only on its answer; multi means contains", () => {
  const states = (goValue: unknown, checksValue: unknown) =>
    visibility([
      field(go, goValue),
      field(note({ id: "go", is: true }, "a")),
      field(checks, checksValue),
      field(note({ id: "checks", is: "e2e" }, "b")),
    ]);
  expect(states(true, ["lint", "e2e"])).toEqual(
    new Map([
      ["go", "shown"],
      ["a", "shown"],
      ["checks", "shown"],
      ["b", "shown"],
    ]),
  );
  expect(states(false, ["lint"]).get("a")).toBe("hidden");
  expect(states(false, ["lint"]).get("b")).toBe("hidden");
  expect(states(undefined, undefined).get("a")).toBe("hidden"); // skipped
  expect(states(undefined, undefined).get("b")).toBe("hidden");
});

test("a delegated question delegates its dependents; hidden ones hide theirs", () => {
  const chain = (goValue: unknown, goDelegated: boolean, envValue?: unknown) =>
    visibility([
      field(go, goValue, goDelegated),
      field({ ...env, when: { id: "go", is: true } }, envValue),
      field(note({ id: "env", is: "prod" })),
    ]);
  expect([...chain(undefined, true).values()]).toEqual(["shown", "delegated", "delegated"]);
  expect([...chain(false, false, "prod").values()]).toEqual(["shown", "hidden", "hidden"]);
  expect([...chain(true, false, "prod").values()]).toEqual(["shown", "shown", "shown"]);
  expect([...chain(true, false, "staging").values()]).toEqual(["shown", "shown", "hidden"]);
});

test("only shown questions count: a hidden or delegated dependent is not one to answer", () => {
  const batch = (goValue: unknown, goDelegated = false) =>
    countShown([field(go, goValue, goDelegated), field(note({ id: "go", is: true }, "a")), field(checks)]);
  expect(batch(true)).toBe(3);
  expect(batch(false)).toBe(2);
  expect(batch(undefined, true)).toBe(2);
});
