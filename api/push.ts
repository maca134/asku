// Web Push without a library: a VAPID-signed (RFC 8292), aes128gcm-encrypted (RFC 8291) message to a browser's
// push service. `bun api/push.ts` prints a new VAPID key pair for ASKU_VAPID_PUBLIC / ASKU_VAPID_PRIVATE.

export type Vapid = { publicKey: string; privateKey: string; subject: string };
export type Subscription = { endpoint: string; p256dh: string; auth: string };

const base64url = (bytes: Uint8Array) => bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const fromBase64url = (text: string) => Uint8Array.fromBase64(text, { alphabet: "base64url" });
const encode = (text: string) => new TextEncoder().encode(text);

async function hkdf(salt: BufferSource, secret: BufferSource, info: BufferSource, bytes: number) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

// One record: salt, record size, the sender's ephemeral public key, then the ciphertext.
export async function encrypt({ p256dh, auth }: Subscription, payload: string) {
  const receiverPub = fromBase64url(p256dh);
  const receiver = await crypto.subtle.importKey("raw", receiverPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const sender = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const senderPub = new Uint8Array(await crypto.subtle.exportKey("raw", sender.publicKey));
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: receiver }, sender.privateKey, 256),
  );
  const ikm = await hkdf(
    fromBase64url(auth),
    shared,
    new Uint8Array([...encode("WebPush: info\0"), ...receiverPub, ...senderPub]),
    32,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const padded = new Uint8Array([...encode(payload), 2]); // 2: the last record
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, padded));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPub.length;
  return new Uint8Array([...header, ...senderPub, ...ciphertext]);
}

async function vapidToken({ publicKey, privateKey, subject }: Vapid, endpoint: string) {
  const pub = fromBase64url(publicKey);
  const jwk = { kty: "EC", crv: "P-256", d: privateKey, x: base64url(pub.slice(1, 33)), y: base64url(pub.slice(33)) };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value: unknown) => base64url(encode(JSON.stringify(value)));
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: new URL(endpoint).origin, exp, sub: subject })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(signature))}`;
}

export async function sendPush(vapid: Vapid, subscription: Subscription, payload: string) {
  return fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${await vapidToken(vapid, subscription.endpoint)}, k=${vapid.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: "86400",
      urgency: "high",
    },
    body: await encrypt(subscription, payload),
    redirect: "error",
  });
}

export async function newVapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return { publicKey: base64url(pub), privateKey: d! };
}

if (import.meta.main) {
  const { publicKey, privateKey } = await newVapidKeys();
  console.log(`ASKU_VAPID_PUBLIC=${publicKey}\nASKU_VAPID_PRIVATE=${privateKey}`);
}
