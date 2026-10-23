// Wire crypto, see README "Crypto". WebCrypto only: runs in browsers and Bun.
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const subtle = crypto.subtle;

export type Direction = "q" | "a";
export type Envelope = { v: 1; seq: number; dir: Direction; iv: string; ct: string; tag: string };
export type Keys = { enc: CryptoKey; mac: CryptoKey };
export type Bytes = Uint8Array<ArrayBuffer>;

const hmacKey = (raw: BufferSource, usages: KeyUsage[]) =>
  subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, usages);
const hmac = async (key: BufferSource, message: BufferSource) =>
  new Uint8Array(await subtle.sign("HMAC", await hmacKey(key, ["sign"]), message));
const sha256 = async (data: BufferSource) => new Uint8Array(await subtle.digest("SHA-256", data));

// "v1|sid|dir|seq|" then the raw IV and ciphertext
function tagInput(sid: string, dir: Direction, seq: number, iv: Bytes, ciphertext: Bytes) {
  const header = encoder.encode(`v1|${sid}|${dir}|${seq}|`);
  const input = new Uint8Array(header.length + iv.length + ciphertext.length);
  input.set(header);
  input.set(iv, header.length);
  input.set(ciphertext, header.length + iv.length);
  return input;
}

// Non-extractable private key; the public key as the raw 65-byte point.
export async function newKeyPair() {
  const keyPair = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  return { priv: keyPair.privateKey, pub: new Uint8Array(await subtle.exportKey("raw", keyPair.publicKey)) };
}

export async function deriveKeys(priv: CryptoKey, peerPub: Bytes): Promise<Keys> {
  const pub = await subtle.importKey("raw", peerPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await sha256(await subtle.deriveBits({ name: "ECDH", public: pub }, priv, 256));
  return {
    enc: await subtle.importKey("raw", await hmac(shared, encoder.encode("enc")), "AES-CBC", false, [
      "encrypt",
      "decrypt",
    ]),
    mac: await hmacKey(await hmac(shared, encoder.encode("mac")), ["sign", "verify"]),
  };
}

export async function seal(
  keys: Keys,
  sid: string,
  dir: Direction,
  seq: number,
  plaintext: string,
  iv = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Envelope> {
  const ciphertext = new Uint8Array(await subtle.encrypt({ name: "AES-CBC", iv }, keys.enc, encoder.encode(plaintext)));
  const tag = new Uint8Array(await subtle.sign("HMAC", keys.mac, tagInput(sid, dir, seq, iv, ciphertext)));
  return { v: 1, seq, dir, iv: iv.toBase64(), ct: ciphertext.toBase64(), tag: tag.toBase64() };
}

// dir and seq are what the caller expects, never read from the envelope: a replayed or reflected one fails the tag.
export async function open(keys: Keys, sid: string, dir: Direction, seq: number, envelope: Envelope): Promise<string> {
  const iv = Uint8Array.fromBase64(envelope.iv);
  const ciphertext = Uint8Array.fromBase64(envelope.ct);
  const tag = Uint8Array.fromBase64(envelope.tag);
  const ok = envelope.v === 1 && (await subtle.verify("HMAC", keys.mac, tag, tagInput(sid, dir, seq, iv, ciphertext)));
  if (!ok) throw new Error("asku: bad tag");
  return decoder.decode(await subtle.decrypt({ name: "AES-CBC", iv }, keys.enc, ciphertext));
}

// "<sha256(pub) hex>.<token hex>": the URL fragment the session creator hands out.
export const fragmentFor = async (pub: Bytes, token: Bytes) => `${(await sha256(pub)).toHex()}.${token.toHex()}`;

// Joiner side of the trust flow: check the creator's pub against the URL fragment, return the token.
export async function checkFragment(fragment: string, creatorPub: Bytes): Promise<Bytes> {
  const [pubHash, token] = fragment.split(".");
  if (pubHash !== (await sha256(creatorPub)).toHex() || !/^[0-9a-f]{32}$/.test(token ?? ""))
    throw new Error("asku: bad fragment");
  return Uint8Array.fromHex(token);
}

// HMAC(token, joiner's pub): the browser's in an agent-created session, the agent's in a browser-created one.
export const bindTag = async (token: Bytes, pub: Bytes) => (await hmac(token, pub)).toBase64();
export const checkBind = async (token: Bytes, pub: Bytes, mac: string) =>
  subtle.verify("HMAC", await hmacKey(token, ["verify"]), Uint8Array.fromBase64(mac), pub);
