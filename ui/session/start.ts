import { checkBind, deriveKeys, fragmentFor, newKeyPair } from "../../shared/crypto";
import { h, icon, p, sleep } from "../dom";
import { copyable, installLine, live, show, startNew, status } from "../page";
import { listen } from "./listen";
import { post, send } from "./send";
import { drop, save, type State } from "./storage";

// ---- reverse flow: the user starts a session here and hands the agent a link
export function startCard() {
  const note = h("textarea", { rows: 4, maxLength: 10000, className: "input", placeholder: "e.g. Review my open PR and ask me anything you need to decide." });
  const err = h("p", { className: "form-err", role: "alert" });
  const btn = h("button", { type: "submit", className: "btn btn-primary btn-lg" }, icon("link"), "Create a link for my agent");
  const form = h("form", { className: "card start" },
    h("label", { className: "field" }, h("span", { className: "card-label" }, "Message for the agent", h("span", { className: "opt-tag", textContent: "Optional" })), note),
    err, btn,
    p("Your browser makes the keys. The message is encrypted before it's sent.", "fine"));
  form.onsubmit = async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      const b = await newKeyPair();
      const pubB = b.pub.toBase64();
      const res = await post("/s", { pub: pubB, role: "browser" });
      if (!res.ok) throw new Error(res.status === 429 ? "too many new sessions from this network, try again later" : `relay said ${res.status}`);
      const { sid, key } = await res.json();
      const st: State = { priv: b.priv, key, answered: [], pubB, T: crypto.getRandomValues(new Uint8Array(16)).toHex(), note: note.value.trim() };
      await save(sid, st);
      history.replaceState(null, "", `/a/${sid}`);
      scrollTo(0, 0);
      await waitForAgent(sid, st);
    } catch (x) {
      err.textContent = `Could not start: ${(x as Error).message}`;
      btn.disabled = false;
    }
  };
  return form;
}

export async function waitForAgent(sid: string, st: State) {
  const token = Uint8Array.fromHex(st.T!);
  const link = `${location.origin}/j/${sid}#${await fragmentFor(Uint8Array.fromBase64(st.pubB!), token)}`;
  show(h("section", { className: "panel" },
    h("div", { className: "state-icon agent" }, icon("link")),
    h("h1", { textContent: "Give this link to your agent" }),
    p("Paste it into your chat with the agent. It joins with the asku skill (`ask join <link>`) and asks its questions right here.", "state-detail"),
    copyable(link, undefined, "Agent link"),
    live("Waiting for your agent to join…"),
    h("div", { className: "tip" }, h("p", { className: "card-label", textContent: "Agent doesn't have the skill yet? Tell it:" }), copyable(installLine(), "›"))));

  for (;;) {
    const res = await fetch(`/s/${sid}/bind`).catch(() => null);
    if (res?.status === 404) return status("error", "This session has expired", "Start a new one to keep going.", startNew());
    if (res?.status === 200) {
      const { pub, mac } = await res.json();
      if (!(await checkBind(token, Uint8Array.fromBase64(pub), mac))) {
        drop(sid);
        return status("error", "This session is not safe", "Something other than your agent used the link. Start a new one.", startNew());
      }
      const keys = await deriveKeys(st.priv, Uint8Array.fromBase64(pub));
      await send(sid, keys, st, [0], { note: st.note ?? "" }); // the opening note is answer 0
      const joined: State = { priv: st.priv, key: st.key, answered: st.answered, pubA: pub };
      await save(sid, joined);
      return listen(sid, keys, joined);
    }
    if (res?.status !== 204) await sleep(2000);
  }
}
