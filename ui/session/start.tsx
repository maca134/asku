// The reverse flow: the user starts a session here and hands the agent a link.
import { type Bytes, checkBind, deriveKeys, fragmentFor, newKeyPair } from "../../shared/crypto";
import { h, icon, sleep } from "../dom";
import { copyable, installLine, live, newSessionLink, show, status } from "../page";
import { listen } from "./listen";
import { post, sendAnswer } from "./send";
import { drop, type State, save } from "./storage";

export function startCard() {
  const note = h("textarea", {
    rows: 4,
    maxLength: 10000,
    className: "input",
    placeholder: "e.g. Review my open PR and ask me anything you need to decide.",
  });
  const error = <p className="form-err" role="alert" />;
  const button = h(
    "button",
    { type: "submit", className: "btn btn-primary btn-lg" },
    icon("link"),
    "Create a link for my agent",
  );

  const create = async (event: SubmitEvent) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const { sid, state } = await createSession(note.value.trim());
      history.replaceState(null, "", `/a/${sid}`);
      scrollTo(0, 0);
      await waitForAgent(sid, state);
    } catch (e) {
      error.textContent = `Could not start: ${(e as Error).message}`;
      button.disabled = false;
    }
  };

  return (
    <form className="card start" onsubmit={create}>
      <label className="field">
        <span className="card-label">
          Message for the agent
          <span className="opt-tag">Optional</span>
        </span>
        {note}
      </label>
      {error}
      {button}
      <p className="fine">Your browser makes the keys. The message is encrypted before it's sent.</p>
    </form>
  );
}

async function createSession(note: string) {
  const keyPair = await newKeyPair();
  const browserPub = keyPair.pub.toBase64();
  const res = await post("/s", { pub: browserPub, role: "browser" });
  if (!res.ok)
    throw new Error(
      res.status === 429 ? "too many new sessions from this network, try again later" : `relay said ${res.status}`,
    );
  const { sid, key } = await res.json();
  const token = crypto.getRandomValues(new Uint8Array(16)).toHex();
  const state: State = { priv: keyPair.priv, key, answered: [], browserPub, token, note };
  await save(sid, state);
  return { sid: sid as string, state };
}

export async function waitForAgent(sid: string, state: State) {
  const token = Uint8Array.fromHex(state.token!);
  const link = `${location.origin}/j/${sid}#${await fragmentFor(Uint8Array.fromBase64(state.browserPub!), token)}`;
  show(
    <section className="panel">
      <div className="state-icon agent">{icon("link")}</div>
      <h1>Give this link to your agent</h1>
      <p className="state-detail">
        Paste it into your chat with the agent. It joins with the asku skill and asks its questions right here.
      </p>
      {copyable(link, undefined, "Agent link")}
      {live("Waiting for your agent to join…")}
      <div className="tip">
        <p className="card-label">Agent doesn't have the skill yet? Tell it:</p>
        {copyable(installLine(), "›")}
      </div>
    </section>,
  );

  for (;;) {
    const res = await fetch(`/s/${sid}/bind`).catch(() => null);
    if (res?.status === 404)
      return status("error", "This session has expired", "Start a new one to keep going.", newSessionLink());
    if (res?.status === 200) return agentJoined(sid, state, token, await res.json());
    if (res?.status !== 204) await sleep(2000);
  }
}

// Check the agent holds the token from the link, then send the user's opening note as answer 0.
async function agentJoined(sid: string, state: State, token: Bytes, { pub, mac }: { pub: string; mac: string }) {
  if (!(await checkBind(token, Uint8Array.fromBase64(pub), mac))) {
    drop(sid);
    return status(
      "error",
      "This session is not safe",
      "Something other than your agent used the link. Start a new one.",
      newSessionLink(),
    );
  }
  const keys = await deriveKeys(state.priv, Uint8Array.fromBase64(pub));
  await sendAnswer({ sid, keys, state }, [0], { note: state.note ?? "" });
  const joined: State = { priv: state.priv, key: state.key, answered: state.answered, agentPub: pub };
  await save(sid, joined);
  return listen({ sid, keys, state: joined });
}
