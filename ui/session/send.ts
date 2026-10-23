import { type Keys, seal } from "../../shared/crypto";
import type { Answer } from "../types";
import { type State, save } from "./storage";

export type Session = { sid: string; keys: Keys; state: State };

export const post = (path: string, body: unknown, writeKey?: string) =>
  fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(writeKey ? { authorization: `Bearer ${writeKey}` } : {}) },
    body: JSON.stringify(body),
  });

// a retry of an answer the relay already has
const isDuplicate = async (res: Response) =>
  res.status === 409 && (await res.json().catch(() => ({}))).error === "duplicate";

// One answer can cover several batches: it goes under the newest, and says which in its `seqs`.
export async function sendAnswer({ sid, keys, state }: Session, seqs: number[], answer: Answer | { note: string }) {
  const envelope = await seal(keys, sid, "a", Math.max(...seqs), JSON.stringify(answer));
  const res = await post(`/s/${sid}/a`, envelope, state.key);
  if (res.status !== 204 && !(await isDuplicate(res))) throw new Error(`relay said ${res.status}`);
  state.answered.push(...seqs);
  await save(sid, state);
}
