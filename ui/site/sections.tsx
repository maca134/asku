// The sections the site's pages are made of.
import { codeSpans, h, icon } from "../dom";
import { field } from "../form/fields";
import { MOODS, moodLine } from "../form/form";
import { copyable, installLine, statePanel } from "../page";
import { sessionList } from "../session/sessions";
import { startCard } from "../session/start";
import type { Item, Mood } from "../types";
import { countdown, demo, showcase } from "./demo";
import { PAGES, TERMS } from "./pages";
import { SCENES } from "./scenes";

function sectionHead(title: string, lead: string, tag: "h1" | "h2" = "h2") {
  return (
    <div className="sec-head">
      {h(tag, null, title)}
      <p className="lead">{codeSpans(lead)}</p>
    </div>
  );
}

// a page's main heading, from PAGES
const pageHead = (path: string) => sectionHead(PAGES[path].h1, PAGES[path].lead, "h1");

const nextLink = (label: string, href: string) => (
  <div className="next">
    <a className="btn btn-primary btn-lg" href={href}>
      {label}
      {icon("arrow")}
    </a>
  </div>
);

const install = () => nextLink("Install the skill", "/install");

// "40+ sessions active in the last day", from the relay; nothing under 10 or if the fetch fails
function liveLine() {
  const line = <p className="live-count" />;
  fetch("/stats")
    .then((res) => res.json())
    .then(({ live }) => {
      if (live >= 10) line.textContent = `${live}+ sessions active in the last day`;
    })
    .catch(() => {});
  return line;
}

export const hero = () => (
  <section className="hero">
    <div className="wrap hero-copy">
      <h1>
        Your agent asks.
        <br />
        You answer from anywhere.
      </h1>
      <p className="lead">{codeSpans(PAGES["/"].lead)}</p>
      <div className="ctas">
        <a className="btn btn-primary btn-lg" href="/install">
          Install the skill
          {icon("arrow")}
        </a>
        <a className="btn btn-secondary btn-lg" href="/start">
          Already chatting? Get a link
        </a>
      </div>
      {liveLine()}
    </div>
    <div className="wrap">{demo()}</div>
  </section>
);

const step = (iconName: string, title: string, text: string) => (
  <li className="step">
    <span className="step-icon">{icon(iconName)}</span>
    <h3>{title}</h3>
    <p>{codeSpans(text)}</p>
  </li>
);

const steps = () => (
  <ol className="steps">
    {step(
      "terminal",
      "Your agent asks",
      "It writes a form as JSON and runs `ask.sh ask q.json`. A key pair is made on its machine.",
    )}
    {step("link", "You get a link", "The agent shows you a link. Open it on your phone, a tablet, or any browser.")}
    {step(
      "phone",
      "You answer",
      "Tap through yes/no, choices, dates, rankings and approvals. Add comments, or leave a question to the agent. It's encrypted before it leaves the page.",
    )}
    {step(
      "json",
      "It carries on",
      "`ask.sh wait` returns your answers as JSON. Follow-up questions land in the same tab.",
    )}
  </ol>
);

export const how = () => (
  <section className="sec" id="how">
    <div className="wrap">
      {pageHead("/how")}
      {steps()}
    </div>
  </section>
);

export const homeHow = () => (
  <section className="sec">
    <div className="wrap">
      {sectionHead("Four steps, no account", "A script on the agent's side and a web page on yours.")}
      {steps()}
    </div>
  </section>
);

const node = (iconName: string, title: string, detail: string, className = "") => (
  <div className={`node ${className}`}>
    <span className="node-icon">{icon(iconName)}</span>
    <strong>{title}</strong>
    <span className="node-sub">{detail}</span>
  </div>
);

