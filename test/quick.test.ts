import { afterAll, expect, test } from "bun:test";
import { relay } from "../api/relay";
import { deriveKeys, newKeyPair, seal } from "../shared/crypto";
import { choice, confirmAnswer, fetchBatch, quickConfirm } from "../ui/session/quick";
import v from "./vectors.json";

const confirm = { id: "ship", type: "confirm", label: "Ship it?" } as const;

test("a lone confirm question gets Yes/No buttons", () => {
  expect(quickConfirm({ title: "Deploy", questions: [confirm] })).toEqual(confirm);
  expect(quickConfirm({ questions: [confirm], mood: "excited" })).toEqual(confirm);
});

test("anything else opens the page instead", () => {
  expect(quickConfirm({ questions: [confirm, { ...confirm, id: "tag" }] })).toBeNull();
  expect(quickConfirm({ questions: [{ id: "name", type: "text", label: "Name?" }] })).toBeNull();
  expect(quickConfirm({ questions: [confirm], mood: "nervous" })).toBeNull();
  expect(quickConfirm({ questions: [{ ...confirm, display: "button" }] })).toBeNull();
  expect(quickConfirm({ say: "Deploying now" })).toBeNull();
  expect(quickConfirm({ questions: [{ id: "ship", type: "confirm" }] })).toBeNull();
  expect(quickConfirm({ questions: [{ ...confirm, when: { id: "ship", is: true } }] })).toBeNull(); // the page rejects it
});

test("a notification answer is the one the page sends for that question", () => {
  expect(JSON.stringify(confirmAnswer(3, "ship", true))).toBe(
    '{"seqs":[3],"answers":{"ship":true},"skipped":[],"comments":{},"note":""}',
  );
  expect(confirmAnswer(4, "ship", false).answers).toEqual({ ship: false });
});

test("only the Yes and No buttons answer; a plain tap (or no buttons, as on iOS) opens the page", () => {
  expect(choice("yes")).toBe(true);
  expect(choice("no")).toBe(false);
  expect(choice("")).toBeNull();
  expect(choice("other")).toBeNull();
});

const r = relay({ holdMs: 300 });
afterAll(() => r.stop());
const base = r.server.url.href.replace(/\/$/, "");

test("a batch is fetched from the relay by its seq and decrypted", async () => {
  const call = (path: string, body: unknown, key?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify(body),
    });
  const { sid, key } = await (await call("/s", { pub: v.pubA })).json();
  await call(`/s/${sid}/bind`, { pub: v.pubB, mac: v.bind });
  const keys = await deriveKeys((await newKeyPair()).priv, (await newKeyPair()).pub);
  const first = { questions: [{ id: "a", type: "text", label: "First" }] };
  const second = { questions: [confirm] };
  await call(`/s/${sid}/q`, await seal(keys, sid, "q", 1, JSON.stringify(first)), key);
  await call(`/s/${sid}/q`, await seal(keys, sid, "q", 2, JSON.stringify(second)), key);

  expect(await fetchBatch(base, sid, 2, keys)).toEqual(second);
  expect(await fetchBatch(base, sid, 1, keys)).toEqual(first);
  const otherKeys = await deriveKeys((await newKeyPair()).priv, (await newKeyPair()).pub);
  expect(await fetchBatch(base, sid, 2, otherKeys)).toBeNull();
  expect(await fetchBatch(base, sid, 3, keys, AbortSignal.timeout(300))).toBeNull();
});
