// End to end: each agent client against a local relay, with a simulated browser built on shared/crypto.ts.
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relay } from "../api/relay";
import question from "../examples/question.json";
import {
  bindTag,
  checkBind,
  checkFragment,
  deriveKeys,
  fragmentFor,
  type Keys,
  newKeyPair,
  open,
  seal,
} from "../shared/crypto";

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
      do bind = await fetch(`${base}/s/${sid}/bind`);
      while (bind.status === 204);
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
      const reader = (await fetch(`${base}/s/${sid}/q?after=${seq - 1}`))
        .body!.pipeThrough(new TextDecoderStream())
        .getReader();
      let feed = "";
      let match = feed.match(/^data: (.*)\n\n/m);
      while (!match) {
        feed += (await reader.read()).value ?? "";
        match = feed.match(/^data: (.*)\n\n/m);
      }
      await reader.cancel();
      return JSON.parse(await open(keys, sid, "q", seq, JSON.parse(match[1])));
    },
    async answer(seq: number, answer: unknown) {
      expect((await post(`/s/${sid}/a`, await seal(keys, sid, "a", seq, JSON.stringify(answer)), key)).status).toBe(
        204,
      );
    },
  };
}

const clients = [
  { name: "ask.sh", cmd: [process.env.ASKU_BASH ?? "bash", "skill/ask.sh"], on: true },
  {
    name: "ask.ps1",
    cmd: ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "skill/ask.ps1"],
    on: process.platform === "win32",
  },
];

