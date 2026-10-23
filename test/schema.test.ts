import { expect, test } from "bun:test";
import Ajv from "ajv/dist/2020";
import answer from "../examples/answer.json";
import question from "../examples/question.json";
import schema from "../schema.json";

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true });
ajv.addSchema(schema);
const valid = (def: string, x: unknown) => ajv.validate(`${schema.$id}#/$defs/${def}`, x);
const q = (item: object) => ({ questions: [{ id: "x", label: "L", ...item }] });

test("examples are valid", () => {
  expect(valid("question", question)).toBe(true);
  expect(valid("answer", answer)).toBe(true);
});

test("bad shapes are rejected", () => {
  expect(valid("question", q({ type: "single" }))).toBe(false); // options required
  expect(valid("question", q({ type: "confirm", options: ["a"] }))).toBe(false);
  expect(valid("question", q({ type: "slider" }))).toBe(false);
  expect(valid("question", q({ type: "text", id: "bad id" }))).toBe(false);
  expect(valid("answer", { answers: { x: { nested: 1 } } })).toBe(false);
  expect(valid("answer", { answers: {}, extra: 1 })).toBe(false);
  expect(valid("question", { ...q({ type: "confirm" }), mood: "smug" })).toBe(false);
  expect(valid("question", { ...q({ type: "confirm" }), deadline: 0 })).toBe(false);
  expect(valid("say", { say: "" })).toBe(false);
  expect(valid("say", { say: "hi", questions: [] })).toBe(false);
});

test("other: a write-in on single and multi only", () => {
  expect(valid("question", q({ type: "single", options: ["a"], other: true, default: "typed" }))).toBe(true);
  expect(valid("question", q({ type: "multi", options: ["a"], other: true, default: ["a", "typed"] }))).toBe(true);
  expect(valid("question", q({ type: "single", options: ["a"], other: "yes" }))).toBe(false);
  expect(valid("question", q({ type: "text", other: true }))).toBe(false);
  expect(valid("question", q({ type: "confirm", other: true }))).toBe(false);
  expect(valid("question", q({ type: "number", other: true }))).toBe(false);
});

test("deadline, mood, say and delegated", () => {
  expect(
    valid("question", {
      ...q({ type: "confirm" }),
      deadline: 600,
      sent: 1761200000,
      mood: "begging",
      name: "shop: CSV export",
    }),
  ).toBe(true);
  expect(valid("question", { ...q({ type: "confirm" }), name: "" })).toBe(false);
  expect(valid("say", { say: "Tests **42/50**" })).toBe(true);
  expect(valid("answer", { answers: {}, delegated: ["x"], timeout: true })).toBe(true);
});