const point = (iconName: string, title: string, text: string) => (
  <li className="point">
    <span className="point-icon">{icon(iconName)}</span>
    <div>
      <h3>{title}</h3>
      <p>{codeSpans(text)}</p>
    </div>
  </li>
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

const wire = () => (
  <div className="wire">
    <span className="packet" />
  </div>
);

export const security = () => (
  <section className="sec">
    <div className="wrap">
      {pageHead("/security")}
      <div className="flow" ariaHidden="true">
        {node("terminal", "Your agent", "key pair A")}
        {wire()}
        {node("server", "asku relay", "sees only 9f2c·e1a0·7bd4…", "relay")}
        {wire()}
        {node("phone", "Your browser", "key pair B")}
      </div>
      <ul className="points">
        {keysPoint()}
        {ciphertextPoint()}
        {point(
          "link",
          "The secret rides in the fragment",
          "The part of the link after `#` never reaches the server. The page checks the agent's key against it, then clears it from history.",
        )}
        {point(
          "server",
          "What you still trust",
          "The relay serves this page and the scripts, so whoever runs it could ship code that reads your answers. Compare `ask.sh` with its source on GitHub at the release tag, or run your own relay.",
        )}
        {point(
          "shield",
          "Small enough to audit",
          "bash + openssl, PowerShell + .NET and WebCrypto, all checked against the same test vectors. The whole thing is open source.",
        )}
      </ul>
      {install()}
    </div>
  </section>
);

export const homeSecurity = () => (
  <section className="sec">
    <div className="wrap">
      {sectionHead("The relay only sees ciphertext", "Encryption happens on your agent's machine and in your browser.")}
      <ul className="points">
        {keysPoint()}
        {ciphertextPoint()}
      </ul>
      <p className="more">
        <a href="/security">
          How the encryption works
          {icon("arrow")}
        </a>
      </p>
      {install()}
    </div>
  </section>
);

const FEATURES = [
  "Yes / no",
  "Big red button",
  "Pick one",
  "Pick several",
  "Write-in Other",
  "Text",
  "Number or slider",
  "Date and time",
  "Rank",
  "Approve / reject",
  "Conditional questions",
  "Markdown",
  "Comments",
  "Let the agent decide",
  "Deadlines",
  "Moods",
  "Note",
  "Progress bars",
  "Message or STOP the agent",
  "Push notifications",
];

export const controls = () => (
  <section className="sec sec-alt">
    <div className="wrap">
      <div className="split">
        <div className="split-copy">
          {sectionHead(
            "Built for answering with one thumb",
            "Agents get eight question types, markdown for context, deadlines and moods. Every question takes a comment, or can be left to the agent. Try it: this is the real form, and the panel shows exactly what your agent would receive.",
          )}
          <ul className="chips">
            {FEATURES.map((feature) => (
              <li>{feature}</li>
            ))}
          </ul>
        </div>
        {showcase()}
      </div>
    </div>
  </section>
);

// ids are prefixed so their radio groups can't meet the demo's
const GALLERY: Item[] = [
  { id: "ctl-go", type: "confirm", label: "Deploy v2.3 now?" },
  { id: "ctl-nuke", type: "confirm", display: "button", label: "Wipe the staging database" },
  {
    id: "ctl-env",
    type: "single",
    label: "Target",
    options: ["staging", { value: "prod", label: "Production", md: "Live traffic" }],
    default: "staging",
    other: true,
  },
  { id: "ctl-checks", type: "multi", label: "Run checks", options: ["lint", "test", "e2e"], min: 1 },
  {
    id: "ctl-steps",
    type: "review",
    label: "Migration steps",
    options: [
      "Drop old index",
      "Backfill column",
      { value: "lock", label: "Lock table", md: "Blocks writes for ~2 min" },
    ],
  },
  { id: "ctl-order", type: "rank", label: "Fix these first", options: ["Login bug", "Slow search", "Dark mode"] },
  { id: "ctl-when", type: "date", label: "Deploy window", time: true, default: "2026-11-03T09:30" },
  { id: "ctl-pct", type: "number", label: "Canary %", min: 0, max: 100, step: 5, default: 10 },
  { id: "ctl-share", type: "number", label: "Traffic share %", display: "slider", min: 0, max: 100, step: 5 },
  { id: "ctl-name", type: "text", label: "Release name", placeholder: "e.g. Autumn cleanup" },
  {
    id: "ctl-notes",
    type: "text",
    label: "Release notes",
    multiline: true,
    md: "Markdown works on forms, questions and options: **bold**, `code`, lists, tables.",
  },
];

const controlCard = (label: string, content: HTMLElement, className = "") => (
  <div className={`ctl ${className}`}>
    <code className="ctl-type">{label}</code>
    {content}
  </div>
);

function typeLabel(item: Item) {
  const flags = [
    item.type === "text" && item.multiline && "multiline",
    (item.type === "single" || item.type === "multi") && item.other && "other",
    item.type === "date" && item.time && "time",
    item.type === "number" && item.display === "slider" && "slider",
    item.type === "confirm" && item.display === "button" && "button",
  ].filter(Boolean);
  return [`type: ${item.type}`, ...flags].join(" · ");
}

// tap a chip and a sample question puts that mood on
function moodPicker() {
  const card = <div className="mood-demo" />;
  const chips = (Object.keys(MOODS) as Mood[]).map((mood) => (
    <button type="button" className="btn btn-secondary btn-sm" ariaPressed="false" onclick={() => pick(mood)}>
      "{mood}"
    </button>
  ));
  const pick = (mood: Mood) => {
    for (const chip of chips) chip.ariaPressed = String(chip.textContent === `"${mood}"`);
    card.className = `mood-demo mood-${mood}`;
    card.replaceChildren(
      moodLine(mood),
      field({ id: "ctl-mood", type: "confirm", label: "Ship it?" }, GALLERY.length).element,
      <button type="button" className="btn btn-primary btn-send">
        {icon("lock")}
        Send answers
      </button>,
    );
  };
  pick("nervous");
  return (
    <div>
      <h3>Mood</h3>
      <p className="fine">Changes how the form looks. Pick one.</p>
      <div className="clis mood-chips" role="group" ariaLabel="Mood">
        {chips}
      </div>
      {card}
    </div>
  );
}

export function gallery() {
  const clock = <span />;
  const section = (
    <section className="sec sec-alt">
      <div className="wrap">
        {sectionHead(
          "Every control, live",
          "The answer page's real code. Tap around: any question takes a comment, or can be left to the agent.",
        )}
        <div className="ctls">
          {GALLERY.map((item, i) => controlCard(typeLabel(item), field(item, i).element))}
          {controlCard(
            "form-level",
            <div className="card ctl-form">
              <div>
                <h3>Deadline</h3>
                <p className="fine">The page counts down. At zero the agent goes ahead without you.</p>
                {clock}
              </div>
              {moodPicker()}
            </div>,
            "ctl-wide",
          )}
        </div>
        {install()}
      </div>
    </section>
  );
  countdown(clock, 1800, () => clock.isConnected);
  return section;
}

export const faq = () => (
  <section className="sec">
    <div className="wrap narrow">
      {sectionHead("Questions people ask", "The short answers.")}
      <dl className="faq">
        {PAGES["/how"].faq!.map(([question, answer]) => [<dt>{question}</dt>, <dd>{codeSpans(answer)}</dd>])}
      </dl>
      {install()}
    </div>
  </section>
);

export const installation = () => (
  <section className="sec">
    <div className="wrap narrow">
      {pageHead("/install")}
      <div className="card install">
        <p className="card-label">Say this to your agent</p>
        {copyable(installLine(), "›")}
        <details className="manual">
          <summary>Or set it up by hand</summary>
          <p className="card-label">macOS / Linux · bash, curl, OpenSSL ≥ 1.1.1 or LibreSSL</p>
          {copyable(`curl -fsSLO ${location.origin}/ask.sh && chmod +x ask.sh`, "$")}
          <p className="card-label">Windows · PowerShell 5.1+, nothing else</p>
          {copyable(`iwr ${location.origin}/ask.ps1 -OutFile ask.ps1`, ">")}
          <p className="fine">
            {codeSpans("Then point your agent at `/skill.md` for the commands and the question format.")}
          </p>
        </details>
      </div>
      {nextLink("See it in action", "/demo")}
    </div>
  </section>
);

export function demos() {
  const stage = <div>{demo(SCENES[0])}</div>;
  const select = (chosen: number) => {
    tabs.forEach((tab, i) => {
      tab.ariaPressed = String(i === chosen);
    });
    stage.replaceChildren(demo(SCENES[chosen]));
  };
  const tabs = SCENES.map((scene, i) => (
    <button type="button" className="btn btn-secondary" ariaPressed={String(i === 0)} onclick={() => select(i)}>
      {scene.cli.name} · {scene.name}
    </button>
  ));
  return (
    <section className="sec">
      <div className="wrap">
        {pageHead("/demo")}
        <div className="clis" role="group" ariaLabel="Situation">
          {tabs}
        </div>
        {stage}
      </div>
    </section>
  );
}

export const start = () => (
  <section className="sec">
    <div className="wrap narrow">
      {pageHead("/start")}
      {startCard()}
    </div>
  </section>
);

export const sessions = () => (
  <section className="sec">
    <div className="wrap narrow">
      {pageHead("/sessions")}
      {sessionList()}
    </div>
  </section>
);

export const terms = () => (
  <section className="sec">
    <div className="wrap narrow">
      {pageHead("/terms")}
      <div className="terms">
        <p>{TERMS.intro}</p>
        {TERMS.sections.map(({ heading, text, points }) => [
          <h3>{heading}</h3>,
          text && <p>{text}</p>,
          points && (
            <ul>
              {points.map((point) => (
                <li>{codeSpans(point)}</li>
              ))}
            </ul>
          ),
        ])}
        <h3>Contact</h3>
        <p>
          <a href="mailto:maca134@googlemail.com">maca134@googlemail.com</a>
          {" · Source code: "}
          <a href="https://github.com/maca134/asku">github.com/maca134/asku</a>
          {" (MIT License)"}
        </p>
      </div>
    </div>
  </section>
);

export const missing = () => (
  <section className="sec">
    <div className="wrap narrow">
      {statePanel("error", "Page not found", "There's nothing at this address.")}
      {nextLink("Go home", "/")}
    </div>
  </section>
);
