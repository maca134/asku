// `when`: a question shown only for one answer to an earlier question in its batch.
import type { Item } from "../types";

export type Visibility = "shown" | "hidden" | "delegated";
type Answerable = { item: Item; value: () => unknown; delegated: () => boolean };

// What the schema can't check: the id is earlier in the batch, and `is` is one of its answers.
export function conditionProblem(questions: Item[]) {
  for (const [i, { when }] of questions.entries()) {
    if (!when) continue;
    const where = `/questions/${i}/when`;
    const target = questions.slice(0, i).find((item) => item.id === when.id);
    if (!target) return `${where}: no earlier question ${when.id}`;
    if (target.type === "confirm") {
      if (typeof when.is !== "boolean") return `${where}: ${when.id} is answered true or false`;
      continue;
    }
    if (target.type !== "single" && target.type !== "multi")
      return `${where}: only confirm, single or multi questions can be depended on`;
    const values = target.options.map((choice) => (typeof choice === "string" ? choice : choice.value));
    if (!values.includes(when.is as string)) return `${where}: ${when.is} is not an option of ${when.id}`;
  }
  return null;
}

// In order, so a dependent sees its target's state: hidden hides it, delegated delegates it.
export function visibility(fields: Answerable[]) {
  const states = new Map<string, Visibility>();
  const byId = new Map(fields.map((f) => [f.item.id, f]));
  for (const { item } of fields) {
    const target = item.when && byId.get(item.when.id);
    if (!item.when || !target) {
      states.set(item.id, "shown");
      continue;
    }
    const state = states.get(target.item.id);
    if (state === "hidden") states.set(item.id, "hidden");
    else if (state === "delegated" || target.delegated()) states.set(item.id, "delegated");
    else states.set(item.id, matches(target.value(), item.when.is) ? "shown" : "hidden");
  }
  return states;
}

export const countShown = (fields: Answerable[]) =>
  [...visibility(fields).values()].filter((state) => state === "shown").length;

const matches = (value: unknown, is: string | boolean) => (Array.isArray(value) ? value.includes(is) : value === is);
