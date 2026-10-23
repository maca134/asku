// asku relay: stores opaque envelopes, never sees plaintext. API in README "Relay API".
import { Database } from "bun:sqlite";
import type { Server } from "bun";

export const LIMITS = {
  body: 256 * 1024,
  sessionBytes: 8 << 20,
  maxSeq: 1000,
  ttlMs: 24 * 3600_000,
  createPerIp: 20,
  createWindowMs: 10 * 60_000,
};

const HEADERS = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

type Dir = "q" | "a";
type Session = { sid: string; pub: string; akey: string; bpub: string | null; bmac: string | null; bkey: string | null; bytes: number };

const sha = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n)).toBase64({ alphabet: "base64url", omitPadding: true });
const json = (body: unknown, status = 200) => Response.json(body, { status });
const fail = (status: number, error: string) => json({ error }, status);
const empty = (status = 204) => new Response(null, { status });

function b64(s: unknown, len?: number) {
  if (typeof s !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try {
    const b = Uint8Array.fromBase64(s);
    return len === undefined || b.length === len ? b : null;
  } catch {
    return null;
  }
}

const isPub = (s: unknown) => b64(s, 65)?.[0] === 4;

function envelope(x: any, dir: Dir) {
  if (!x || typeof x !== "object" || Object.keys(x).length !== 6) return null;
  const { v, seq, iv, ct, tag } = x;
  const ctb = b64(ct);
  const ok = v === 1 && x.dir === dir && Number.isInteger(seq) && seq >= 1 && seq <= LIMITS.maxSeq
    && b64(iv, 16) && ctb && ctb.length % 16 === 0 && b64(tag, 32);
  return ok ? JSON.stringify({ v, seq, dir, iv, ct, tag }) : null;
}

async function body(req: Request) {
  if (!req.headers.get("content-type")?.startsWith("application/json")) return null; // forces a CORS preflight
  return req.json().catch(() => null);
}

export function relay({ port = 0, db: path = ":memory:", holdMs = 25_000, ipHeader }: {
  port?: number; db?: string; holdMs?: number; ipHeader?: string;
} = {}) {
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run(`create table if not exists s (
    sid text primary key, pub text not null, akey text not null,
    bpub text, bmac text, bkey text, bytes integer not null default 0, touched integer not null)`);
  db.run(`create table if not exists m (
    sid text not null, dir text not null, seq integer not null, env text not null,
    primary key (sid, dir, seq)) without rowid`);

  const sql = {
    get: db.query<Session, [string]>("select * from s where sid = ?"),
    create: db.query("insert into s (sid, pub, akey, touched) values (?, ?, ?, ?)"),
    bind: db.query("update s set bpub = ?, bmac = ?, bkey = ? where sid = ? and bpub is null"),
    touch: db.query("update s set touched = ? where sid = ?"),
    grow: db.query("update s set bytes = bytes + ?, touched = ? where sid = ?"),
    last: db.query<{ n: number | null }, [string, string]>("select max(seq) n from m where sid = ? and dir = ?"),
    has: db.query("select 1 from m where sid = ? and dir = ? and seq = ?"),
    insert: db.query("insert into m (sid, dir, seq, env) values (?, ?, ?, ?)"),
    after: db.query<{ seq: number; env: string }, [string, string, number]>("select seq, env from m where sid = ? and dir = ? and seq > ? order by seq"),
    expired: db.query<{ sid: string }, [number]>("select sid from s where touched < ?"),
    delS: db.query("delete from s where sid = ?"),
    delM: db.query("delete from m where sid = ?"),
  };
  const purge = db.transaction((sid: string) => { sql.delM.run(sid); sql.delS.run(sid); });
  const store = db.transaction((sid: string, dir: Dir, seq: number, env: string) => {
    sql.insert.run(sid, dir, seq, env);
    sql.grow.run(env.length, Date.now(), sid);
  });

  // ponytail: in-process wakeups, single instance only; pub/sub (e.g. Redis) if this ever scales out.
  const subs = new Map<string, Set<() => void>>();
  const subscribe = (sid: string, fn: () => void) => {
    let set = subs.get(sid);
    if (!set) subs.set(sid, (set = new Set()));
    set.add(fn);
    return () => { set.delete(fn); if (!set.size) subs.delete(sid); };
  };
  const notify = (sid: string) => subs.get(sid)?.forEach((fn) => fn());

  // Long-poll: answer as soon as check() returns a Response, else 204 after holdMs.
  async function hold(sid: string, check: () => Response | undefined) {
    const end = Date.now() + holdMs;
    for (;;) {
      const res = check();
      if (res) return res;
      const left = end - Date.now();
      if (left <= 0) return empty();
      await new Promise<void>((done) => {
        const t = setTimeout(fin, left);
        const unsub = subscribe(sid, fin);
        function fin() { clearTimeout(t); unsub(); done(); }
      });
    }
  }

  // Browser feed of questions. Resumes from Last-Event-ID or ?after.
  function feed(req: Request, srv: Server, sid: string, after: number) {
    const te = new TextEncoder();
    let cleanup = () => {};
    const stream = new ReadableStream({
      start(c) {
        const send = (s: string) => c.enqueue(te.encode(s));
        const push = () => {
          if (!sql.get.get(sid)) { send("event: close\ndata:\n\n"); cleanup(); return c.close(); }
          for (const m of sql.after.all(sid, "q", after)) { send(`id: ${m.seq}\nevent: q\ndata: ${m.env}\n\n`); after = m.seq; }
        };
        const unsub = subscribe(sid, push);
        const ping = setInterval(() => send(": ping\n\n"), 20_000);
        cleanup = () => { clearInterval(ping); unsub(); };
        push();
      },
      cancel: () => cleanup(),
    });
    srv.timeout(req, 0);
    return new Response(stream, { headers: { "content-type": "text/event-stream" } });
  }

  const hits = new Map<string, number[]>();
  function limited(ip: string) {
    const now = Date.now();
    const h = (hits.get(ip) ?? []).filter((t) => now - t < LIMITS.createWindowMs);
    h.push(now);
    hits.set(ip, h);
    return h.length > LIMITS.createPerIp;
  }

  const authed = (req: Request, key: string | null) =>
    key !== null && sha(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "") === key;

  async function route(req: Request, srv: Server): Promise<Response> {
    const url = new URL(req.url);
    const [, root, sid, sub, extra] = url.pathname.split("/");
    if (root !== "s" || extra !== undefined) return fail(404, "not found");
    const m = req.method;

    if (!sid) {
      if (m !== "POST") return fail(405, "method not allowed");
      const ip = (ipHeader ? req.headers.get(ipHeader) : srv.requestIP(req)?.address) ?? "?";
      if (limited(ip)) return fail(429, "too many sessions");
      const b = await body(req);
      if (!isPub(b?.pub)) return fail(400, "bad pub");
      const s = { sid: rand(16), key: rand(32) };
      sql.create.run(s.sid, b.pub, sha(s.key), Date.now());
      return json(s, 201);
    }

    const s = sql.get.get(sid);
    if (!s) return fail(404, "no such session");
    const after = Number(url.searchParams.get("after") ?? 0) || 0;

    switch (`${m} ${sub ?? ""}`) {
      case "GET ":
        return json({ pub: s.pub, bound: s.bpub !== null });
      case "DELETE ":
        if (!authed(req, s.akey)) return fail(401, "unauthorized");
        purge(sid);
        notify(sid);
        return empty();
      case "POST bind": {
        const b = await body(req);
        if (!isPub(b?.pub) || !b64(b?.mac, 32)) return fail(400, "bad binding");
        const key = rand(32);
        if (sql.bind.run(b.pub, b.mac, sha(key), sid).changes === 0) return fail(409, "already bound");
        notify(sid);
        return json({ key }, 201);
      }
      case "GET bind":
        sql.touch.run(Date.now(), sid);
        return hold(sid, () => {
          const s = sql.get.get(sid);
          if (!s) return fail(404, "no such session");
          if (s.bpub) return json({ pub: s.bpub, mac: s.bmac });
        });
      case "GET a":
        sql.touch.run(Date.now(), sid);
        return hold(sid, () => {
          if (!sql.get.get(sid)) return fail(404, "no such session");
          const rows = sql.after.all(sid, "a", after);
          if (rows.length) return new Response(`[${rows.map((r) => r.env).join(",")}]`, { headers: { "content-type": "application/json" } });
        });
      case "GET q":
        sql.touch.run(Date.now(), sid);
        return feed(req, srv, sid, Number(req.headers.get("last-event-id") ?? after) || 0);
      case "POST q":
      case "POST a": {
        const dir = sub as Dir;
        if (!authed(req, dir === "q" ? s.akey : s.bkey)) return fail(401, "unauthorized");
        const env = envelope(await body(req), dir);
        if (!env) return fail(400, "bad envelope");
        const seq = JSON.parse(env).seq;
        const seqOk = dir === "q" ? seq === (sql.last.get(sid, "q")?.n ?? 0) + 1 : sql.has.get(sid, "q", seq) !== null;
        if (!seqOk) return fail(409, "bad seq");
        if (s.bytes + env.length > LIMITS.sessionBytes) return fail(413, "session full");
        try {
          store(sid, dir, seq, env);
        } catch {
          return fail(409, "bad seq"); // lost a race, or already answered
        }
        notify(sid);
        return empty();
      }
    }
    return fail(405, "method not allowed");
  }

  const server = Bun.serve({
    port,
    idleTimeout: 60,
    maxRequestBodySize: LIMITS.body,
    async fetch(req, srv) {
      const res = await route(req, srv).catch((e) => { console.error(e); return fail(500, "internal error"); });
      for (const [k, v] of Object.entries(HEADERS)) res.headers.set(k, v);
      return res;
    },
  });

  const sweep = setInterval(() => {
    for (const { sid } of sql.expired.all(Date.now() - LIMITS.ttlMs)) { purge(sid); notify(sid); }
    const now = Date.now();
    for (const [ip, h] of hits) if (h.every((t) => now - t >= LIMITS.createWindowMs)) hits.delete(ip);
  }, 10 * 60_000);

  return {
    server,
    stop() { clearInterval(sweep); server.stop(true); db.close(); },
  };
}

if (import.meta.main) {
  const { server } = relay({
    port: Number(process.env.PORT ?? 8080),
    db: process.env.ASKU_DB ?? "asku.db",
    ipHeader: process.env.ASKU_IP_HEADER, // e.g. cf-connecting-ip behind Cloudflare
  });
  console.log(`asku relay on ${server.url}`);
}
