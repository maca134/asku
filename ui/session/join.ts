import { type Bytes, bindTag, checkFragment, deriveKeys, newKeyPair } from "../../shared/crypto";
import { homeLink, status } from "../page";
import { listen } from "./listen";
import { post } from "./send";
import { waitForAgent } from "./start";
import { load, type State, save } from "./storage";

// An answer link (/a/<sid>#<fragment>): resume the session stored in this browser, or check the agent's key against
// the fragment and bind to it.
export async function join(sid: string) {
  const fragment = location.hash.slice(1);
  if (fragment) history.replaceState(null, "", location.pathname); // keep the token out of history and screenshots

  const stored = await load(sid);
  if (stored && !stored.agentPub) return waitForAgent(sid, stored);
  const state = stored ?? (await bind(sid, fragment));
  if (!state) return;
  const keys = await deriveKeys(state.priv, Uint8Array.fromBase64(state.agentPub!));
  listen({ sid, keys, state });
}

const fail = (title: string, detail: string) => {
  status("error", title, detail, homeLink());
  return undefined;
};

async function bind(sid: string, fragment: string): Promise<State | undefined> {
  if (!fragment)
    return fail(
      "This link is incomplete",
      "Open it in the browser where you first opened it, or ask the agent for a new link.",
    );

  status("wait", "Verifying link…", "Checking the agent's key against the link.");
  const session = await fetch(`/s/${sid}`);
  if (session.status === 404) return fail("This session has ended or expired", "Ask the agent for a new link.");
  const { pub } = await session.json();
  let token: Bytes;
  try {
    token = await checkFragment(fragment, Uint8Array.fromBase64(pub));
  } catch {
    return fail("This link doesn't match its session", "It may have been altered. Ask the agent for a new link.");
  }

  const keyPair = await newKeyPair();
  const res = await post(`/s/${sid}/bind`, { pub: keyPair.pub.toBase64(), mac: await bindTag(token, keyPair.pub) });
  if (res.status === 409)
    return fail(
      "Already opened elsewhere",
      "This link was opened in another browser or device. Continue there, or ask the agent for a new link.",
    );
  if (!res.ok) return fail("Could not join the session", `The relay said ${res.status}.`);

  const state: State = { priv: keyPair.priv, agentPub: pub, key: (await res.json()).key, answered: [] };
  await save(sid, state);
  return state;
}
