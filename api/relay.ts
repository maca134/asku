// asku relay: stores opaque envelopes, never sees plaintext. API in README "Relay API".
import type { Server } from "bun";
import type { Direction } from "../shared/crypto";
import { type Subscription, sendPush, type Vapid } from "./push";
import { openStore, type Session } from "./store";

export const LIMITS = {
  body: 256 * 1024,
  sessionBytes: 8 << 20,
  maxSeq: 1000,
  ttlMs: 24 * 3600_000,
  createPerIp: 20,
  createWindowMs: 10 * 60_000,
  sessions: 10_000, // relay-wide caps, so no number of clients can fill the disk
  totalBytes: 1 << 30,
  listeners: 8, // open feeds and long-polls per session
};

const HEADERS = {
  "content-security-policy":
    "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
};

type Body = Record<string, unknown>;

const sha256Hex = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");
const randomId = (bytes: number) =>
  crypto.getRandomValues(new Uint8Array(bytes)).toBase64({ alphabet: "base64url", omitPadding: true });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);
const empty = (status = 204) => new Response(null, { status });
const envelopes = (rows: { envelope: string }[]) =>
  new Response(`[${rows.map((row) => row.envelope).join(",")}]`, { headers: { "content-type": "application/json" } });

type Alphabet = "base64" | "base64url";
const ALPHABETS = { base64: /^[A-Za-z0-9+/]+={0,2}$/, base64url: /^[\w-]+$/ };

function decodeBase64(value: unknown, length?: number, alphabet: Alphabet = "base64") {
  if (typeof value !== "string" || !ALPHABETS[alphabet].test(value)) return null;
  try {
    const bytes = Uint8Array.fromBase64(value, { alphabet });
    return length === undefined || bytes.length === length ? bytes : null;
  } catch {
    return null;
  }
}
const isBase64 = (value: unknown, length?: number, alphabet?: Alphabet): value is string =>
  decodeBase64(value, length, alphabet) !== null;
const isPublicKey = (value: unknown, alphabet?: Alphabet): value is string =>
  decodeBase64(value, 65, alphabet)?.[0] === 4;

