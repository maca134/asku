// Wire crypto, see README "Crypto". WebCrypto only: runs in browsers and Bun.
const te = new TextEncoder();
const td = new TextDecoder("utf-8", { fatal: true });
const subtle = crypto.subtle;

export type Dir = "q" | "a";
export type Envelope = { v: 1; seq: number; dir: Dir; iv: string; ct: string; tag: string };
export type Keys = { enc: CryptoKey; mac: CryptoKey };

const hmacKey = (raw: BufferSource, usages: KeyUsage[]) =>
  subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usages);
const hmac = async (key: BufferSource, msg: BufferSource) =>
  new Uint8Array(await subtle.sign("HMAC", await hmacKey(key, ["sign"]), msg));
const sha256 = async (b: BufferSource) => new Uint8Array(await subtle.digest("SHA-256", b));

function tagInput(sid: string, dir: Dir, seq: number, iv: Uint8Array, ct: Uint8Array) {
  const head = te.encode(`v1|${sid}|${dir}|${seq}|`);
  const out = new Uint8Array(head.length + iv.length + ct.length);
  out.set(head);
  out.set(iv, head.length);
  out.set(ct, head.length + iv.length);
  return out;
}

// Non-extractable private key; the public key as the raw 65-byte point.
export async function newKeyPair() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { priv: kp.privateKey, pub: new Uint8Array(await subtle.exportKey("raw", kp.publicKey)) };
}

export async function deriveKeys(priv: CryptoKey, peerPub: Uint8Array): Promise<Keys> {
  const pub = await subtle.importKey("raw", peerPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const k = await sha256(await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  return {
    enc: await subtle.importKey("raw", await hmac(k, te.encode("enc")), "AES-CBC", false, ["encrypt", "decrypt"]),
    mac: await hmacKey(await hmac(k, te.encode("mac")), ["sign", "verify"]),
  };
}

export async function seal(keys: Keys, sid: string, dir: Dir, seq: number, pt: string,
  iv = crypto.getRandomValues(new Uint8Array(16))): Promise<Envelope> {
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, keys.enc, te.encode(pt)));
  const tag = new Uint8Array(await subtle.sign("HMAC", keys.mac, tagInput(sid, dir, seq, iv, ct)));
  return { v: 1, seq, dir, iv: iv.toBase64(), ct: ct.toBase64(), tag: tag.toBase64() };
}

// dir and seq are what the caller expects, never read from env: a replayed or reflected envelope fails the tag.
export async function open(keys: Keys, sid: string, dir: Dir, seq: number, env: Envelope): Promise<string> {
  const iv = Uint8Array.fromBase64(env.iv);
  const ct = Uint8Array.fromBase64(env.ct);
  const ok = env.v === 1 && await subtle.verify("HMAC", keys.mac, Uint8Array.fromBase64(env.tag), tagInput(sid, dir, seq, iv, ct));
  if (!ok) throw new Error("asku: bad tag");
  return td.decode(await subtle.decrypt({ name: "AES-CBC", iv }, keys.enc, ct));
}

// "<sha256(pub) hex>.<T hex>": the URL fragment the session creator hands out.
export const fragmentFor = async (pub: Uint8Array, token: Uint8Array) => `${(await sha256(pub)).toHex()}.${token.toHex()}`;

// Joiner side of the trust flow: check the creator's pub against the URL fragment, return the token T.
export async function checkFragment(fragment: string, pubA: Uint8Array): Promise<Uint8Array> {
  const [hash, token] = fragment.split(".");
  if (hash !== (await sha256(pubA)).toHex() || !/^[0-9a-f]{32}$/.test(token ?? "")) throw new Error("asku: bad fragment");
  return Uint8Array.fromHex(token);
}

// HMAC(T, joiner's pub): the browser's in an agent-created session, the agent's in a browser-created one.
export const bindTag = async (token: Uint8Array, pub: Uint8Array) => (await hmac(token, pub)).toBase64();
export const checkBind = async (token: Uint8Array, pub: Uint8Array, mac: string) =>
  subtle.verify("HMAC", await hmacKey(token, ["verify"]), Uint8Array.fromBase64(mac), pub);
