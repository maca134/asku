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

test("message: text or STOP from the user, nothing else", () => {
  expect(valid("message", { message: "use staging" })).toBe(true);
  expect(valid("message", { stop: true })).toBe(true);
  expect(valid("message", { message: "" })).toBe(false);
  expect(valid("message", { stop: false })).toBe(false);
  expect(valid("message", {})).toBe(false);
  expect(valid("message", { message: "hi", answers: {} })).toBe(false);
});

test("other: a write-in on single and multi only", () => {
  expect(valid("question", q({ type: "single", options: ["a"], other: true, default: "typed" }))).toBe(true);
  expect(valid("question", q({ type: "multi", options: ["a"], other: true, default: ["a", "typed"] }))).toBe(true);
  expect(valid("question", q({ type: "single", options: ["a"], other: "yes" }))).toBe(false);
  expect(valid("question", q({ type: "text", other: true }))).toBe(false);
  expect(valid("question", q({ type: "confirm", other: true }))).toBe(false);
  expect(valid("question", q({ type: "number", other: true }))).toBe(false);
});

test("review: approve or reject each option, answered as a map", () => {
  expect(valid("question", q({ type: "review", options: ["a", { value: "b", md: "*why*" }], required: true }))).toBe(
    true,
  );
  expect(valid("question", q({ type: "review" }))).toBe(false); // options required
  expect(valid("question", q({ type: "review", options: [] }))).toBe(false);
  expect(valid("question", q({ type: "review", options: ["a"], default: { a: true } }))).toBe(false);
  expect(valid("question", q({ type: "review", options: ["a"], other: true }))).toBe(false);
  expect(valid("answer", { answers: { x: { a: true, b: false } }, skipped: [] })).toBe(true);
  expect(valid("answer", { answers: { x: { a: "yes" } } })).toBe(false);
});

test("rank: order the options, answered as the full list", () => {
  expect(valid("question", q({ type: "rank", options: ["a", { value: "b", md: "*why*" }], required: true }))).toBe(
    true,
  );
  expect(valid("question", q({ type: "rank" }))).toBe(false); // options required
  expect(valid("question", q({ type: "rank", options: [] }))).toBe(false);
  expect(valid("question", q({ type: "rank", options: ["a"], default: ["a"] }))).toBe(false);
  expect(valid("question", q({ type: "rank", options: ["a", "b"], max: 1 }))).toBe(false); // no top-N
  expect(valid("question", q({ type: "rank", options: ["a"], other: true }))).toBe(false);
  expect(valid("answer", { answers: { x: ["b", "a"] }, skipped: [] })).toBe(true);
});

test("date: a day, or a day and time with time: true", () => {
  const day = { type: "date", default: "2026-10-24", min: "2026-10-01", max: "2026-12-31" };
  expect(valid("question", q({ ...day, required: true }))).toBe(true);
  expect(valid("question", q({ type: "date", time: true, default: "2026-10-24T09:30", min: "2026-10-24T08:00" }))).toBe(
    true,
  );
  expect(valid("question", q({ type: "date", default: "2026-10-24T09:30" }))).toBe(false); // a time needs time: true
  expect(valid("question", q({ type: "date", time: true, default: "2026-10-24" }))).toBe(false);
  expect(valid("question", q({ type: "date", time: true, min: "2026-10-24T09:30+07:00" }))).toBe(false); // no offset
  expect(valid("question", q({ type: "date", max: "24/10/2026" }))).toBe(false);
  expect(valid("question", q({ type: "date", time: "only" }))).toBe(false); // no time-only mode
  expect(valid("question", q({ type: "time" }))).toBe(false);
  expect(valid("question", q({ type: "date", options: ["a"] }))).toBe(false);
  expect(valid("answer", { answers: { x: "2026-10-24T09:30+07:00" }, skipped: [] })).toBe(true);
});

test("number: display slider needs min and max", () => {
  const slider = { type: "number", display: "slider", min: 0, max: 100 };
  expect(valid("question", q(slider))).toBe(true);
  expect(valid("question", q({ ...slider, step: 5, default: 10, required: true }))).toBe(true);
  expect(valid("question", q({ type: "number", display: "stepper" }))).toBe(true);
  expect(valid("question", q({ type: "number", display: "slider", min: 0 }))).toBe(false);
  expect(valid("question", q({ type: "number", display: "slider", max: 100 }))).toBe(false);
  expect(valid("question", q({ type: "number", display: "slider" }))).toBe(false);
  expect(valid("question", q({ ...slider, display: "dial" }))).toBe(false);
  expect(valid("question", q({ type: "text", display: "slider", min: 0, max: 1 }))).toBe(false);
});

test("when: show a question only for one answer to an earlier one", () => {
  const ask = (...questions: object[]) => ({ questions });
  const go = { id: "go", type: "confirm", label: "Go?" };
  const env = { id: "env", type: "single", label: "Env", options: ["staging", "prod"] };
  for (const type of ["confirm", "text", "number", "date"])
    expect(valid("question", ask(go, { id: "y", type, label: "Y", when: { id: "go", is: true } }))).toBe(true);
  for (const type of ["single", "multi", "review", "rank"])
    expect(
      valid("question", ask(env, { id: "y", type, label: "Y", options: ["a"], when: { id: "env", is: "prod" } })),
    ).toBe(true);
  const dependent = (when: unknown) => ask(go, { id: "y", type: "text", label: "Y", when });
  expect(valid("question", dependent({ id: "go" }))).toBe(false);
  expect(valid("question", dependent({ is: true }))).toBe(false);
  expect(valid("question", dependent({ id: "go", is: 1 }))).toBe(false);
  expect(valid("question", dependent({ id: "go", is: "" }))).toBe(false);
  expect(valid("question", dependent({ id: "go", is: ["a", "b"] }))).toBe(false); // no or
  expect(valid("question", dependent({ id: "go", is: true, not: true }))).toBe(false); // no operators
  expect(valid("question", dependent([{ id: "go", is: true }]))).toBe(false); // no and
  expect(valid("question", dependent({ id: "bad id", is: true }))).toBe(false);
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