// Only the big browsers' push services: the endpoint comes from the browser, so it mustn't aim the relay elsewhere.
export const PUSH_SERVICES =
  /^https:\/\/([\w-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)\//;

function validSubscription(body: Body | null, services: RegExp): Subscription | null {
  const endpoint = body?.endpoint;
  const keys = body?.keys as Body | undefined;
  if (typeof endpoint !== "string" || endpoint.length > 1024 || !services.test(endpoint)) return null;
  const { p256dh, auth } = keys ?? {};
  if (!isPublicKey(p256dh, "base64url") || !isBase64(auth, 16, "base64url")) return null;
  return { endpoint, p256dh, auth };
}

// IPv6 clients usually get a whole /64, so it shares one rate-limit quota.
export function ipKey(ip: string) {
  if (!ip.includes(":") || ip.startsWith("::ffff:")) return ip;
  const [head, tail] = ip.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = tail === undefined ? left : [...left, ...Array(8 - left.length - right.length).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((group) => parseInt(group, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

// The envelope re-serialised with only its known fields, or null if it isn't one.
function validEnvelope(body: Body | null, direction: Direction) {
  if (!body || Object.keys(body).length !== 6) return null;
  const { v, seq, dir, iv, ct, tag } = body;
  const ciphertext = decodeBase64(ct);
  const ok =
    v === 1 &&
    dir === direction &&
    typeof seq === "number" &&
    Number.isInteger(seq) &&
    seq >= 0 &&
    seq <= LIMITS.maxSeq &&
    isBase64(iv, 16) &&
    ciphertext !== null &&
    ciphertext.length % 16 === 0 &&
    isBase64(tag, 32);
  return ok ? { seq, json: JSON.stringify({ v, seq, dir, iv, ct, tag }) } : null;
}

async function readJson(req: Request): Promise<Body | null> {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return null; // forces a CORS preflight
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" ? body : null;
}

const STATIC = /^\/(robots\.txt|sitemap\.xml|og\.png|favicon\.(svg|ico)|apple-touch-icon\.png)$/;
// The skill: SKILL.md, the agent scripts and the schema, as plain text so curl and browsers both just show them.
const SKILL = /^\/(skill\.md|ask\.sh|ask\.ps1|schema\.json)$/;

export function relay({
  port = 0,
  hostname,
  db: path = ":memory:",
  dist = `${import.meta.dir}/../dist`,
  holdMs = 25_000,
  ipHeader,
  vapid,
  pushServices = PUSH_SERVICES,
}: {
  port?: number;
  hostname?: string;
  db?: string;
  dist?: string;
  holdMs?: number;
  ipHeader?: string;
  vapid?: Vapid;
  pushServices?: RegExp;
} = {}) {
  const { db, sql, purge, store } = openStore(path);

  // ponytail: in-process wakeups, single instance only; pub/sub (e.g. Redis) if this ever scales out.
  const listeners = new Map<string, Set<() => void>>();
  const subscribe = (sid: string, wake: () => void) => {
    let set = listeners.get(sid);
    if (!set) {
      set = new Set();
      listeners.set(sid, set);
    }
    set.add(wake);
    return () => {
      set.delete(wake);
      if (!set.size) listeners.delete(sid);
    };
  };
  const notify = (sid: string) => {
    for (const wake of listeners.get(sid) ?? []) wake();
  };

  // Answers as soon as check() returns a Response, else 204 after holdMs.
  async function longPoll(sid: string, check: () => Response | undefined) {
    const end = Date.now() + holdMs;
    for (;;) {
      const res = check();
      if (res) return res;
      const left = end - Date.now();
      if (left <= 0) return empty();
      await new Promise<void>((done) => {
        const timer = setTimeout(finish, left);
        const unsubscribe = subscribe(sid, finish);
        function finish() {
          clearTimeout(timer);
          unsubscribe();
          done();
        }
      });
    }
  }

  // The browser's feed of questions, as server-sent events. Resumes from Last-Event-ID or ?after.
  function questionFeed(req: Request, server: Server<undefined>, sid: string, after: number) {
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(controller) {
        const write = (text: string) => controller.enqueue(encoder.encode(text));
        const flush = () => {
          if (!sql.session.get(sid)) {
            write("event: close\ndata:\n\n");
            cleanup();
            return controller.close();
          }
          for (const message of sql.after.all(sid, "q", after)) {
            write(`id: ${message.seq}\nevent: q\ndata: ${message.envelope}\n\n`);
            after = message.seq;
          }
        };
        const unsubscribe = subscribe(sid, flush);
        const ping = setInterval(() => write(": ping\n\n"), 20_000);
        cleanup = () => {
          clearInterval(ping);
          unsubscribe();
        };
        flush();
      },
      cancel: () => cleanup(),
    });
    server.timeout(req, 0);
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  const recentCreates = new Map<string, number[]>();
  function rateLimited(ip: string) {
    const now = Date.now();
    const times = (recentCreates.get(ip) ?? []).filter((time) => now - time < LIMITS.createWindowMs);
    recentCreates.set(ip, times);
    if (times.length >= LIMITS.createPerIp) return true; // rejected attempts aren't recorded, so the list stays bounded
    times.push(now);
    return false;
  }

  // Built frontend (bun run build). Paths are matched by strict regexes before reaching here.
  async function serveFile(path: string, cache: string, type?: string, status = 200) {
    const file = Bun.file(`${dist}/${path}`);
    if (!(await file.exists())) return fail(404, "not found");
    return new Response(file, { status, headers: { "cache-control": cache, ...(type && { "content-type": type }) } });
  }

  async function staticFile(pathname: string) {
    const page = pathname.match(/^\/(how|security|demo|install|start|sessions|terms)?$/);
    if (page) return serveFile(`${page[1] ?? "index"}.html`, "no-store");
    if (/^\/[aj]\/[\w-]{22}$/.test(pathname)) {
      const res = await serveFile("app.html", "no-store");
      res.headers.set("x-robots-tag", "noindex");
      return res;
    }
    const asset = pathname.match(/^\/assets\/([\w-]+\.(?:js|css))$/);
    if (asset) return serveFile(`assets/${asset[1]}`, "public, max-age=31536000, immutable");
    const file = pathname.slice(1);
    if (SKILL.test(pathname))
      return serveFile(file, "no-cache", file.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8");
    if (pathname === "/sw.js") return serveFile(file, "no-cache", "text/javascript; charset=utf-8");
    if (pathname === "/manifest.webmanifest")
      return serveFile(file, "public, max-age=86400", "application/manifest+json");
    if (STATIC.test(pathname)) return serveFile(file, "public, max-age=86400");
  }

  // Sessions on the relay (each idle under 24h), floored to tens and fixed for a minute,
  // so the front page can't show the moment one person starts or ends a session.
  // ponytail: someone who also makes sessions can pin the count at a boundary and still see one change; round coarser or update hourly if that matters.
  let stats = { at: 0, live: 0 };
  function liveCount() {
    if (Date.now() - stats.at >= 60_000)
      stats = { at: Date.now(), live: Math.floor(sql.totals.get()!.sessions / 10) * 10 };
    return new Response(JSON.stringify({ live: stats.live }), {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
    });
  }

  const authorized = (req: Request, keyHash: string | null) =>
    keyHash !== null && sha256Hex(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "") === keyHash;

  async function createSession(req: Request, server: Server<undefined>) {
    const ip = (ipHeader ? req.headers.get(ipHeader) : server.requestIP(req)?.address) ?? "?";
    if (rateLimited(ipKey(ip))) return fail(429, "too many sessions");
    const body = await readJson(req);
    const role = body?.role ?? "agent";
    const pub = body?.pub;
    if (!isPublicKey(pub) || (role !== "agent" && role !== "browser")) return fail(400, "bad pub or role");
    if (sql.totals.get()!.sessions >= LIMITS.sessions) return fail(503, "relay full");
    const sid = randomId(16);
    const key = randomId(32);
    const keyHash = sha256Hex(key);
    sql.create.run(sid, role, pub, role === "agent" ? keyHash : null, role === "browser" ? keyHash : null, Date.now());
    return json({ sid, key }, 201);
  }

  async function bind(req: Request, sid: string) {
    const body = await readJson(req);
    const pub = body?.pub;
    const mac = body?.mac;
    if (!isPublicKey(pub) || !isBase64(mac, 32)) return fail(400, "bad binding");
    const key = randomId(32);
    if (sql.bind.run(pub, mac, sha256Hex(key), sid).changes === 0) return fail(409, "already bound");
    notify(sid);
    return json({ key }, 201);
  }

  // q, m: the next in order. a: answers a stored question; seq 0 is the opening note of a browser-made session.
  function inOrder(session: Session, direction: Direction, seq: number) {
    if (direction !== "a") return seq === (sql.lastSeq.get(session.sid, direction)?.seq ?? 0) + 1;
    if (seq === 0) return session.role === "browser";
    return sql.has.get(session.sid, "q", seq) !== null;
  }

  async function post(req: Request, before: Session, direction: Direction, push: boolean) {
    const { sid } = before;
    const keyHash = direction === "q" ? before.agentKeyHash : before.browserKeyHash;
    if (!authorized(req, keyHash)) return fail(401, "unauthorized");
    const envelope = validEnvelope(await readJson(req), direction);
    if (!envelope) return fail(400, "bad envelope");
    // Re-read after the body: the session may have been deleted or grown meanwhile. No await from here to store().
    const session = sql.session.get(sid);
    if (!session) return fail(404, "no such session");
    const { seq } = envelope;
    // "duplicate": that seq is already stored, so a retry can count as sent; "bad seq" is a real conflict
    if (sql.has.get(sid, direction, seq)) return fail(409, "duplicate");
    if (!inOrder(session, direction, seq)) return fail(409, "bad seq");
    const size = envelope.json.length;
    if (session.bytes + size > LIMITS.sessionBytes) return fail(413, "session full");
    if (sql.totals.get()!.bytes + size > LIMITS.totalBytes) return fail(503, "relay full");
    store(sid, direction, seq, envelope.json);
    notify(sid);
    if (direction === "q" && push) pushQuestion(session, seq);
    return empty();
  }

  async function setPush(req: Request, session: Session) {
    if (!authorized(req, session.browserKeyHash)) return fail(401, "unauthorized");
    if (req.method === "DELETE") {
      sql.setPush.run(null, session.sid);
      return empty();
    }
    const subscription = validSubscription(await readJson(req), pushServices);
    if (!subscription) return fail(400, "bad subscription");
    sql.setPush.run(JSON.stringify(subscription), session.sid);
    return empty();
  }

  // The push carries only the sid and seq, which the relay already knows; the browser fetches and opens the batch.
  function pushQuestion({ sid, push }: Session, seq: number) {
    if (!vapid || !push) return;
    sendPush(vapid, JSON.parse(push), JSON.stringify({ sid, seq }))
      .then((status) => {
        if (status === 404 || status === 410) sql.setPush.run(null, sid); // the browser unsubscribed
      })
      .catch(console.error);
  }

  async function sessionRoute(req: Request, server: Server<undefined>, url: URL, sid: string, action: string) {
    const session = sql.session.get(sid);
    if (!session) return fail(404, "no such session");
    const after = Number(url.searchParams.get("after") ?? 0) || 0;
    if (req.method === "GET" && action && (listeners.get(sid)?.size ?? 0) >= LIMITS.listeners)
      return fail(429, "too many listeners");

    switch (`${req.method} ${action}`) {
      case "GET ":
        return json({
          pub: session.creatorPub,
          role: session.role,
          bound: session.joinerPub !== null,
          ...(vapid && { push: vapid.publicKey }),
        });
      case "PUT push":
      case "DELETE push":
        if (!vapid) return fail(404, "push is off");
        return setPush(req, session);
      case "DELETE ":
        if (!authorized(req, session.agentKeyHash)) return fail(401, "unauthorized");
        purge(sid);
        notify(sid);
        return empty();
      case "POST bind":
        return bind(req, sid);
      case "GET bind":
        sql.touch.run(Date.now(), sid);
        return longPoll(sid, () => {
          const current = sql.session.get(sid);
          if (!current) return fail(404, "no such session");
          if (current.joinerPub) return json({ pub: current.joinerPub, mac: current.bindTag });
        });
      case "GET a": {
        // ?m=n: also the user's messages after n. Clients that don't ask for them never see one.
        const since = url.searchParams.has("m") ? Number(url.searchParams.get("m")) || 0 : null;
        sql.touch.run(Date.now(), sid);
        return longPoll(sid, () => {
          if (!sql.session.get(sid)) return fail(404, "no such session");
          const found = [...sql.after.all(sid, "a", after), ...(since === null ? [] : sql.after.all(sid, "m", since))];
          if (found.length) return envelopes(found);
        });
      }
      case "GET m":
        return envelopes(sql.after.all(sid, "m", after));
      case "GET q":
        sql.touch.run(Date.now(), sid);
        return questionFeed(req, server, sid, Number(req.headers.get("last-event-id") ?? after) || 0);
      case "POST q":
      case "POST a":
      case "POST m":
        // push=0: the agent's status update (say), not a question; the relay learns only that much
        return post(req, session, action as Direction, url.searchParams.get("push") !== "0");
    }
    return fail(405, "method not allowed");
  }

  async function route(req: Request, server: Server<undefined>): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const file = await staticFile(url.pathname);
      if (file) return file;
    }
    if (req.method === "GET" && url.pathname === "/stats") return liveCount();
    const [, root, sid, action, extra] = url.pathname.split("/");
    // Unknown pages get the app, which shows its own not-found page.
    if (req.method === "GET" && root !== "s" && root !== "assets")
      return serveFile("app.html", "no-store", undefined, 404);
    if (root !== "s" || extra !== undefined) return fail(404, "not found");
    if (sid) return sessionRoute(req, server, url, sid, action ?? "");
    if (req.method !== "POST") return fail(405, "method not allowed");
    return createSession(req, server);
  }

  const server = Bun.serve({
    port,
    hostname,
    idleTimeout: 60,
    maxRequestBodySize: LIMITS.body,
    async fetch(req, instance) {
      const res = await route(req, instance).catch((error) => {
        console.error(error);
        return fail(500, "internal error");
      });
      for (const [name, value] of Object.entries(HEADERS)) if (!res.headers.has(name)) res.headers.set(name, value);
      return res;
    },
  });

  const sweep = setInterval(() => {
    for (const { sid } of sql.expired.all(Date.now() - LIMITS.ttlMs)) {
      purge(sid);
      notify(sid);
    }
    const now = Date.now();
    for (const [ip, times] of recentCreates)
      if (times.every((time) => now - time >= LIMITS.createWindowMs)) recentCreates.delete(ip);
  }, 10 * 60_000);

  return {
    server,
    stop() {
      clearInterval(sweep);
      server.stop(true);
      db.close();
    },
  };
}

// All three, or push notifications are off.
function vapidFromEnv(): Vapid | undefined {
  const { ASKU_VAPID_PUBLIC: publicKey, ASKU_VAPID_PRIVATE: privateKey, ASKU_VAPID_SUBJECT: subject } = process.env;
  if (publicKey && privateKey && subject) return { publicKey, privateKey, subject };
}

if (import.meta.main) {
  const { server } = relay({
    port: Number(process.env.PORT ?? 8080),
    hostname: process.env.ASKU_HOST, // 127.0.0.1 behind a tunnel, so ASKU_IP_HEADER cannot be spoofed
    db: process.env.ASKU_DB ?? "asku.db",
    ipHeader: process.env.ASKU_IP_HEADER, // e.g. cf-connecting-ip behind Cloudflare
    vapid: vapidFromEnv(),
  });
  console.log(`asku relay on ${server.url}`);
}
