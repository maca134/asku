// End to end: each agent client against a local relay, with a simulated browser built on src/crypto.ts.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindTag, checkFragment, deriveKeys, open, seal } from "../src/crypto";
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
  const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pubB = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  const bound = await post(`/s/${sid}/bind`, { pub: pubB.toBase64(), mac: await bindTag(token, pubB) });
  expect(bound.status).toBe(201);
  const { key } = await bound.json();
  const keys = await deriveKeys(kp.privateKey, pubA);
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

for (const c of clients) {
  test.skipIf(!c.on)(`${c.name} against a local relay`, async () => {
    const home = mkdtempSync(join(tmpdir(), "asku-")).replaceAll("\\", "/");
    const env = { ...process.env, ASKU_URL: base, ASKU_HOME: home, ASKU_SESSION: "t", ASKU_WAIT: "1" };
    const run = async (args: string[], wait = "1") => {
      const p = Bun.spawn([...c.cmd, ...args], { env: { ...env, ASKU_WAIT: wait }, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
      return { code, out, err };
    };
    const q1 = `${home}/q1.json`;
    const q2 = `${home}/q2.json`;
    writeFileSync(q1, JSON.stringify(question));
    writeFileSync(q2, JSON.stringify({ questions: [{ id: "n", type: "text", label: "Name?" }] }));

    // fresh ask: prints the link and returns PENDING at once
    let res = await run(["ask", q1]);
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
    const home = mkdtempSync(join(tmpdir(), "asku-")).replaceAll("\\", "/");
    const env = { ...process.env, ASKU_URL: base, ASKU_HOME: home, ASKU_WAIT: "5" };
    writeFileSync(`${home}/q.json`, JSON.stringify(question));
    const run = (args: string[]) => Bun.spawn([...c.cmd, ...args], { env, stdout: "pipe", stderr: "pipe" });
    const first = run(["ask", `${home}/q.json`]);
    const link = (await new Response(first.stdout).text()).match(/https?:\/\/\S+#\S+/)![0];
    const b = await browser(link, { badToken: true });
    const p = run(["wait"]);
    expect(await p.exited).toBe(1);
    expect(await new Response(p.stderr).text()).toContain("without the right token");
    expect((await fetch(`${base}/s/${b.sid}`)).status).toBe(404);
  }, 60_000);
}
