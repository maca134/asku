import { expect, test } from "bun:test";
import { rename, type State } from "../ui/session/storage";

const fresh = (): State => ({ priv: {} as CryptoKey, key: "k", answered: [] });

test("a form's name is kept, and a later one renames the session", () => {
  const state = fresh();
  expect(rename(state, "Deploy plan")).toBe(true);
  expect(state.name).toBe("Deploy plan");
  expect(rename(state, "Deploy plan")).toBe(false);
  expect(rename(state, "Rollback")).toBe(true);
  expect(state.name).toBe("Rollback");
});

test("a form without a name leaves the session as it was", () => {
  const unnamed = fresh();
  expect(rename(unnamed, undefined)).toBe(false);
  expect(unnamed).toEqual(fresh());
  const named = { ...fresh(), name: "Deploy plan" };
  expect(rename(named, undefined)).toBe(false);
  expect(named.name).toBe("Deploy plan");
});
