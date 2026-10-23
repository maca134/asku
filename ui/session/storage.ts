// agentPub is unset while a session this browser created waits for its agent; browserPub, token and note are only kept until then.
export type State = { priv: CryptoKey; key: string; answered: number[]; start?: number; agentPub?: string; browserPub?: string; token?: string; note?: string };

// ---- persistence: the fragment is gone after first load, so key pair B and the write key live in IndexedDB.
// ponytail: IndexedDB unavailable (some private modes) means a reload loses the session; fine, the agent can start a new one.
const idb = new Promise<IDBDatabase>((resolve, reject) => {
  const r = indexedDB.open("asku", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("s");
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
async function db<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const d = await idb;
  return new Promise<T>((resolve, reject) => {
    const r = fn(d.transaction("s", mode).objectStore("s"));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
export const load = (sid: string) => db<State | undefined>("readonly", (s) => s.get(sid)).catch(() => undefined);
export const save = (sid: string, state: State) => db("readwrite", (s) => s.put(state, sid)).catch(() => {});
export const drop = (sid: string) => db("readwrite", (s) => s.delete(sid)).catch(() => {});
