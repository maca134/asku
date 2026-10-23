import { afterAll, expect, test } from "bun:test";
import https from "node:https";
import { relay } from "../api/relay";
import v from "./vectors.json";

const started: { stop(): void }[] = [];
afterAll(() => {
  for (const server of started) server.stop();
});

function start(options: Parameters<typeof relay>[0] = {}) {
  const instance = relay({ holdMs: 300, ...options });
  started.push(instance);
  const base = instance.server.url.href.replace(/\/$/, "");
  const call = (method: string, path: string, body?: unknown, key?: string) =>
    fetch(base + path, {
      method,
      headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const session = async () => {
    const { sid, key } = await (await call("POST", "/s", { pub: v.pubA })).json();
    const { key: browserKey } = await (await call("POST", `/s/${sid}/bind`, { pub: v.pubB, mac: v.bind })).json();
    return { sid: sid as string, agentKey: key as string, browserKey: browserKey as string };
  };
  return { call, session };
}

const question = (seq: number) => {
  const { pt, ...envelope } = v.messages.find((message) => message.dir === "q")!;
  return { ...envelope, seq };
};

test("without VAPID keys push is off, and nothing else changes", async () => {
  const { call, session } = start();
  const { sid, browserKey } = await session();
  expect(await (await call("GET", `/s/${sid}`)).json()).toEqual({ pub: v.pubA, role: "agent", bound: true });
  const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: "x", auth: "x" } };
  expect((await call("PUT", `/s/${sid}/push`, subscription, browserKey)).status).toBe(404);
});

const base64url = (bytes: Uint8Array) => bytes.toBase64({ alphabet: "base64url", omitPadding: true });
const fromBase64url = (text: string) => Uint8Array.fromBase64(text, { alphabet: "base64url" });
const encode = (text: string) => new TextEncoder().encode(text);

// web-push only speaks https, so the fake push service has a self-signed localhost certificate the relay trusts.
const tls = {
  cert: Bun.file(`${import.meta.dir}/push-service.crt`),
  key: Bun.file(`${import.meta.dir}/push-service.key`),
};
https.globalAgent.options.ca = await tls.cert.text();

// A browser's side of a push subscription, and a push service that hands each delivery to the test.
async function pushService(status = 201) {
  const receiver = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const receiverPub = new Uint8Array(await crypto.subtle.exportKey("raw", receiver.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const deliveries: Request[] = [];
  const waiting: ((req: Request) => void)[] = [];
  const server = Bun.serve({
    port: 0,
    tls,
    async fetch(req) {
      const copy = new Request(req.url, { method: req.method, headers: req.headers, body: await req.arrayBuffer() });
      const next = waiting.shift();
      if (next) next(copy);
      else deliveries.push(copy);
      return new Response(null, { status });
    },
  });
  started.push({ stop: () => server.stop(true) });
  const next = () =>
    new Promise<Request>((resolve) => {
      const ready = deliveries.shift();
      if (ready) resolve(ready);
      else waiting.push(resolve);
    });
  const subscription = {
    endpoint: `${server.url.href}push/abc`,
    expirationTime: null,
    keys: { p256dh: base64url(receiverPub), auth: base64url(auth) },
  };

  // RFC 8291, receiving side
  async function decrypt(body: Uint8Array) {
    const salt = body.slice(0, 16);
    const senderPub = body.slice(21, 21 + body[20]);
    const sender = await crypto.subtle.importKey("raw", senderPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
    const shared = await crypto.subtle.deriveBits({ name: "ECDH", public: sender }, receiver.privateKey, 256);
    const derive = async (salt: BufferSource, secret: BufferSource, info: BufferSource, bytes: number) => {
      const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
      return crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8);
    };
    const info = new Uint8Array([...encode("WebPush: info\0"), ...receiverPub, ...senderPub]);
    const ikm = await derive(auth, shared, info, 32);
    const cek = await derive(salt, ikm, encode("Content-Encoding: aes128gcm\0"), 16);
    const nonce = await derive(salt, ikm, encode("Content-Encoding: nonce\0"), 12);
    const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
    const ciphertext = body.slice(21 + body[20]);
    const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, ciphertext));
    expect(plain.at(-1)).toBe(2);
    return new TextDecoder().decode(plain.slice(0, -1));
  }
  return { subscription, next, pending: () => deliveries.length, decrypt, origin: server.url.origin };
}

