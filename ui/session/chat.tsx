// The user's line to the agent outside any form, and STOP. Each is sealed as dir m; the agent's client prints it on
// its next call.
import { open, seal } from "../../shared/crypto";
import { h, icon } from "../dom";
import { message as validMessage } from "../gen/validate.js";
import { addToFeed, chatSlot, feedEvent, said } from "../page";
import type { Message } from "../types";
import { post, type Session } from "./send";

const show = (message: Message) =>
  "stop" in message ? addToFeed(feedEvent("stop", "You pressed STOP", "stop")) : said(message.message);

export async function chat({ sid, keys, state }: Session) {
  // the relay keeps what was sent: shown again after a reload, and it numbers the next one
  let seq = 0;
  const res = await fetch(`/s/${sid}/m`).catch(() => null);
  for (const envelope of res?.ok ? await res.json() : []) {
    seq++;
    const message = await open(keys, sid, "m", seq, envelope)
      .then(JSON.parse)
      .catch(() => null);
    if (validMessage(message)) show(message);
  }

  // ponytail: one tab per session; a second tab sending at once gets "bad seq" and the user sends again
  const send = async (message: Message) => {
    const envelope = await seal(keys, sid, "m", seq + 1, JSON.stringify(message));
    const sent = await post(`/s/${sid}/m`, envelope, state.key);
    if (sent.status !== 204) throw new Error(`the relay said ${sent.status}`);
    seq++;
    show(message);
  };

  const text = h("input", {
    type: "text",
    className: "input",
    maxLength: 10000,
    placeholder: "Message the agent",
    ariaLabel: "Message to the agent",
  });
  const sendButton = h("button", { type: "submit", className: "btn btn-secondary" }, icon("arrow"), "Send");
  const stopButton = h(
    "button",
    { type: "button", className: "btn btn-stop", title: "Tell the agent to stop and check with you" },
    icon("stop"),
    "STOP",
  );
  const error = <p className="form-err" role="alert" />;

  const sending = async (task: () => Promise<void>) => {
    sendButton.disabled = stopButton.disabled = true;
    error.textContent = "";
    try {
      await task();
    } catch (failure) {
      error.textContent = `Not sent: ${(failure as Error).message}`;
    } finally {
      sendButton.disabled = stopButton.disabled = false;
    }
  };

  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    const message = text.value.trim();
    if (!message) return;
    sending(async () => {
      await send({ message });
      text.value = "";
    });
  };
  stopButton.onclick = () => sending(() => send({ stop: true }));

  chatSlot.replaceChildren(
    <form className="chat" onsubmit={submit}>
      {text}
      {sendButton}
      {stopButton}
      <p className="chat-hint">The agent sees messages the next time it checks in.</p>
      {error}
    </form>,
  );
}
