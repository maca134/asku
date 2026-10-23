// The relay's SQLite tables: one row per session, one per stored envelope. Envelopes are opaque ciphertext.
import { Database } from "bun:sqlite";

export type Dir = "q" | "a";
type Role = "agent" | "browser";
// pub/role: the side that created the session. peer/mac: the side that joined it.
export type Session = {
  sid: string;
  role: Role;
  pub: string;
  akey: string | null;
  peer: string | null;
  mac: string | null;
  bkey: string | null;
  bytes: number;
};

export function openStore(path: string) {
  const db = new Database(path, { create: true, strict: true });
  db.run("pragma journal_mode = wal");
  db.run(`create table if not exists s (
    sid text primary key, role text not null, pub text not null, akey text,
    peer text, mac text, bkey text, bytes integer not null default 0, touched integer not null)`);
  db.run(`create table if not exists m (
    sid text not null, dir text not null, seq integer not null, env text not null,
    primary key (sid, dir, seq)) without rowid`);

  const sql = {
    get: db.query<Session, [string]>("select * from s where sid = ?"),
    create: db.query("insert into s (sid, role, pub, akey, bkey, touched) values (?, ?, ?, ?, ?, ?)"),
    // the joiner gets the write key for the role the creator doesn't have
    bind: db.query(`update s set peer = ?1, mac = ?2,
      akey = case role when 'browser' then ?3 else akey end,
      bkey = case role when 'agent' then ?3 else bkey end
      where sid = ?4 and peer is null`),
    touch: db.query("update s set touched = ? where sid = ?"),
    grow: db.query("update s set bytes = bytes + ?, touched = ? where sid = ?"),
    last: db.query<{ n: number | null }, [string, string]>("select max(seq) n from m where sid = ? and dir = ?"),
    has: db.query("select 1 from m where sid = ? and dir = ? and seq = ?"),
    insert: db.query("insert into m (sid, dir, seq, env) values (?, ?, ?, ?)"),
    after: db.query<{ seq: number; env: string }, [string, string, number]>(
      "select seq, env from m where sid = ? and dir = ? and seq > ? order by seq",
    ),
    // ponytail: full scan of s per write; fine at LIMITS.sessions rows, keep a running total if that grows.
    totals: db.query<{ n: number; b: number }, []>("select count(*) n, coalesce(sum(bytes), 0) b from s"),
    expired: db.query<{ sid: string }, [number]>("select sid from s where touched < ?"),
    delS: db.query("delete from s where sid = ?"),
    delM: db.query("delete from m where sid = ?"),
  };
  const purge = db.transaction((sid: string) => {
    sql.delM.run(sid);
    sql.delS.run(sid);
  });
  const store = db.transaction((sid: string, dir: Dir, seq: number, env: string) => {
    sql.insert.run(sid, dir, seq, env);
    sql.grow.run(env.length, Date.now(), sid);
  });
  return { db, sql, purge, store };
}
