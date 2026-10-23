import { afterAll, expect, test } from "bun:test";
import { LIMITS, relay } from "../src/relay";
import v from "./vectors.json";

const r = relay({ holdMs: 300 });
afterAll(() => r.stop());
const base = r.server.url.href.replace(/\/$/, "");

const call = (method: string, path: string, body?: unknown, key?: string) =>
  fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const env = (dir: "q" | "a", seq: number) => {
  const { pt, ...e } = v.messages.find((m) => m.dir === dir)!;
  return { ...e, seq };
};
const create = async () => (await (await call("POST", "/s", { pub: v.pubA })).json()) as { sid: string; key: string };

test("full session: create, bind, q over SSE, a over long-poll, close", async () => {
  const { sid, key } = await create();
  expect(sid).toMatch(/^[\w-]{22}$/);

  const res = await call("GET", `/s/${sid}`);
  expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  expect(await res.json()).toEqual({ pub: v.pubA, bound: false });

  expect((await call("GET", `/s/${sid}/bind`)).status).toBe(204); // hold expires unbound
  const bindPoll = call("GET", `/s/${sid}/bind`);
  const bound = await call("POST", `/s/${sid}/bind`, { pub: v.pubB, mac: v.bind });
  expect(bound.status).toBe(201);
  const { key: bkey } = await bound.json();
  expect(await (await bindPoll).json()).toEqual({ pub: v.pubB, mac: v.bind }); // woken by the bind
  expect((await call("POST", `/s/${sid}/bind`, { pub: v.pubB, mac: v.bind })).status).toBe(409);

  // questions: agent key only, strictly sequential
  expect((await call("POST", `/s/${sid}/q`, env("q", 1))).status).toBe(401);
  expect((await call("POST", `/s/${sid}/q`, env("q", 1), bkey)).status).toBe(401);
  expect((await call("POST", `/s/${sid}/q`, env("q", 2), key)).status).toBe(409);
  expect((await call("POST", `/s/${sid}/q`, env("q", 1), key)).status).toBe(204);
  expect((await call("POST", `/s/${sid}/q`, env("q", 1), key)).status).toBe(409);
  expect((await call("POST", `/s/${sid}/q`, { ...env("q", 2), dir: "a" }, key)).status).toBe(400);
  expect((await call("POST", `/s/${sid}/q`, { ...env("q", 2), iv: "AAAA" }, key)).status).toBe(400);
  expect((await call("POST", `/s/${sid}/q`, { ...env("q", 2), x: 1 }, key)).status).toBe(400);

  // SSE replays q1, then pushes q2 live
  const sse = await fetch(`${base}/s/${sid}/q`);
  expect(sse.headers.get("content-type")).toBe("text/event-stream");
  const reader = sse.body!.pipeThrough(new TextDecoderStream()).getReader();
  let feed = "";
  const until = async (s: string) => { while (!feed.includes(s)) feed += (await reader.read()).value ?? ""; };
  await until("id: 1\n");
  expect(feed).toContain(`event: q\ndata: ${JSON.stringify(env("q", 1))}\n\n`);
  expect((await call("POST", `/s/${sid}/q`, env("q", 2), key)).status).toBe(204);
  await until("id: 2\n");

  // answers: browser key only, must match an asked question, once
  expect((await call("GET", `/s/${sid}/a?after=0`)).status).toBe(204);
  const answerPoll = call("GET", `/s/${sid}/a?after=0`);
  expect((await call("POST", `/s/${sid}/a`, env("a", 1), key)).status).toBe(401);
  expect((await call("POST", `/s/${sid}/a`, env("a", 3), bkey)).status).toBe(409);
  expect((await call("POST", `/s/${sid}/a`, env("a", 1), bkey)).status).toBe(204);
  expect((await call("POST", `/s/${sid}/a`, env("a", 1), bkey)).status).toBe(409);
  expect(await (await answerPoll).json()).toEqual([env("a", 1)]);
  expect((await call("POST", `/s/${sid}/a`, env("a", 2), bkey)).status).toBe(204);
  expect(await (await call("GET", `/s/${sid}/a?after=1`)).json()).toEqual([env("a", 2)]);

  // close: purge, SSE told, everything 404
  expect((await call("DELETE", `/s/${sid}`, undefined, bkey)).status).toBe(401);
  expect((await call("DELETE", `/s/${sid}`, undefined, key)).status).toBe(204);
  await until("event: close\n");
  expect((await call("GET", `/s/${sid}`)).status).toBe(404);
  expect((await call("GET", `/s/${sid}/a?after=0`)).status).toBe(404);
});

test("rejects bad input", async () => {
  expect((await call("POST", "/s", { pub: v.pubA.replace(/^B/, "C") })).status).toBe(400);
  expect((await fetch(`${base}/s`, { method: "POST", body: JSON.stringify({ pub: v.pubA }) })).status).toBe(400); // not application/json
  expect((await call("POST", "/s", "x".repeat(LIMITS.body + 1))).status).toBe(413);
  const { sid } = await create();
  expect((await call("POST", `/s/${sid}/bind`, { pub: v.pubB, mac: "AAAA" })).status).toBe(400);
  expect((await call("GET", "/s/nope")).status).toBe(404);
  expect((await call("GET", "/elsewhere")).status).toBe(404);
});

test("rate limits session creation per IP", async () => {
  const statuses = [];
  for (let i = 0; i < LIMITS.createPerIp + 1; i++) statuses.push((await call("POST", "/s", { pub: v.pubA })).status);
  expect(statuses.at(-1)).toBe(429);
});
