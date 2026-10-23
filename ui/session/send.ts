import { seal, type Keys } from "../../shared/crypto";
import type { Answer } from "../types";
import { save, type State } from "./storage";

export const post = (path: string, body: unknown, key?: string) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });

// ---- session
// One answer can cover several batches: it goes under the newest, and says which in its `seqs`.
export async function send(sid: string, keys: Keys, st: State, seqs: number[], a: Answer | { note: string }) {
  const res = await post(`/s/${sid}/a`, await seal(keys, sid, "a", Math.max(...seqs), JSON.stringify(a)), st.key);
  // duplicate: a retry of an answer the relay already has
  if (res.status !== 204 && !(res.status === 409 && (await res.json().catch(() => ({}))).error === "duplicate")) throw new Error(`relay said ${res.status}`);
  st.answered.push(...seqs);
  await save(sid, st);
}
