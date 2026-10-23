import { expect, test } from "bun:test";
import { merge, received, rename, type State, summary } from "../ui/session/storage";

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

test("a form stays waiting until an answer covers it", () => {
  const state = fresh();
  expect(received(state, 1)).toBe(true);
  expect(received(state, 1)).toBe(false);
  expect(summary("sid", state).waiting).toBe(true);
  state.answered.push(1);
  expect(summary("sid", state).waiting).toBe(false);
});

test("a session lists under its name, or a fallback, with its last activity", () => {
  const named = { ...fresh(), name: "Deploy plan", start: 100, active: 500 };
  expect(summary("abc", named)).toEqual({
    sid: "abc",
    name: "Deploy plan",
    waiting: false,
    joined: false,
    active: 500,
  });
  const unnamed = { ...fresh(), agentPub: "pub", start: 100 };
  expect(summary("def", unnamed)).toEqual({
    sid: "def",
    name: "Unnamed session",
    waiting: false,
    joined: true,
    active: 100,
  });
});

test("saving an older copy keeps what another tab or the service worker saved", () => {
  const stored = { ...fresh(), answered: [1, 2], asked: [1, 2, 3] };
  const page = { ...fresh(), answered: [1], asked: [1, 4], name: "Deploy plan" };
  merge(page, stored);
  expect(page.answered.toSorted()).toEqual([1, 2]);
  expect(page.asked?.toSorted()).toEqual([1, 2, 3, 4]);
  expect(page.name).toBe("Deploy plan");
  merge(page, undefined);
  expect(page.answered.toSorted()).toEqual([1, 2]);
});
