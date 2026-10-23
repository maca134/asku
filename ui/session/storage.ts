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
  push?: boolean;
};

export function rename(state: State, name: string | undefined) {
  if (!name || state.name === name) return false;
  state.name = name;
  return true;
}

export function markAsked(state: State, seq: number) {
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

const settle = <T>(pending: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    pending.onsuccess = () => resolve(pending.result);
    pending.onerror = () => reject(pending.error);
  });

export const load = (sid: string) =>
  open("readonly")
    .then((store) => settle<State | undefined>(store.get(sid)))
    .catch(() => undefined);
export const drop = (sid: string) =>
  open("readwrite")
    .then((store) => settle(store.delete(sid)))
    .catch(() => {});

// Another tab or the service worker may have saved since this copy was loaded: keep the seqs it recorded.
export function merge(state: State, stored: State | undefined) {
  for (const seq of stored?.answered ?? []) if (!state.answered.includes(seq)) state.answered.push(seq);
  for (const seq of stored?.asked ?? []) markAsked(state, seq);
}

// Read, merge and write in one transaction, so no other save lands in between.
export async function save(sid: string, state: State) {
  try {
    const store = await open("readwrite");
    merge(state, await settle<State | undefined>(store.get(sid)));
    state.active = Date.now();
    await settle(store.put(state, sid));
  } catch {}
}

export async function list() {
  try {
    const store = await open("readonly");
    const [sids, states] = await Promise.all([settle(store.getAllKeys()), settle<State[]>(store.getAll())]);
    const rows = states.map((state, i) => summary(String(sids[i]), state));
    return rows.sort((earlier, later) => later.active - earlier.active);
  } catch (error) {
    console.error(error); // no IndexedDB (some private modes): nothing to list
    return [];
  }
}
