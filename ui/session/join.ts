import { bindTag, type Bytes, checkFragment, deriveKeys, newKeyPair } from "../../shared/crypto";
import { home, status } from "../page";
import { listen } from "./listen";
import { post } from "./send";
import { waitForAgent } from "./start";
import { load, save } from "./storage";

// An answer link (/a/<sid>#<fragment>): resume the session stored in this browser, or check the agent's key against
// the fragment and bind to it.
export async function join(sid: string) {
  const frag = location.hash.slice(1);
  if (frag) history.replaceState(null, "", location.pathname); // keep the token out of history and screenshots

  let state = await load(sid);
  if (state && !state.agentPub) return waitForAgent(sid, state);
  if (!state) {
    if (!frag)
      return status(
        "error",
        "This link is incomplete",
        "Open it in the browser where you first opened it, or ask the agent for a new link.",
        home(),
      );
    status("wait", "Verifying link…", "Checking the agent's key against the link.");
    const res = await fetch(`/s/${sid}`);
    if (res.status === 404)
      return status("error", "This session has ended or expired", "Ask the agent for a new link.", home());
    const { pub } = await res.json();
    const agentPub = Uint8Array.fromBase64(pub);
    let token: Bytes;
    try {
      token = await checkFragment(frag, agentPub);
    } catch {
      return status(
        "error",
        "This link doesn't match its session",
        "It may have been altered. Ask the agent for a new link.",
        home(),
      );
    }
    const b = await newKeyPair();
    const res2 = await post(`/s/${sid}/bind`, { pub: b.pub.toBase64(), mac: await bindTag(token, b.pub) });
    if (res2.status === 409)
      return status(
        "error",
        "Already opened elsewhere",
        "This link was opened in another browser or device. Continue there, or ask the agent for a new link.",
        home(),
      );
    if (!res2.ok) return status("error", "Could not join the session", `The relay said ${res2.status}.`, home());
    state = { priv: b.priv, agentPub: pub, key: (await res2.json()).key, answered: [] };
    await save(sid, state);
  }
  listen(sid, await deriveKeys(state.priv, Uint8Array.fromBase64(state.agentPub!)), state);
}