// A fresh ASKU_HOME holding q.json, and a runner for one client in it.
function agent(cmd: string[], env: Record<string, string>) {
  const home = mkdtempSync(join(tmpdir(), "asku-")).replaceAll("\\", "/");
  writeFileSync(`${home}/q.json`, JSON.stringify(question));
  const run = async (args: string[], wait = env.ASKU_WAIT) => {
    const p = Bun.spawn([...cmd, ...args], {
      env: { ...process.env, ...env, ASKU_HOME: home, ASKU_WAIT: wait },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
    return { code, out, err };
  };
  return { home, run };
}

test("clients report the same version", async () => {
  const versions = await Promise.all(
    clients.filter((c) => c.on).map(async (c) => (await agent(c.cmd, {}).run(["version"])).out.trim()),
  );
  expect(versions[0]).toMatch(/^\d+\.\d+\.\d+$/);
  expect(new Set(versions).size).toBe(1);
});

for (const c of clients) {
  test.skipIf(!c.on)(
    `${c.name} against a local relay`,
    async () => {
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
      const a1 = {
        answers: { go: true, env: "prod", checks: ["lint"], pct: 25 },
        skipped: ["why"],
        comments: {},
        note: "",
      };
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
    },
    120_000,
  );

  test.skipIf(!c.on)(
    `${c.name} appends batches to the open form`,
    async () => {
      const { home, run } = agent(c.cmd, { ASKU_URL: base, ASKU_SESSION: "t", ASKU_WAIT: "30" });
      const batch = (name: string, ...ids: string[]) => {
        writeFileSync(
          `${home}/${name}.json`,
          JSON.stringify({ questions: ids.map((id) => ({ id, type: "text", label: id })) }),
        );
        return `${home}/${name}.json`;
      };
      const ok = (answers: Record<string, unknown>) => ({ answers, skipped: [], comments: {}, note: "" });

      // queued before the user opens the link; the form's ids and size are checked across batches
      let res = await run(["add", batch("b1", "a")]);
      expect(res.code).toBe(2);
      const link = res.out.match(/https?:\/\/\S+#[0-9a-f]{64}\.[0-9a-f]{32}/)![0];
      expect((await run(["add", batch("b2", "b")])).out).toContain("Queued");
      res = await run(["add", batch("dup", "a")]);
      expect(res.code).toBe(1);
      expect(res.err).toContain("already in the open form");
      expect((await run(["add", batch("big", ...Array.from({ length: 49 }, (_, i) => `x${i}`))])).code).toBe(1);
      expect((await run(["ask", batch("b9", "z")])).code).toBe(1); // a form is open

      // bound: add sends everything queued, one submit answers all of it
      const b = await browser(link);
      res = await run(["add", batch("b3", "c")]);
      expect(res.code).toBe(2);
      expect(res.out).toContain("Sent");
      for (const [seq, id] of [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ] as const)
        expect((await b.question(seq)).questions[0].id).toBe(id);
      await b.answer(3, ok({ a: "1", b: "2", c: "3" }));
      res = await run(["wait"]);
      expect(res.err).toBe("");
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out)).toEqual(ok({ a: "1", b: "2", c: "3" }));

      // the race: the user submits batch 4 just before batch 5 arrives
      await run(["add", batch("b4", "d")]);
      await b.answer(4, ok({ d: "4" }));
      await run(["add", batch("b5", "e")]);
      res = await run(["wait"]);
      expect(JSON.parse(res.out)).toEqual(ok({ d: "4" }));
      expect(res.err).toContain("1 batch(es) still pending");
      await b.answer(5, ok({ e: "5" }));
      res = await run(["wait"]);
      expect(JSON.parse(res.out)).toEqual(ok({ e: "5" }));
      expect(res.err).toBe("");

      // an invalid batch is answered with an error on its own seq, and can land before the earlier batch's answer
      await run(["add", batch("b6", "f")]);
      await run(["add", batch("b7", "g")]);
      const bad = { ...ok({}), error: "invalid question: /questions/0 nope" };
      await b.answer(7, bad);
      res = await run(["wait"]);
      expect(JSON.parse(res.out)).toEqual(bad);
      expect(res.err).toContain("1 batch(es) still pending");
      await b.answer(6, ok({ f: "6" }));
      res = await run(["wait"]);
      expect(JSON.parse(res.out)).toEqual(ok({ f: "6" }));

      // seqs says exactly which batches an answer covers: the user sends batch 9 on its own, batch 8 stays open
      await run(["add", batch("b8", "h")]);
      await run(["add", batch("b9", "i")]);
      await b.answer(9, { seqs: [9], ...ok({ i: "9" }) });
      res = await run(["wait"]);
      expect(JSON.parse(res.out).answers).toEqual({ i: "9" });
      expect(res.err).toContain("1 batch(es) still pending");
      await b.answer(8, { seqs: [8], ...ok({}), skipped: ["h"], note: "no", declined: true });
      res = await run(["wait"]);
      expect(JSON.parse(res.out).declined).toBe(true);
      expect(res.err).toBe("");
      expect((await run(["wait"])).code).toBe(1); // nothing open

      expect((await run(["close"])).code).toBe(0);
    },
    180_000,
  );

  test.skipIf(!c.on)(
    `${c.name} says things and gives up at a deadline`,
    async () => {
      const { home, run } = agent(c.cmd, { ASKU_URL: base, ASKU_SESSION: "t", ASKU_WAIT: "30" });
      const late = `${home}/late.json`;
      writeFileSync(
        late,
        JSON.stringify({ deadline: 2, mood: "nervous", questions: [{ id: "x", type: "confirm", label: "Go?" }] }),
      );
      expect((await run(["say", "hi"])).code).toBe(1); // no session

      // nobody opens the link: wait gives up once the deadline passes
      let res = await run(["ask", late]);
      expect(res.code).toBe(2);
      const link = res.out.match(/https?:\/\/\S+#[0-9a-f]{64}\.[0-9a-f]{32}/)![0];
      expect((await run(["say", "queued"])).out).toContain("Queued");
      res = await run(["wait"]);
      expect(res.code).toBe(0);
      expect(JSON.parse(res.out)).toEqual({
        seqs: [1],
        answers: {},
        skipped: ["x"],
        comments: {},
        note: "",
        timeout: true,
      });

      // bound: says go straight out, text is escaped, and a late batch carries when it was asked
      const b = await browser(link);
      const text = 'Tests "42/50" \\ done\n\t— 日本語';
      res = await run(["say", text]);
      expect(res.out).toContain("Said");
      expect(await b.question(1)).toEqual({ say: "queued" }); // the timed-out batch never went out, so no gap
      expect(await b.question(2)).toEqual({ say: text });
      const before = Math.floor(Date.now() / 1000);
      res = await run(["wait"]);
      expect(res.code).toBe(1); // a say is never answered
      await run(["add", late]);
      const q = await b.question(3);
      expect(q.deadline).toBe(2);
      expect(q.mood).toBe("nervous");
      expect(q.sent).toBeGreaterThanOrEqual(before);
      res = await run(["wait"]);
      expect(JSON.parse(res.out).timeout).toBe(true);
      await b.answer(3, { answers: { x: true }, skipped: [], comments: {}, note: "" }); // too late: nobody is listening
      expect((await run(["wait"])).code).toBe(1);

      expect((await run(["close"])).code).toBe(0);
    },
    120_000,
  );

  test.skipIf(!c.on)(
    `${c.name} rejects a binding without the token`,
    async () => {
      const { home, run } = agent(c.cmd, { ASKU_URL: base, ASKU_WAIT: "5" });
      const link = (await run(["ask", `${home}/q.json`])).out.match(/https?:\/\/\S+#\S+/)![0];
      const b = await browser(link, { badToken: true });
      const res = await run(["wait"]);
      expect(res.code).toBe(1);
      expect(res.err).toContain("without the right token");
      expect((await fetch(`${base}/s/${b.sid}`)).status).toBe(404);
    },
    60_000,
  );

  test.skipIf(!c.on)(
    `${c.name} joins a session the user started`,
    async () => {
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
    },
    120_000,
  );
}
