// Generates test/vectors.json with node:crypto, independent of every implementation under test.
// bun run vectors
import { createCipheriv, createECDH, createHash, createHmac } from "node:crypto";
import question from "../examples/question.json";

const sha = (s: string | Buffer) => createHash("sha256").update(s).digest();
const hmac = (k: Buffer, m: string | Buffer) => createHmac("sha256", k).update(m).digest();
const party = (label: string) => {
  const e = createECDH("prime256v1");
  e.setPrivateKey(sha(label));
  return e;
};

const A = party("asku vector A"); // agent
const B = party("asku vector B"); // browser
const sid = "vSid0123456789ab";
const token = sha("asku vector T").subarray(0, 16);
const Z = A.computeSecret(B.getPublicKey());
const K = sha(Z);
const kEnc = hmac(K, "enc");
const kMac = hmac(K, "mac");

const plaintexts: ["q" | "a", number, string][] = [
  ["q", 1, JSON.stringify(question)],
  ["a", 1, JSON.stringify({ answers: { go: true }, skipped: [], comments: {}, note: "héllo — 日本語 🚀" })],
  ["q", 2, "0123456789abcdef0123456789abcdef"], // exact block multiple: full padding block
  ["a", 2, "x"],
];

const messages = plaintexts.map(([dir, seq, pt], i) => {
  const iv = sha(`asku vector iv ${i}`).subarray(0, 16);
  const c = createCipheriv("aes-256-cbc", kEnc, iv);
  const ct = Buffer.concat([c.update(pt, "utf8"), c.final()]);
  const tag = hmac(kMac, Buffer.concat([Buffer.from(`v1|${sid}|${dir}|${seq}|`), iv, ct]));
  return { v: 1, seq, dir, iv: iv.toString("base64"), ct: ct.toString("base64"), tag: tag.toString("base64"), pt };
});

const hex = (b: Buffer) => b.toString("hex");
const b64 = (b: Buffer) => b.toString("base64");
console.log(
  JSON.stringify(
    {
      sid,
      privA: hex(A.getPrivateKey()),
      pubA: b64(A.getPublicKey()),
      privB: hex(B.getPrivateKey()),
      pubB: b64(B.getPublicKey()),
      token: hex(token),
      fragment: `${hex(sha(A.getPublicKey()))}.${hex(token)}`,
      bind: b64(hmac(token, B.getPublicKey())),
      // browser-created session: the browser (B) shares the link, the agent (A) joins
      reverse: { fragment: `${hex(sha(B.getPublicKey()))}.${hex(token)}`, bind: b64(hmac(token, A.getPublicKey())) },
      Z: hex(Z),
      K: hex(K),
      kEnc: hex(kEnc),
      kMac: hex(kMac),
      messages,
    },
    null,
    2,
  ),
);
