// End to end: each agent client against a local relay, with a simulated browser built on src/crypto.ts.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindTag, checkBind, checkFragment, deriveKeys, fragmentFor, newKeyPair, open, seal, type Keys } from "../src/crypto";
import { relay } from "../src/relay";
import question from "../examples/question.json";

const r = relay({ holdMs: 500 });
afterAll(() => r.stop());
const base = r.server.url.href.replace(/\/$/, "");

const post = (path: string, body: unknown, key?: string) =>
  fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

async function browser(link: string, { badToken = false } = {}) {
  const url = new URL(link);
  const sid = url.pathname.split("/")[2];
  const pubA = Uint8Array.fromBase64((await (await fetch(`${base}/s/${sid}`)).json()).pub);
  const token = await checkFragment(url.hash.slice(1), pubA);
  if (badToken) token[0] ^= 1;
  const b = await newKeyPair();
  const bound = await post(`/s/${sid}/bind`, { pub: b.pub.toBase64(), mac: await bindTag(token, b.pub) });
  expect(bound.status).toBe(201);
  const { key } = await bound.json();
  return peer(sid, await deriveKeys(b.priv, pubA), key);
}

// The user starts the session in the browser and hands the agent a /j/ link.
async function creator() {
  const b = await newKeyPair();
  const token = crypto.getRandomValues(new Uint8Array(16));
  const res = await post("/s", { pub: b.pub.toBase64(), role: "browser" });
  expect(res.status).toBe(201);
  const { sid, key } = await res.json();
  return {
    sid,
    link: `${base}/j/${sid}#${await fragmentFor(b.pub, token)}`,
    async joined(note: string) {
      let bind: Response;
      do bind = await fetch(`${base}/s/${sid}/bind`); while (bind.status === 204);
      const { pub, mac } = await bind.json();
      expect(await checkBind(token, Uint8Array.fromBase64(pub), mac)).toBe(true);
      const s = peer(sid, await deriveKeys(b.priv, Uint8Array.fromBase64(pub)), key);
      await s.answer(0, { note });
      return s;
    },
  };
}

function peer(sid: string, keys: Keys, key: string) {
  return {
    sid,
    async question(seq: number) {
      const reader = (await fetch(`${base}/s/${sid}/q?after=${seq - 1}`)).body!.pipeThrough(new TextDecoderStream()).getReader();
      let feed = "";
      let m: RegExpMatchArray | null;
      while (!(m = feed.match(/^data: (.*)\n\n/m))) feed += (await reader.read()).value ?? "";
      await reader.cancel();
      return JSON.parse(await open(keys, sid, "q", seq, JSON.parse(m[1])));
    },
    async answer(seq: number, answer: unknown) {
      expect((await post(`/s/${sid}/a`, await seal(keys, sid, "a", seq, JSON.stringify(answer)), key)).status).toBe(204);
    },
  };
}

const clients = [
  { name: "ask.sh", cmd: [process.env.ASKU_BASH ?? "bash", "skill/ask.sh"], on: true },
  { name: "ask.ps1", cmd: ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "skill/ask.ps1"], on: process.platform === "win32" },
];

// A fresh ASKU_HOME holding q.json, and a runner for one client in it.
function agent(cmd: string[], env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "asku-")).replaceAll("\\", "/");
  writeFileSync(`${home}/q.json`, JSON.stringify(question));
  const run = async (args: string[], wait = env.ASKU_WAIT) => {
    const p = Bun.spawn([...cmd, ...args], { env: { ...process.env, ...env, ASKU_HOME: home, ASKU_WAIT: wait }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    return { code, out, err };
  };
  return { home, run };
}

test("clients report the same version", async () => {
  const versions = await Promise.all(clients.filter((c) => c.on).map(async (c) => (await agent(c.cmd, {}).run(["version"])).out.trim()));
  expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/);
  expect(new Set(versions).size).toBe(1);
});

