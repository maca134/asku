// Browser side of asku: bind to the session, decrypt questions, render controls, send encrypted answers.
// Privacy-relevant code is in session/ (keys, binding, encrypt/decrypt) and ../shared/crypto.ts; the rest is UI.
// The landing page renders its demo and preview with the same form components, so they can't drift from the real UI.
import "./style.css";
import { copyable, homeLink, status } from "./page";
import { join } from "./session/join";
import { landing } from "./site/landing";

// An agent link (/j/<sid>#…) opened in a browser by mistake.
function agentLink() {
  const link = location.hash ? location.href : "";
  history.replaceState(null, "", location.pathname);
  status(
    "agent",
    "This link is for your agent",
    "Paste it into your chat with the AI agent, it can't be answered in a browser. The agent joins with the asku skill and sends its questions to the page you started from.",
    link && copyable(link, undefined, "Agent link"),
    <a className="btn btn-secondary" href="/">
      What is asku?
    </a>,
  );
}

async function main() {
  if (/^\/j\/[\w-]{22}$/.test(location.pathname)) return agentLink();
  const answer = location.pathname.match(/^\/a\/([\w-]{22})$/);
  if (answer) return join(answer[1]);
  landing();
}

main().catch((error) => status("error", "Something went wrong", error.message, homeLink()));
