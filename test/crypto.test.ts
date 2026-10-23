// Every implementation must reproduce vectors.json (generated independently by gen-vectors.ts).
import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bindTag, checkBind, checkFragment, deriveKeys, open, seal, type Envelope } from "../shared/crypto";
import v from "./vectors.json";

const b = (s: string) => Uint8Array.fromBase64(s);
const flip = (s: string) => {
  const x = b(s);
  x[0] ^= 1;
  return x.toBase64();
};
const envelope = ({ pt, ...env }: (typeof v.messages)[number]) => env as Envelope;
const utf8 = (s: string) => Buffer.from(s, "utf8").toString("base64");

test("webcrypto (shared/crypto.ts), browser side", async () => {
  const p = b(v.pubB);
  const u = (x: Uint8Array) => x.toBase64({ alphabet: "base64url", omitPadding: true });
  const jwk = { kty: "EC", crv: "P-256", d: u(Uint8Array.fromHex(v.privB)), x: u(p.slice(1, 33)), y: u(p.slice(33)) };
  const priv = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const keys = await deriveKeys(priv, b(v.pubA));

  expect((await checkFragment(v.fragment, b(v.pubA))).toHex()).toBe(v.token);
  await expect(checkFragment(v.fragment, b(v.pubB))).rejects.toThrow();
  expect(await bindTag(Uint8Array.fromHex(v.token), b(v.pubB))).toBe(v.bind);
  // browser-created session: the browser checks the agent's binding
  expect((await checkFragment(v.reverse.fragment, b(v.pubB))).toHex()).toBe(v.token);
  expect(await checkBind(Uint8Array.fromHex(v.token), b(v.pubA), v.reverse.bind)).toBe(true);
  expect(await checkBind(Uint8Array.fromHex(v.token), b(v.pubA), flip(v.reverse.bind))).toBe(false);

  for (const m of v.messages) {
    const env = envelope(m);
    const other = m.dir === "q" ? "a" : "q";
    expect(await seal(keys, v.sid, m.dir as "q", m.seq, m.pt, b(m.iv))).toEqual(env);
    expect(await open(keys, v.sid, env.dir, m.seq, env)).toBe(m.pt);
    await expect(open(keys, v.sid, env.dir, m.seq, { ...env, tag: flip(env.tag) })).rejects.toThrow();
    await expect(open(keys, v.sid, other, m.seq, env)).rejects.toThrow(); // reflection
    await expect(open(keys, v.sid, env.dir, m.seq + 1, env)).rejects.toThrow(); // replay
  }
}, 60_000);

test("openssl (skill/ask.sh), agent side", () => {
  const sh = (args: string[], stdin?: string) => {
    const r = Bun.spawnSync([process.env.ASKU_BASH ?? "bash", "-c", '. skill/ask.sh && "$@"', "_", ...args], {
      stdin: stdin === undefined ? "ignore" : Buffer.from(stdin, "utf8"),
    });
    return { ok: r.exitCode === 0, out: r.stdout.toString("utf8"), err: r.stderr.toString() };
  };
  // PKCS#8 DER for a bare P-256 private scalar
  const der = Buffer.from("3041020100301306072a8648ce3d020106082a8648ce3d030107042730250201010420" + v.privA, "hex");
  const pem = join(mkdtempSync(join(tmpdir(), "asku-")), "a.pem");
  writeFileSync(
    pem,
    `-----BEGIN PRIVATE KEY-----\n${der
      .toString("base64")
      .match(/.{1,64}/g)!
      .join("\n")}\n-----END PRIVATE KEY-----\n`,
  );

  const K = sh(["derive", pem, v.pubB]);
  expect(K.err).toBe("");
  expect(K.out).toBe(v.K);
  expect(sh(["fragment", v.pubA, v.token]).out).toBe(v.fragment);
  expect(sh(["bindok", v.token, v.pubB, v.bind]).ok).toBe(true);
  expect(sh(["bindok", v.token, v.pubB, flip(v.bind)]).ok).toBe(false);
  expect(sh(["fragment", v.pubB, v.token]).out).toBe(v.reverse.fragment);
  expect(sh(["bindmac", v.token, v.pubA]).out).toBe(v.reverse.bind);

  for (const m of v.messages) {
    const sealed = sh(["seal", v.K, v.sid, m.dir, `${m.seq}`, b(m.iv).toHex()], m.pt);
    expect(JSON.parse(sealed.out)).toEqual(envelope(m));
    expect(sh(["open", v.K, v.sid, m.dir, `${m.seq}`, m.iv, m.ct, m.tag]).out).toBe(m.pt);
    expect(sh(["open", v.K, v.sid, m.dir, `${m.seq}`, m.iv, m.ct, flip(m.tag)]).ok).toBe(false);
  }
}, 60_000);

test.skipIf(process.platform !== "win32")(
  "powershell 5.1 (skill/ask.ps1), agent side",
  () => {
    const r = Bun.spawnSync([
      "powershell.exe",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "test/ps-driver.ps1",
      "test/vectors.json",
    ]);
    expect(r.stderr.toString()).toBe("");
    const o = JSON.parse(r.stdout.toString());
    expect([o.K, o.kEnc, o.kMac]).toEqual([v.K, v.kEnc, v.kMac]);
    expect(o.fragment).toBe(v.fragment);
    expect([o.bindOk, o.badBindOk]).toEqual([true, false]);
    expect([o.reverseFragment, o.reverseBind]).toEqual([v.reverse.fragment, v.reverse.bind]);
    v.messages.forEach((m, i) => {
      expect(o.messages[i]).toEqual({ sealed: envelope(m), opened: utf8(m.pt), rejected: true });
    });
  },
  60_000,
);
