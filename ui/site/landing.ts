// The site's pages (home, how, security, demo, install, start, terms), swapped without a reload.
import { app, h, icon, logo, p, rich, type Kid } from "../dom";
import { field } from "../form/fields";
import { MOODS, moodEl } from "../form/form";
import { copyable, installLine, stateEl } from "../page";
import { startCard } from "../session/start";
import type { Item, Mood } from "../types";
import { countdown, demo, SCENES, showcase } from "./demo";
import { PAGES } from "./pages";

const pages = Object.fromEntries(
  Object.entries(PAGES)
    .filter(([path]) => path !== "/")
    .map(([path, p]) => [path, p.nav]),
);
const next = (label: string, href: string) =>
  h("div", { className: "next" }, h("a", { className: "btn btn-primary btn-lg", href }, label, icon("arrow")));

export function landing() {
  const path = location.pathname;
  const nav = h(
    "nav",
    { className: "nav", ariaLabel: "Main" },
    ...Object.entries(pages)
      .filter(([href]) => href !== "/terms")
      .map(([href, textContent]) => h("a", { href, textContent, ...(href === path && { ariaCurrent: "page" }) })),
    h(
      "a",
      { href: "https://github.com/maca134/asku", className: "nav-gh", ariaLabel: "asku on GitHub" },
      icon("github"),
    ),
  );
  const header = h("header", { className: "site-header" }, h("div", { className: "wrap bar" }, logo("/"), nav));

  const hero = h(
    "section",
    { className: "hero" },
    h(
      "div",
      { className: "wrap hero-copy" },
      h(
        "p",
        { className: "pill" },
        icon("lock"),
        h("span", { textContent: "End-to-end encrypted · No account · Open source" }),
      ),
      h(
        "h1",
        {},
        "Your agent asks.",
        h("br"),
        h("span", { className: "grad", textContent: "You answer from anywhere." }),
      ),
      p(PAGES["/"].lead, "lead"),
      h(
        "div",
        { className: "ctas" },
        h("a", { className: "btn btn-primary btn-lg", href: "/install" }, "Install the skill", icon("arrow")),
        h("a", { className: "btn btn-secondary btn-lg", href: "/start" }, "Already chatting? Get a link"),
      ),
    ),
    h("div", { className: "wrap" }, demo()),
  );

  const step = (n: string, ico: string, title: string, text: string) =>
    h(
      "li",
      { className: "step" },
      h(
        "div",
        { className: "step-top" },
        h("span", { className: "step-icon" }, icon(ico)),
        h("span", { className: "step-n", textContent: n }),
      ),
      h("h3", { textContent: title }),
      p(text),
    );
  const steps = () =>
    h(
      "ol",
      { className: "steps" },
      step(
        "01",
        "terminal",
        "Your agent asks",
        "It writes a form as JSON and runs `ask.sh ask q.json`. A key pair is made on its machine.",
      ),
      step(
        "02",
        "link",
        "You get a link",
        "The agent shows you a link. Open it on your phone, a tablet, or any browser.",
      ),
      step(
        "03",
        "phone",
        "You answer",
        "Tap through yes/no, choices, text and numbers. Add comments. It's encrypted before it leaves the page.",
      ),
      step(
        "04",
        "json",
        "It carries on",
        "`ask.sh wait` returns your answers as JSON. Follow-up questions land in the same tab.",
      ),
    );
  const how = h(
    "section",
    { className: "sec", id: "how" },
    h("div", { className: "wrap" }, head("How it works", "/how"), steps()),
  );
  const homeHow = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap" },
      sub("How it works", "Four steps, no account", "A script on the agent's side and a web page on yours."),
      steps(),
    ),
  );

  const node = (ico: string, title: string, sub: string, cls = "") =>
    h(
      "div",
      { className: `node ${cls}` },
      h("span", { className: "node-icon" }, icon(ico)),
      h("strong", { textContent: title }),
      h("span", { className: "node-sub", textContent: sub }),
    );
  const point = (ico: string, title: string, text: string) =>
    h(
      "li",
      { className: "point" },
      h("span", { className: "point-icon" }, icon(ico)),
      h("div", {}, h("h3", { textContent: title }), p(text)),
    );
  const keysPoint = () =>
    point(
      "key",
      "Keys stay on the endpoints",
      "P-256 key pairs are made on the agent's machine and in your browser, where the private key is non-extractable.",
    );
  const ciphertextPoint = () =>
    point(
      "lock",
      "Ciphertext only",
      "Every message is AES-256-CBC with an HMAC-SHA256 tag, checked before decrypting. Sessions are purged on close or after 24h idle.",
    );
  const security = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap" },
      head("Security", "/security"),
      h(
        "div",
        { className: "flow", ariaHidden: "true" },
        node("terminal", "Your agent", "key pair A"),
        h("div", { className: "wire" }, h("span", { className: "packet" })),
        node("server", "asku relay", "sees only 9f2c·e1a0·7bd4…", "relay"),
        h("div", { className: "wire" }, h("span", { className: "packet" })),
        node("phone", "Your browser", "key pair B"),
      ),
      h(
        "ul",
        { className: "points" },
        keysPoint(),
        ciphertextPoint(),
        point(
          "link",
          "The secret rides in the fragment",
          "The part of the link after `#` never reaches the server. The page checks the agent's key against it, then clears it from history.",
        ),
        point(
          "server",
          "What you still trust",
          "The relay serves this page and the scripts, so whoever runs it could ship code that reads your answers. Compare `ask.sh` with its source on GitHub at the release tag, or run your own relay.",
        ),
        point(
          "shield",
          "Small enough to audit",
          "bash + openssl, PowerShell + .NET and WebCrypto, all checked against the same test vectors. The whole thing is open source.",
        ),
      ),
      next("Install the skill", "/install"),
    ),
  );
  const homeSecurity = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap" },
      sub(
        "Security",
        "The relay only sees ciphertext",
        "Encryption happens on your agent's machine and in your browser.",
      ),
      h("ul", { className: "points" }, keysPoint(), ciphertextPoint()),
      h("p", { className: "more" }, h("a", { href: "/security" }, "How the encryption works", icon("arrow"))),
      next("Install the skill", "/install"),
    ),
  );

  const controls = h(
    "section",
    { className: "sec sec-alt" },
    h(
      "div",
      { className: "wrap" },
      h(
        "div",
        { className: "split" },
        h(
          "div",
          { className: "split-copy" },
          sub(
            "The form",
            "Built for answering with one thumb",
            "Agents get five controls, markdown for context, deadlines and moods. Every question takes a comment, or can be left to the agent. Try it: this is the real form, and the panel shows exactly what your agent would receive.",
          ),
          h(
            "ul",
            { className: "chips" },
            ...[
              "Yes / no",
              "Pick one",
              "Pick several",
              "Text",
              "Number",
              "Markdown",
              "Comments",
              "Let the agent decide",
              "Deadlines",
              "Moods",
              "Note",
            ].map((c) => h("li", { textContent: c })),
          ),
        ),
        showcase(),
      ),
    ),
  );

  // the real controls, straight on the page; ids are prefixed so their radio groups can't meet the demo's
  const ctl = (code: string, kid: Kid, cls = "") =>
    h("div", { className: `ctl ${cls}` }, h("code", { className: "ctl-type", textContent: code }), kid);
  const CTLS: Item[] = [
    { id: "ctl-go", type: "confirm", label: "Deploy v2.3 now?" },
    {
      id: "ctl-env",
      type: "single",
      label: "Target",
      options: ["staging", { value: "prod", label: "Production", md: "Live traffic" }],
      default: "staging",
    },
    { id: "ctl-checks", type: "multi", label: "Run checks", options: ["lint", "test", "e2e"], min: 1 },
    { id: "ctl-pct", type: "number", label: "Canary %", min: 0, max: 100, step: 5, default: 10 },
    { id: "ctl-name", type: "text", label: "Release name", placeholder: "e.g. Autumn cleanup" },
    {
      id: "ctl-notes",
      type: "text",
      label: "Release notes",
      multiline: true,
      md: "Markdown works on forms, questions and options: **bold**, `code`, lists, tables.",
    },
  ];
  // moods: tap a chip and a sample question puts it on
  const moodCard = h("div", { className: "mood-demo" });
  const moodChips = (Object.keys(MOODS) as Mood[]).map((m) =>
    h("button", {
      type: "button",
      className: "btn btn-secondary btn-sm",
      textContent: `"${m}"`,
      ariaPressed: "false",
      onclick: () => setMood(m),
    }),
  );
  const setMood = (m: Mood) => {
    moodChips.forEach((c) => {
      c.ariaPressed = String(c.textContent === `"${m}"`);
    });
    moodCard.className = `mood-demo mood-${m}`;
    moodCard.replaceChildren(
      moodEl(m),
      field({ id: "ctl-mood", type: "confirm", label: "Ship it?" }, CTLS.length).el,
      h("button", { type: "button", className: "btn btn-primary btn-send" }, icon("lock"), "Send answers"),
    );
  };
  setMood("nervous");
  const clockAt = h("span");
  const gallery = h(
    "section",
    { className: "sec sec-alt" },
    h(
      "div",
      { className: "wrap" },
      sub(
        "Controls",
        "Every control, live",
        "The answer page's real code. Tap around: any question takes a comment, or can be left to the agent.",
      ),
      h(
        "div",
        { className: "ctls" },
        ...CTLS.map((it, i) =>
          ctl(`type: ${it.type}${it.type === "text" && it.multiline ? " · multiline" : ""}`, field(it, i).el),
        ),
        ctl(
          "form-level",
          h(
            "div",
            { className: "card ctl-form" },
            h(
              "div",
              {},
              h("h3", { textContent: "Deadline" }),
              p("The page counts down. At zero the agent goes ahead without you.", "fine"),
              clockAt,
            ),
            h(
              "div",
              {},
              h("h3", { textContent: "Mood" }),
              p("Changes how the form looks. Pick one.", "fine"),
              h("div", { className: "clis mood-chips", role: "group", ariaLabel: "Mood" }, ...moodChips),
              moodCard,
            ),
          ),
          "ctl-wide",
        ),
      ),
      next("Install the skill", "/install"),
    ),
  );
  countdown(clockAt, 1800, () => clockAt.isConnected);

  const faq = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap narrow" },
      sub("FAQ", "Questions people ask", "The short answers."),
      h(
        "dl",
        { className: "faq" },
        ...PAGES["/how"].faq!.flatMap(([q, a]) => [h("dt", { textContent: q }), h("dd", {}, ...rich(a))]),
      ),
      next("Install the skill", "/install"),
    ),
  );

  const install = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap narrow" },
      head("Install", "/install"),
      h(
        "div",
        { className: "card install" },
        h("p", { className: "card-label", textContent: "Say this to your agent" }),
        copyable(installLine(), "›"),
        h(
          "details",
          { className: "manual" },
          h("summary", { textContent: "Or set it up by hand" }),
          h("p", { className: "card-label", textContent: "macOS / Linux · bash, curl, OpenSSL ≥ 1.1.1" }),
          copyable(`curl -fsSLO ${location.origin}/ask.sh && chmod +x ask.sh`, "$"),
          h("p", { className: "card-label", textContent: "Windows · PowerShell 5.1+, nothing else" }),
          copyable(`iwr ${location.origin}/ask.ps1 -OutFile ask.ps1`, ">"),
          p("Then point your agent at `/skill.md` for the commands and the question format.", "fine"),
        ),
      ),
      next("See it in action", "/demo"),
    ),
  );

  const stage = h("div", {}, demo(SCENES[0]));
  const tabs = SCENES.map((sc) =>
    h("button", {
      type: "button",
      className: "btn btn-secondary",
      textContent: `${sc.cli.name} · ${sc.name}`,
      ariaPressed: String(sc === SCENES[0]),
    }),
  );
  tabs.forEach(
    (t, i) =>
      (t.onclick = () => {
        tabs.forEach((x) => {
          x.ariaPressed = String(x === t);
        });
        stage.replaceChildren(demo(SCENES[i]));
      }),
  );
  const demos = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap" },
      head("Demo", "/demo"),
      h("div", { className: "clis", role: "group", ariaLabel: "Situation" }, ...tabs),
      stage,
    ),
  );

  const start = h(
    "section",
    { className: "sec" },
    h("div", { className: "wrap narrow" }, head("Start here", "/start"), startCard()),
  );

  const ul = (...items: string[]) => h("ul", {}, ...items.map((t) => h("li", {}, ...rich(t))));
  const terms = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap narrow" },
      head("Terms", "/terms"),
      h(
        "div",
        { className: "terms" },
        p(
          'asku.dev ("the service") is a free relay that passes end-to-end encrypted messages between an AI agent and a web browser. It is run by Matthew McConnell as a hobby project. By using it you agree to these terms.',
        ),
        h("h3", { textContent: "Your responsibility" }),
        ul(
          "A session is meant for the person running the agent. You are responsible for who you share a session link with. Anyone who opens the link first controls that session.",
          "You are responsible for what your agent does, including anything it does with the answers it receives.",
          "You must follow the terms of your AI provider and of any other service your agent uses.",
        ),
        h("h3", { textContent: "Acceptable use" }),
        p("Don't use the service to:"),
        ul(
          "break the law or infringe anyone's rights,",
          "send malware, spam or content meant to harass or harm people,",
          "overload, probe or attack the relay, or get around its rate limits,",
          "run a service for third parties on top of it without permission.",
        ),
        h("h3", { textContent: "What we can and can't see" }),
        ul(
          "Questions and answers are encrypted on your devices. The relay can't read them.",
          "The relay does see metadata: IP addresses, timestamps, session IDs and message sizes. It uses these to run the service and stop abuse.",
          "Sessions are deleted when the agent closes them or after 24 hours without activity.",
          "We may keep basic server logs for up to 30 days.",
        ),
        h("h3", { textContent: "Enforcement" }),
        p(
          "We may rate-limit, end or block sessions or clients at any time, without notice, to protect the service or other users.",
        ),
        h("h3", { textContent: "No warranty" }),
        p(
          'The service is provided "as is", without any warranty. It may be slow, unavailable or lose messages. Don\'t rely on it for anything critical. To the extent the law allows, we are not liable for any loss arising from your use of it.',
        ),
        h("h3", { textContent: "Changes" }),
        p("We may update these terms. Continuing to use the service means you accept the current version."),
        h("h3", { textContent: "Contact" }),
        h(
          "p",
          {},
          h("a", { href: "mailto:maca134@googlemail.com", textContent: "maca134@googlemail.com" }),
          " · Source code: ",
          h("a", { href: "https://github.com/maca134/asku", textContent: "github.com/maca134/asku" }),
          " (MIT License)",
        ),
      ),
    ),
  );

  const footer = h(
    "footer",
    { className: "site-footer" },
    h(
      "div",
      { className: "wrap foot" },
      h(
        "div",
        { className: "foot-brand" },
        logo("/"),
        h("span", { textContent: "Encrypted questions from AI agents to you." }),
      ),
      h(
        "nav",
        { className: "foot-links", ariaLabel: "Footer" },
        h("a", { href: "https://github.com/maca134/asku" }, icon("github"), "GitHub"),
        h("a", { href: "/skill.md", textContent: "SKILL.md" }),
        h("a", { href: "/schema.json", textContent: "schema.json" }),
        h("a", { href: "https://github.com/maca134/asku/blob/main/LICENSE", textContent: "MIT License" }),
        h("a", { href: "/terms", textContent: "Terms" }),
      ),
    ),
  );

  const missing = h(
    "section",
    { className: "sec" },
    h(
      "div",
      { className: "wrap narrow" },
      stateEl("error", "Page not found", "There's nothing at this address."),
      next("Go home", "/"),
    ),
  );
  const body = {
    "/": [hero, homeHow, controls, homeSecurity],
    "/how": [how, faq],
    "/security": [security],
    "/demo": [demos, gallery],
    "/install": [install],
    "/start": [start],
    "/terms": [terms],
  }[path] ?? [missing];
  document.title = PAGES[path]?.title ?? "Not found · asku";
  app.replaceChildren(header, h("main", { className: "landing" }, ...body), footer);
}

// Links between the site's pages swap the page without a reload.
document.addEventListener("click", (e) => {
  const a = (e.target as Element).closest?.("a");
  if (!a || !document.querySelector(".landing") || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || !(url.pathname === "/" || url.pathname in pages)) return;
  e.preventDefault();
  if (url.pathname !== location.pathname) history.pushState(null, "", url.pathname);
  landing();
  scrollTo(0, 0);
});
addEventListener("popstate", () => {
  if (document.querySelector(".landing")) landing();
});

// A page's main heading, from PAGES; sub() for the sections after it.
const head = (eyebrow: string, path: string) => sub(eyebrow, PAGES[path].h1, PAGES[path].lead, "h1");
function sub(eyebrow: string, title: string, lead: string, tag: "h1" | "h2" = "h2") {
  return h(
    "div",
    { className: "sec-head" },
    h("p", { className: "eyebrow", textContent: eyebrow }),
    h(tag, { textContent: title }),
    p(lead, "lead"),
  );
}
