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
  show,
  startClock,
  status,
  waiting,
} from "../page";
import type { Answer, Question, Say } from "../types";
import { chat } from "./chat";
import { offerPush } from "./push";
import { type Session, sendAnswer } from "./send";
import { drop, markAsked, rename, save } from "./storage";

export function listen(session: Session) {
  const { sid, keys, state } = session;
  // No spinner while idle: nothing is loading. The live line turns into "Reconnecting…" while the feed is down.
  status("agent", "Connected", "This page updates by itself, keep it open.", live("Waiting for the agent's question…"));
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
      // after a reload: the same "agent is working" line as before it, but only in place of "Connected", never
      // over an error or an ended session
      if (!current && app.querySelector(".shell-main > .state.agent")) show(waiting());
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
    const told = await send([seq], answer).then(
      () => true,
      (error) => {
        console.error(error);
        return false;
      },
    );
    if (current) return;
    status(
      "error",
      "This question can't be shown",
      told
        ? "The agent sent a form this page doesn't understand. It has been told; wait for a corrected one."
        : "The agent sent a form this page doesn't understand, and telling it failed. Reload to try again.",
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
  // The feed resumes after the last batch it delivered. A closed feed (a 429 while the relay still counts the
  // connection a backgrounded tab dropped, or Firefox giving up after a network error) only means the session ended
  // if the relay says it is gone; otherwise connect again.
  let events: EventSource;
  let last = 0;
  let retries = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let ended = false;
  const connect = () => {
    clearTimeout(retry);
    retry = undefined;
    events = new EventSource(`/s/${sid}/q?after=${last}`);
    events.addEventListener("open", () => {
      retries = 0;
      reconnected();
    });
    events.addEventListener("q", (event) => {
      const seq = Number(event.lastEventId);
      if (Number.isSafeInteger(seq)) last = Math.max(last, seq);
      queue(() => receive(seq, event.data));
    });
    events.addEventListener("close", end);
    events.onerror = () => {
      showReconnecting();
      if (events.readyState === EventSource.CLOSED) recover();
    };
  };
  const recover = async () => {
    const res = await fetch(`/s/${sid}`).catch(() => null);
    if (ended) return;
    if (res?.status === 404) return expired();
    retries = Math.min(retries + 1, 5);
    retry = setTimeout(connect, 1000 * 2 ** retries); // 2s, 4s, ... 32s
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && retry) connect();
  });
  const expired = () => {
    ended = true;
    chatSlot.replaceChildren();
    status("error", "This session has ended or expired", undefined, newSessionLink(), homeLink());
  };
  const end = () => {
    ended = true;
    clearTimeout(retry);
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
  };
  connect();
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

// While the feed is down, say so instead of a "Connected" that isn't; put the text back once it is up again.
let reconnecting: { text: ChildNode; was: string | null } | null = null;
function showReconnecting() {
  const text = app.querySelector(".live")?.lastChild;
  if (reconnecting || !text) return;
  reconnecting = { text, was: text.textContent };
  text.textContent = "Reconnecting…";
}
function reconnected() {
  if (reconnecting) reconnecting.text.textContent = reconnecting.was;
  reconnecting = null;
}