async function vapidKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = base64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
  const privateKey = (await crypto.subtle.exportKey("jwk", pair.privateKey)).d!;
  return { vapid: { publicKey, privateKey, subject: "mailto:ops@example.com" }, verifier: pair.publicKey };
}

const local = /^https:\/\/localhost:\d+\//;

test("a new question pushes only its sid and seq, signed with the relay's VAPID key", async () => {
  const { vapid, verifier } = await vapidKeys();
  const { call, session } = start({ vapid, pushServices: local });
  const service = await pushService();
  const { sid, agentKey, browserKey } = await session();
  expect((await (await call("GET", `/s/${sid}`)).json()).push).toBe(vapid.publicKey);
  expect((await call("PUT", `/s/${sid}/push`, service.subscription, browserKey)).status).toBe(204);

  expect((await call("POST", `/s/${sid}/q`, question(1), agentKey)).status).toBe(204);
  const delivery = await service.next();
  expect(delivery.headers.get("content-encoding")).toBe("aes128gcm");
  expect(JSON.parse(await service.decrypt(new Uint8Array(await delivery.arrayBuffer())))).toEqual({ sid, seq: 1 });

  const [, token, key] = delivery.headers.get("authorization")!.match(/^vapid t=([\w.-]+), k=([\w-]+)$/)!;
  expect(key).toBe(vapid.publicKey);
  const [header, claims, signature] = token.split(".");
  const signed = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    verifier,
    fromBase64url(signature),
    encode(`${header}.${claims}`),
  );
  expect(signed).toBe(true);
  const { aud, sub, exp } = JSON.parse(new TextDecoder().decode(fromBase64url(claims)));
  expect([aud, sub]).toEqual([service.origin, vapid.subject]);
  expect(exp * 1000).toBeGreaterThan(Date.now());
});

test("only the browser turns push on or off, and only towards a push service", async () => {
  const { vapid } = await vapidKeys();
  const { call, session } = start({ vapid });
  const { sid, agentKey, browserKey } = await session();
  const subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    keys: { p256dh: base64url(Uint8Array.fromBase64(v.pubB)), auth: base64url(new Uint8Array(16)) },
  };
  expect((await call("PUT", `/s/${sid}/push`, subscription)).status).toBe(401);
  expect((await call("PUT", `/s/${sid}/push`, subscription, agentKey)).status).toBe(401);
  expect((await call("DELETE", `/s/${sid}/push`, undefined, agentKey)).status).toBe(401);
  for (const endpoint of [
    "http://fcm.googleapis.com/x",
    "https://169.254.169.254/x",
    "https://fcm.googleapis.com.evil/x",
  ])
    expect((await call("PUT", `/s/${sid}/push`, { ...subscription, endpoint }, browserKey)).status).toBe(400);
  const shortAuth = { ...subscription, keys: { ...subscription.keys, auth: "AAAA" } };
  expect((await call("PUT", `/s/${sid}/push`, shortAuth, browserKey)).status).toBe(400);
  expect((await call("PUT", `/s/${sid}/push`, subscription, browserKey)).status).toBe(204);
  expect((await call("DELETE", `/s/${sid}/push`, undefined, browserKey)).status).toBe(204);
});

test("no more pushes once turned off, or once the push service says the browser left", async () => {
  const { vapid } = await vapidKeys();
  const { call, session } = start({ vapid, pushServices: local });
  const off = await session();
  const service = await pushService();
  await call("PUT", `/s/${off.sid}/push`, service.subscription, off.browserKey);
  await call("DELETE", `/s/${off.sid}/push`, undefined, off.browserKey);
  await call("POST", `/s/${off.sid}/q`, question(1), off.agentKey);

  const gone = await session();
  const leaving = await pushService(410);
  await call("PUT", `/s/${gone.sid}/push`, leaving.subscription, gone.browserKey);
  await call("POST", `/s/${gone.sid}/q`, question(1), gone.agentKey);
  await leaving.next();
  await Bun.sleep(50);
  await call("POST", `/s/${gone.sid}/q`, question(2), gone.agentKey);
  await Bun.sleep(100);
  expect([service.pending(), leaving.pending()]).toEqual([0, 0]);
});
