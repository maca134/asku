// The fragment is gone after the first load, so key pair B and the write key live in IndexedDB.
// ponytail: IndexedDB unavailable (some private modes) means a reload loses the session; the agent can start a new one.

// agentPub is unset while a session this browser created waits for its agent; browserPub, token and note are only
// kept until then.
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
  push?: boolean;
};

export function rename(state: State, name: string | undefined) {
  if (!name || state.name === name) return false;
  state.name = name;
  return true;
}

let database: Promise<IDBDatabase> | undefined;

const connect = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const opening = indexedDB.open("asku", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("s");
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });

async function run<T>(mode: IDBTransactionMode, request: (store: IDBObjectStore) => IDBRequest<T>) {
  database ??= connect();
  const db = await database;
  return new Promise<T>((resolve, reject) => {
    const pending = request(db.transaction("s", mode).objectStore("s"));
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });
}

export const load = (sid: string) =>
  run<State | undefined>("readonly", (store) => store.get(sid)).catch(() => undefined);
export const save = (sid: string, state: State) => run("readwrite", (store) => store.put(state, sid)).catch(() => {});
export const drop = (sid: string) => run("readwrite", (store) => store.delete(sid)).catch(() => {});
