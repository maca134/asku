// The relay's SQLite tables: one row per session, one per stored envelope. Envelopes are opaque ciphertext.
import { Database } from "bun:sqlite";
import type { Direction } from "../shared/crypto";

export type Role = "agent" | "browser";

// role and creatorPub: the side that made the session. joinerPub and bindTag: the side that joined it.
// Each side's write key is stored as a SHA-256 hash.
export type Session = {
  sid: string;
  role: Role;
  creatorPub: string;
  joinerPub: string | null;
  bindTag: string | null;
  agentKeyHash: string | null;
  browserKeyHash: string | null;
  bytes: number;
  push: string | null;
};

export function openStore(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run(`create table if not exists sessions (
    sid text primary key, role text not null, creatorPub text not null, joinerPub text, bindTag text,
    agentKeyHash text, browserKeyHash text, bytes integer not null default 0, touched integer not null, push text)`);
  // databases from before push notifications
  if (!db.query("select 1 from pragma_table_info('sessions') where name = 'push'").get())
    db.run("alter table sessions add column push text");
  db.run(`create table if not exists messages (
    sid text not null, direction text not null, seq integer not null, envelope text not null,
    primary key (sid, direction, seq)) without rowid`);
  // messages a post stored after its session was purged, before post() re-read the session
  db.run("delete from messages where sid not in (select sid from sessions)");

  const sql = {
    session: db.query<Session, [string]>("select * from sessions where sid = ?"),
    create: db.query(
      "insert into sessions (sid, role, creatorPub, agentKeyHash, browserKeyHash, touched) values (?, ?, ?, ?, ?, ?)",
    ),
    // the joiner gets the write key for the role the creator doesn't have
    bind: db.query(`update sessions set joinerPub = ?1, bindTag = ?2,
      agentKeyHash = case role when 'browser' then ?3 else agentKeyHash end,
      browserKeyHash = case role when 'agent' then ?3 else browserKeyHash end
      where sid = ?4 and joinerPub is null`),
    setPush: db.query("update sessions set push = ? where sid = ?"),
    touch: db.query("update sessions set touched = ? where sid = ?"),
    grow: db.query("update sessions set bytes = bytes + ?, touched = ? where sid = ?"),
    lastSeq: db.query<{ seq: number | null }, [string, Direction]>(
      "select max(seq) seq from messages where sid = ? and direction = ?",
    ),
    has: db.query<{ found: 1 }, [string, Direction, number]>(
      "select 1 found from messages where sid = ? and direction = ? and seq = ?",
    ),
    insert: db.query("insert into messages (sid, direction, seq, envelope) values (?, ?, ?, ?)"),
    after: db.query<{ seq: number; envelope: string }, [string, Direction, number]>(
      "select seq, envelope from messages where sid = ? and direction = ? and seq > ? order by seq",
    ),
    // ponytail: full scan of sessions per write; fine at LIMITS.sessions rows, keep a running total if that grows.
    totals: db.query<{ sessions: number; bytes: number }, []>(
      "select count(*) sessions, coalesce(sum(bytes), 0) bytes from sessions",
    ),
    expired: db.query<{ sid: string }, [number]>("select sid from sessions where touched < ?"),
    deleteSession: db.query("delete from sessions where sid = ?"),
    deleteMessages: db.query("delete from messages where sid = ?"),
  };

  const purge = db.transaction((sid: string) => {
    sql.deleteMessages.run(sid);
    sql.deleteSession.run(sid);
  });
  const store = db.transaction((sid: string, direction: Direction, seq: number, envelope: string) => {
    sql.insert.run(sid, direction, seq, envelope);
    sql.grow.run(envelope.length, Date.now(), sid);
  });
  return { db, sql, purge, store };
}
