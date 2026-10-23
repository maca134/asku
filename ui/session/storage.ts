// The fragment is gone after the first load, so key pair B and the write key live in IndexedDB.
// ponytail: IndexedDB unavailable (some private modes) means a reload loses the session; the agent can start a new one.

// agentPub is unset while a session this browser created waits for its agent; browserPub, token and note are only
// kept until then. asked holds the seqs of forms that reached this page; active is when the state last changed.
export type State = {
  priv: CryptoKey;
  key: string;
  answered: number[];
  start?: number;
  agentPub?: string;
  browserPub?: string;
  token?: string;
  note?: string;
  name?: string;
  asked?: number[];
  active?: number;
};

export function rename(state: State, name: string | undefined) {
  if (!name || state.name === name) return false;
  state.name = name;
  return true;
}

export function received(state: State, seq: number) {
  state.asked ??= [];
  if (state.asked.includes(seq)) return false;
  state.asked.push(seq);
  return true;
}

export type Summary = ReturnType<typeof summary>;

// What the sessions page shows: no keys leave this module.
export const summary = (sid: string, state: State) => ({
  sid,
  name: state.name ?? "Unnamed session",
  // ponytail: a form left to expire still counts as waiting; only the relay could say otherwise, and it isn't asked
  waiting: (state.asked ?? []).some((seq) => !state.answered.includes(seq)),
  joined: !!state.agentPub,
  active: state.active ?? state.start ?? 0,
});

let database: Promise<IDBDatabase> | undefined;

const connect = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("asku", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("s");
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });

async function open(mode: IDBTransactionMode) {
  database ??= connect();
  return (await database).transaction("s", mode).objectStore("s");
}

async function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>) {
  const pending = request(await open(mode));
  return new Promise<T>((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

export const load = (sid: string) =>
  run<State | undefined>("readonly", (store) => store.get(sid)).catch(() => undefined);
export const drop = (sid: string) => run("readwrite", (store) => store.delete(sid)).catch(() => {});

export function save(sid: string, state: State) {
  state.active = Date.now();
  return run("readwrite", (store) => store.put(state, sid)).catch(() => {});
}

// Every session this browser holds, most recently active first.
export async function list() {
  const rows: Summary[] = [];
  try {
    const cursor = (await open("readonly")).openCursor();
    await new Promise((resolve, reject) => {
      cursor.onsuccess = () => {
        if (!cursor.result) return resolve(rows);
        rows.push(summary(String(cursor.result.key), cursor.result.value));
        cursor.result.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  } catch {}
  return rows.sort((a, b) => b.active - a.active);
}