for (const c of clients) {
  test.skipIf(!c.on)(`${c.name} against a local relay`, async () => {
    const { home, run } = agent(c.cmd, { ASKU_URL: base, ASKU_SESSION: "t", ASKU_WAIT: "1" });
    const q2 = `${home}/q2.json`;
    writeFileSync(q2, JSON.stringify({ questions: [{ id: "n", type: "text", label: "Name?" }] }));

    // fresh ask: prints the link and returns PENDING at once
    let res = await run(["ask", `${home}/q.json`]);
    expect(res.code).toBe(2);
    expect(res.out).toStartWith("PENDING\n");
    const link = res.out.match(/https?:\/\/\S+#[0-9a-f]{64}\.[0-9a-f]{32}/)![0];

    // nobody opened it yet
    res = await run(["wait"]);
    expect(res.code).toBe(2);
    expect(res.out).toContain(link);
    expect((await run(["ask", q2])).code).toBe(1); // q1 still pending

    // browser binds; wait sends q1 and blocks until the answer arrives
    const b = await browser(link);
    const waiting = run(["wait"], "30");
    expect(await b.question(1)).toEqual(question);
    const a1 = { answers: { go: true, env: "prod", checks: ["lint"], pct: 25 }, skipped: ["why"], comments: {}, note: "" };
    await b.answer(1, a1);
    res = await waiting;
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual(a1);

    // round 2 on the bound session, non-ASCII answer
    const asking = run(["ask", q2], "30");
    expect((await b.question(2)).questions[0].id).toBe("n");
    const a2 = { answers: { n: "Zoë — 日本語 🚀" }, skipped: [], comments: {}, note: "" };
    await b.answer(2, a2);
    res = await asking;
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual(a2);

    expect((await run(["wait"])).code).toBe(1); // nothing pending
    expect((await run(["close"])).code).toBe(0);
    expect((await fetch(`${base}/s/${b.sid}`)).status).toBe(404);
    expect(existsSync(`${home}/t`)).toBe(false);
  }, 120_000);

  test.skipIf(!c.on)(`${c.name} rejects a binding without the token`, async () => {
    const { home, run } = agent(c.cmd, { ASKU_URL: base, ASKU_WAIT: "5" });
    const link = (await run(["ask", `${home}/q.json`])).out.match(/https?:\/\/\S+#\S+/)![0];
    const b = await browser(link, { badToken: true });
    const res = await run(["wait"]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("without the right token");
    expect((await fetch(`${base}/s/${b.sid}`)).status).toBe(404);
  }, 60_000);

  test.skipIf(!c.on)(`${c.name} joins a session the user started`, async () => {
    // ASKU_URL points nowhere: a joined session must use its link's relay
    const { home, run } = agent(c.cmd, { ASKU_URL: "http://127.0.0.1:9", ASKU_WAIT: "30" });
    const u = await creator();

    const [head, frag] = u.link.split("#");
    let res = await run(["join", `${head}#${frag[0] === "0" ? "1" : "0"}${frag.slice(1)}`]);
    expect(res.code).toBe(1);
    expect(res.err).toContain("doesn't match");

    const joining = run(["join", u.link]);
    const note = "Zoë: please fix the build — 日本語";
    const s = await u.joined(note);
    res = await joining;
    expect(res.err).toBe("");
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out)).toEqual({ note });
    expect((await run(["join", u.link])).code).toBe(1); // session already in use

    const asking = run(["ask", `${home}/q.json`]);
    expect(await s.question(1)).toEqual(question);
    await s.answer(1, { answers: { go: false }, skipped: [], comments: {}, note: "" });
    res = await asking;
    expect(res.code).toBe(0);
    expect(JSON.parse(res.out).answers).toEqual({ go: false });

    expect((await run(["close"])).code).toBe(0);
    expect((await fetch(`${base}/s/${u.sid}`)).status).toBe(404);
  }, 120_000);
}
