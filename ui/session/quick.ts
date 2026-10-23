// Yes/No buttons on a notification: which batches get them, reading the batch, and the answer a button sends.
import { type Keys, open } from "../../shared/crypto";
import { conditionProblem } from "../form/when";
import { question as validQuestion } from "../gen/validate.js";
import type { Answer, ConfirmItem } from "../types";

// A nervous agent wants the whole page looked at, not a tap on the lock screen.
export function quickConfirm(message: unknown): ConfirmItem | null {
  if (!validQuestion(message) || conditionProblem(message.questions) || message.mood === "nervous") return null;
  const [item, ...rest] = message.questions;
  return item.type === "confirm" && !rest.length ? item : null;
}

// Field for field what the page's form sends for one answered confirm.
export const confirmAnswer = (seq: number, id: string, yes: boolean): Answer => ({
  seqs: [seq],
  answers: { [id]: yes },
  skipped: [],
  comments: {},
  note: "",
});

export function choice(action: string) {
  if (action === "yes") return true;
  if (action === "no") return false;
  return null;
}

// The first event of the question feed from just before seq: that batch, decrypted, or null.
export async function fetchBatch(origin: string, sid: string, seq: number, keys: Keys, signal?: AbortSignal) {
  try {
    const res = await fetch(`${origin}/s/${sid}/q?after=${seq - 1}`, { signal });
    if (!res.ok || !res.body) return null;
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return null;
        text += value;
        const event = text.match(/^id: (\d+)\nevent: q\ndata: (.*)\n\n/m);
        if (event) return JSON.parse(await open(keys, sid, "q", seq, JSON.parse(event[2]))) as unknown;
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  } catch {
    return null;
  }
}
