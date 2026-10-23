// The answer page once joined: decrypt and check each batch from the agent, then show it.
import { open } from "../../shared/crypto";
import { app } from "../dom";
import type { Form } from "../form/form";
import { type Batch, OpenForm, type Send } from "../form/open";
import { conditionProblem } from "../form/when";
import { question as validQuestion, say as validSay } from "../gen/validate.js";
import {
  addToFeed,
  batchName,
  chatSlot,
  feedEvent,
  homeLink,
  live,
  nameSession,
  newSessionLink,
  ping,
  say,
  sessionName,
  startClock,
  status,
} from "../page";
import type { Answer, Question, Say } from "../types";
import { chat } from "./chat";
import { offerPush } from "./push";
import { type Session, sendAnswer } from "./send";
import { drop, markAsked, rename, save } from "./storage";

export function listen(session: Session) {
  const { sid, keys, state } = session;
  status("wait", "Connected", "Waiting for the agent's question. This page updates by itself, keep it open.");
  const events = new EventSource(`/s/${sid}/q`);
  const opened = Date.now();
  if (!state.start) {
    state.start = opened;
    save(sid, state);
  }
  startClock(state.start);
  offerPush(session);
  const send: Send = (seqs, answer) => sendAnswer(session, seqs, answer);

  let current: OpenForm | null = null;
  let deferred: Batch[] = []; // arrived while an answer was being sent: placed once it's done
  let chain: Promise<unknown> = Promise.resolve(); // decrypting and placing are async: keep batches in order
  const queue = (task: () => Promise<unknown>) => {
    chain = chain.then(task).catch(console.error);
  };

  const formDone = () =>
    queue(async () => {
      if (!current || current.sending || current.closed) current = null;
      const batches = deferred;
      deferred = [];
      for (const [seq, batch] of batches) await place(seq, batch);
    });

  const receive = async (seq: number, data: string) => {
    let message: Question | Say;
    try {
      message = JSON.parse(await open(keys, sid, "q", seq, JSON.parse(data)));
    } catch {
      return failedVerification();
    }
    await place(seq, message);
  };

  const failedVerification = () => {
    // keep what the user has typed
    if (current) {
      current.form.error.textContent =
        "A message from the agent failed verification and was ignored. If this repeats, ask the agent for a new link.";
      return;
    }
    status("error", "A message failed verification", "It was ignored. If this repeats, ask the agent for a new link.");
  };

  const place = async (seq: number, message: Question | Say) => {
    if ("say" in message) {
      // the schema can't compare two fields: done <= total is checked here
      if (validSay(message) && !(message.progress && message.progress.done > message.progress.total)) say(message);
      return;
    }
    const valid = validQuestion(message);
    // no name yet: the first title will do
    if (valid && (message.name || (!sessionName.textContent && message.title)))
      nameSession(message.name ?? message.title!);
    if (valid && rename(state, message.name ?? (state.name ? undefined : message.title))) save(sid, state);
    if (state.answered.includes(seq)) {
      if (valid) addToFeed(feedEvent("check", `Answered: ${batchName(message)}`));
      return;
    }
    if (markAsked(state, seq)) save(sid, state);
    if (current?.sending) {
      deferred.push([seq, message]);
      return;
    }
    if (!valid) return reject(seq, schemaErrors());
    const problem = conditionProblem(message.questions) ?? (current ? clash(current.form, message) : null);
    if (problem) return reject(seq, problem);
    if (current) current.add([seq, message]);
    else current = new OpenForm([[seq, message]], send, formDone);
    const replayed = Date.now() - opened < 1500;
    if (!replayed) ping(message.mood);
  };

  // The batch is dropped and the agent told why; an open form stays as it is.
  const reject = async (seq: number, problem: string) => {
    const error = `invalid question: ${problem}`.slice(0, 2000);
    const answer: Answer = { seqs: [seq], answers: {}, skipped: [], comments: {}, note: "", error };
    await send([seq], answer).catch(() => {});
    if (current) return;
    status(
      "error",
      "This question can't be shown",
      "The agent sent a form this page doesn't understand. It has been told; wait for a corrected one.",
      live("Waiting for the agent…"),
    );
  };

  queue(() => chat(session)); // first in the queue: the user's earlier messages before the replayed questions
  navigator.serviceWorker?.addEventListener("message", ({ data }) => {
    const seq = data?.answered;
    if (data?.sid !== sid || !Number.isSafeInteger(seq)) return;
    queue(async () => {
      if (!state.answered.includes(seq)) state.answered.push(seq);
      current?.answeredElsewhere(seq);
    });
  });
  events.addEventListener("q", (event) => queue(() => receive(Number(event.lastEventId), event.data)));
  events.addEventListener("close", () => {
    events.close();
    drop(sid);
    chatSlot.replaceChildren();
    status(
      "done",
      "Session ended",
      "The agent closed this session and the relay deleted it. You can close this tab.",
      <div className="state-actions">
        {newSessionLink("btn-primary")}
        {homeLink()}
      </div>,
    );
  });
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) {
      chatSlot.replaceChildren();
      return status("error", "This session has ended or expired", undefined, newSessionLink(), homeLink());
    }
    showReconnecting(events);
  };
}

// Why a batch can't join the open form. The agent client checks the same; this only guards the merged answer.
function clash(form: Form, batch: Question) {
  const ids = new Set(form.fields.map((field) => field.item.id));
  const repeated = batch.questions.map((item) => item.id).filter((id) => ids.has(id));
  if (repeated.length) return `ids already in the open form: ${repeated.join(", ")}`;
  if (form.fields.length + batch.questions.length > 50) return "the open form would have more than 50 questions";
  return null;
}

const schemaErrors = () =>
  validQuestion.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("; ") ?? "invalid";

// The browser reconnects by itself; say so instead of a "Connected" that isn't.
function showReconnecting(events: EventSource) {
  const text = app.querySelector(".live")?.lastChild;
  if (!text || text.textContent === "Reconnecting…") return;
  const was = text.textContent;
  text.textContent = "Reconnecting…";
  events.addEventListener(
    "open",
    () => {
      text.textContent = was;
    },
    { once: true },
  );
}
