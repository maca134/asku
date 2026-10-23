import example from "../../examples/question.json";
import { h, icon, md, rich, sleep, type Kid } from "../dom";
import { buildForm } from "../form/form";
import { sentState } from "../form/render";
import { hms, shell, stateEl } from "../page";
import type { Question } from "../types";

// ---- landing demos

// Pretty JSON as DOM nodes with highlight spans (built from text nodes, so typed input can't inject markup).
function jsonNodes(v: unknown) {
  const s = JSON.stringify(v, null, 2).replace(
    /\[\n\s*([^[\]{}]*?)\n\s*\]/g,
    (_, inner: string) => `[${inner.split(/,\n\s*/).join(", ")}]`,
  );
  const out: Node[] = [];
  let last = 0;
  for (const m of s.matchAll(/("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    out.push(document.createTextNode(s.slice(last, m.index)));
    const cls = m[1] ? (m[2] ? "j-key" : "j-str") : /[\d-]/.test(m[0][0]) ? "j-num" : "j-lit";
    out.push(h("span", { className: cls, textContent: m[1] ?? m[0] }));
    if (m[2]) out.push(document.createTextNode(m[2]));
    last = m.index! + m[0].length;
  }
  out.push(document.createTextNode(s.slice(last)));
  return out;
}

const DEMO_URL = "asku.dev/a/k3J9xQ2mVb7LrT0aYc1E-w";

function phone(url: Node, screen: HTMLElement, ...over: Kid[]) {
  return h(
    "div",
    { className: "phone" },
    h(
      "div",
      { className: "phone-screen" },
      h(
        "div",
        { className: "phone-status", ariaHidden: "true" },
        h("span", { textContent: "9:41" }),
        h("span", { className: "phone-island" }),
        h("span", { className: "phone-bars" }),
      ),
      h("div", { className: "phone-url", ariaHidden: "true" }, icon("lock"), url),
      screen,
      ...over,
    ),
  );
}

// A deadline's countdown, as on the answer page (put before `at`), on a pretend clock that never runs out.
export function countdown(at: Element, secs: number, alive: () => boolean, moving = () => true) {
  const text = () => `The agent decides without you in ${hms(secs)}`;
  const span = h("span", { textContent: text() });
  at.before(h("p", { className: "countdown" }, icon("clock"), span));
  const t = setInterval(() => {
    if (!alive()) return clearInterval(t);
    if (moving() && secs > 1) {
      secs--;
      span.textContent = text();
    }
  }, 1000);
}

// The real form, lightly interactive, next to the JSON it would send.
export function showcase() {
  const f = buildForm({ ...example, mood: "confident" } as Question);
  countdown(f.fields[0].el, 1800, () => out.isConnected);
  const out = h("pre", { className: "json", ariaLive: "polite", ariaLabel: "Answer JSON" });
  const update = () => out.replaceChildren(...jsonNodes(f.collect(false).a));
  f.form.addEventListener("input", update);
  f.form.addEventListener("change", update);
  f.form.onsubmit = (e) => {
    e.preventDefault();
    const { problems } = f.collect();
    update();
    if (!problems.length) f.err.textContent = "Looks good. For real, this is encrypted and sent to your agent.";
    f.err.classList.toggle("ok", !problems.length);
  };
  update();
  const screen = h("div", { className: "screen-scroll" }, shell([f.form], "div"));
  return h(
    "div",
    { className: "showcase" },
    phone(document.createTextNode(DEMO_URL), screen),
    h(
      "div",
      { className: "term term-sm" },
      h(
        "div",
        { className: "term-bar" },
        h("span", { className: "dots" }),
        h("span", { className: "term-title", textContent: "ask.sh wait → stdout" }),
      ),
      h("div", { className: "term-body" }, out),
    ),
  );
}

// How each agent CLI draws its chat (approximated with text and colours, no logos).
type Cli = { id: string; name: string; title: string; say: string; tool: string; run: (c: string) => string };
const SHELL: Cli = { id: "shell", name: "Any agent", title: "agent — ~/shop", say: "● ", tool: "$ ", run: (c) => c };
const CLAUDE: Cli = {
  id: "claude",
  name: "Claude Code",
  title: "claude — ~/shop",
  say: "● ",
  tool: "● ",
  run: (c) => `Bash(${c})`,
};
const CODEX: Cli = {
  id: "codex",
  name: "Codex CLI",
  title: "codex — ~/shop",
  say: "• ",
  tool: "• ",
  run: (c) => `Ran ${c}`,
};
const GEMINI: Cli = {
  id: "gemini",
  name: "Gemini CLI",
  title: "gemini — ~/shop",
  say: "✦ ",
  tool: "✔ ",
  run: (c) => `Shell ${c}`,
};

// One demo run: what you ask, the form, an optional `ask say` update and `ask add` follow-up, your taps on the phone, and what the agent does next.
type Act =
  | ["pick", string, string]
  | ["up", string, number]
  | ["comment", string, string]
  | ["text", string, string]
  | ["dice", string, ""];
type Scene = {
  name: string;
  cli: Cli;
  cap: string;
  you: string;
  intro: string;
  file: string;
  q: Question;
  say?: string;
  add?: { say: string; file: string; q: Question };
  acts: Act[];
  after: string;
  cmd: string;
  done: string;
};
const DEPLOY: Scene = {
  name: "Sign off a deploy",
  cli: SHELL,
  cap: "An agent asks for sign-off with `ask.sh`, you answer on your phone, it gets JSON back.",
  you: "Ship v2.3 once I've signed off. I'm heading out, ask me on my phone.",
  intro: "I'll send you the deploy plan to approve.",
  file: "deploy.json",
  q: example as Question,
  acts: [
    ["pick", "go", "yes"],
    ["pick", "env", "prod"],
    ["pick", "checks", "lint"],
    ["pick", "checks", "test"],
    ["up", "pct", 3],
    ["comment", "pct", "Keep it low on Fridays"],
  ],
  after: "Approved: Production, 25% canary, after lint and test. You noted Fridays, so I'll hold it at 25%.",
  cmd: "./deploy.sh v2.3 --env prod --canary 25",
  done: "v2.3 is live on 25% of production traffic",
};
export const SCENES: Scene[] = [
  {
    ...DEPLOY,
    cli: CLAUDE,
    cap: "In Claude Code: sign-off before it ships, a progress update with `say`, and a question added while you answer.",
    q: { ...example, mood: "confident" } as Question,
    say: "Build is green: **214** tests passed",
    add: {
      say: "One more thing while you're in there.",
      file: "notify.json",
      q: {
        title: "Afterwards",
        questions: [{ id: "notify", type: "confirm", label: "Post in #releases when it's live?" }],
      },
    },
    acts: [...DEPLOY.acts, ["pick", "notify", "yes"]],
    after:
      "Approved: Production, 25% canary, after lint and test. You noted Fridays, so I'll hold it at 25% and post in #releases.",
  },
  {
    name: "Plan a feature",
    cli: CODEX,
    cap: "In Codex CLI: the design gets settled up front, and what you don't mind you leave to the agent.",
    you: "Add CSV export to the reports page. I'm in meetings all afternoon, ask me what you need.",
    intro: "A few choices before I start building.",
    file: "export.json",
    q: {
      title: "CSV export",
      md: "Reports page, **14 columns**, up to 50k rows.",
      questions: [
        {
          id: "rows",
          type: "single",
          label: "Which rows?",
          options: [
            { value: "filtered", label: "Current filters", md: "What's on screen" },
            { value: "all", label: "Everything" },
          ],
          default: "filtered",
        },
        {
          id: "cols",
          type: "multi",
          label: "Columns",
          options: ["date", "customer", "amount", "status", "notes"],
          default: ["date", "customer", "amount"],
        },
        { id: "email", type: "confirm", label: "Email a link for exports over 10k rows?" },
      ],
    },
    add: {
      say: "Spotted one more: amounts are stored in cents.",
      file: "amounts.json",
      q: {
        title: "Amounts",
        questions: [
          {
            id: "money",
            type: "single",
            label: "Show amounts as",
            options: [
              { value: "decimal", label: "12.34" },
              { value: "cents", label: "1234 (raw cents)" },
            ],
          },
        ],
      },
    },
    acts: [
      ["pick", "cols", "status"],
      ["pick", "email", "yes"],
      ["comment", "email", "Send from reports@"],
      ["dice", "money", ""],
    ],
    after:
      "Got it: current filters, 4 columns, and big exports go out by email from reports@. You left amounts to me: decimals, as on the page. Building it now.",
    cmd: "npm test -- export",
    done: "12 passed: CSV export",
  },
  {
    name: "Unblock a migration",
    cli: GEMINI,
    cap: "In Gemini CLI: a risky case waits for your call, with a deadline so the job can't stall all night.",
    you: "Migrate the users table to the new schema tonight. Don't guess on anything risky.",
    intro: "312 users share an email with another account. I need a call on these before I migrate.",
    file: "dupes.json",
    q: {
      title: "Duplicate accounts",
      mood: "nervous",
      deadline: 1800,
      md: "**312** users share an email with another account. No answer in 30 min and I'll skip them and migrate the rest.",
      questions: [
        {
          id: "merge",
          type: "single",
          label: "Merge each group into",
          options: [
            { value: "recent", label: "Most recent login" },
            { value: "oldest", label: "Oldest account" },
            { value: "skip", label: "Skip them, migrate the rest" },
          ],
        },
        { id: "snapshot", type: "confirm", label: "Snapshot the table first?" },
        { id: "batch", type: "number", label: "Batch size", min: 100, max: 5000, step: 100, default: 500 },
      ],
    },
    add: {
      say: "Also: 9 accounts have no email at all.",
      file: "no-email.json",
      q: {
        title: "No email",
        questions: [
          { id: "noEmail", type: "text", label: "What should I do with these 9?", placeholder: "e.g. archive them" },
        ],
      },
    },
    acts: [
      ["pick", "merge", "recent"],
      ["pick", "snapshot", "yes"],
      ["up", "batch", 3],
      ["text", "noEmail", "Archive them, I'll look Monday"],
    ],
    after: "Merging into the most recent login, snapshot first, 800 rows a batch. Archiving the 9 with no email.",
    cmd: "bun run migrate --snapshot --batch 800",
    done: "48,213 users migrated · 312 merged · 9 archived",
  },
];

// Animated centrepiece: the agent asks in a terminal, the phone answers, the JSON comes back. Loops.
// Scenes with a follow-up append it with `ask add` while the form is open.
export function demo(sc = DEPLOY) {
  const { cli, add } = sc;
  const term = h("div", { className: "term-body" });
  const url = h("span", { className: "url-text" });
  const scroller = h("div", { className: "screen-scroll" });
  const tap = h("span", { className: "tap" });
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let paused = false,
    visible = true,
    gen = 0,
    first = true; // the first run opens on the prompt, not a blank terminal
  const STOP = Symbol();

  const toggle = h("button", { type: "button", className: "demo-toggle" });
  const setToggle = () => toggle.replaceChildren(icon(paused ? "play" : "pause"), paused ? "Play" : "Pause");
  toggle.onclick = () => {
    paused = !paused;
    setToggle();
  };
  setToggle();

  const root = h(
    "figure",
    { className: `demo cli-${cli.id}` },
    h("figcaption", { className: "demo-cap" }, h("span", {}, ...rich(sc.cap)), still ? null : toggle),
    h(
      "div",
      { className: "demo-stage", ariaHidden: "true", inert: true },
      h(
        "div",
        { className: "term" },
        h(
          "div",
          { className: "term-bar" },
          h("span", { className: "dots" }),
          h("span", { className: "term-title", textContent: cli.title }),
        ),
        term,
      ),
      phone(url, scroller, tap),
    ),
  );

  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
  }).observe(root);

  async function play(fast: boolean) {
    const my = ++gen;
    const wait = async (ms: number) => {
      if (fast) return;
      for (let t = 0; t < ms; ) {
        await sleep(40);
        if (my !== gen || !root.isConnected) throw STOP;
        if (!paused && visible && !document.hidden) t += 40;
      }
    };
    const line = (cls: string, ...kids: Kid[]) => {
      const l = h("div", { className: `tl ${cls}` }, ...kids);
      term.append(l);
      term.scrollTop = term.scrollHeight;
      return l;
    };
    const type = async (el: HTMLElement, text: string, cps = 28) => {
      const isField = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
      for (const ch of fast ? [text] : text) {
        if (isField) {
          el.value += ch;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        } else el.append(ch); // keeps the prefix span
        term.scrollTop = term.scrollHeight;
        await wait((1000 / cps) * (0.6 + Math.random() * 0.8));
      }
    };
    // A command and its output, grouped so each CLI can frame them its own way.
    const run = async (c: string) => {
      const g = h(
        "div",
        { className: "tool" },
        h("div", { className: "tl cmd" }, h("span", { className: "t-dim tool-mark", textContent: cli.tool })),
      );
      term.append(g);
      await type(g.firstChild as HTMLElement, cli.run(c), cli === SHELL ? 22 : 70);
      return (cls: string, ...kids: Kid[]) => {
        const l = h("div", { className: `tl out ${cls}` }, ...kids);
        g.append(l);
        term.scrollTop = term.scrollHeight;
        return l;
      };
    };
    const say = (...kids: Kid[]) => line("agent", h("span", { className: "t-accent", textContent: cli.say }), ...kids);
    const box = scroller.getBoundingClientRect.bind(scroller);
    const show = async (el: HTMLElement) => {
      const r = el.getBoundingClientRect(),
        s = box();
      const d = r.top - s.top;
      if (d < 50 || d + r.height > s.height - 90) {
        scroller.scrollBy({ top: d - s.height * 0.3, behavior: fast ? "auto" : "smooth" });
        await wait(550);
      }
    };
    const press = async (el: HTMLElement, act: () => void) => {
      await show(el);
      if (!fast) {
        const r = el.getBoundingClientRect(),
          s = (scroller.parentElement as HTMLElement).getBoundingClientRect();
        tap.style.setProperty("--x", `${r.left - s.left + Math.min(r.width / 2, 60)}px`);
        tap.style.setProperty("--y", `${r.top - s.top + r.height / 2}px`);
        tap.classList.remove("on");
        void tap.offsetWidth;
        tap.classList.add("on");
        el.classList.add("pressed");
        await wait(180);
        el.classList.remove("pressed");
      }
      act();
      await wait(650);
    };
    const pick = (input: HTMLInputElement) =>
      press(input.closest("label")!, () => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });

    // reset
    term.replaceChildren();
    url.textContent = "";
    scroller.scrollTop = 0;
    scroller.replaceChildren(
      h(
        "div",
        { className: "phone-idle" },
        icon("bubble"),
        h("p", { textContent: "Waiting for a link from your agent" }),
      ),
    );
    const f = buildForm(sc.q);
    const $ = (id: string, sel: string) =>
      f.fields.find((x) => x.it.id === id)!.el.querySelector(sel) as HTMLInputElement;
    const fd = h("ol", { className: "feed" }, h("li", { className: "open" }, f.form));
    // stops on the next loop, or when the scene is switched
    if (sc.q.deadline)
      countdown(
        f.fields[0].el,
        sc.q.deadline,
        () => my === gen && root.isConnected,
        () => !paused && visible && !fast,
      );

    const you = line("prompt", h("span", { className: "t-dim", textContent: "› " }));
    if (first) {
      first = false;
      you.append(sc.you);
    } else {
      await wait(700);
      await type(you, sc.you);
    }
    await wait(500);
    say(sc.intro);
    await wait(600);
    let out = await run(`bash ask.sh ask ${sc.file}`);
    await wait(500);
    out("", h("span", { className: "t-warn", textContent: "PENDING" }));
    out(
      "",
      "Give the user this link: ",
      h("span", { className: "t-link", textContent: `https://${DEMO_URL}#9f2c…e1a0` }),
    );
    out("t-dim", "Run again to keep waiting: ask.sh wait");
    await wait(700);

    // the phone opens the link
    const openLink = async () => {
      await wait(300);
      for (const ch of fast ? [DEMO_URL] : DEMO_URL.match(/.{1,4}/g)!) {
        url.textContent += ch;
        await wait(35);
      }
      scroller.replaceChildren(
        shell([stateEl("wait", "Verifying link…", "Checking the agent's key against the link.")], "div"),
      );
      await wait(1100);
      scroller.replaceChildren(shell([fd], "div"));
      f.form.classList.add("enter");
      await wait(1100);
    };
    if (add) {
      say(
        "Open this on your phone: ",
        h("span", { className: "t-link", textContent: `https://${DEMO_URL}#9f2c…e1a0` }),
      );
      await openLink();
      if (sc.say) {
        out = await run(`bash ask.sh say "${sc.say.replaceAll("*", "")}"`);
        await wait(300);
        out("", "Said.");
        fd.append(h("li", { className: "say" }, md(sc.say)));
        await show(fd.lastChild as HTMLElement);
        await wait(1200);
      }
      say(add.say);
      await wait(500);
      out = await run(`bash ask.sh add ${add.file}`);
      await wait(400);
      f.append(add.q);
      out("", h("span", { className: "t-warn", textContent: "PENDING" }));
      out("", "Sent. Add more with add, or run wait for the answer.");
      out("t-dim", "Run again to keep waiting: ask.sh wait");
      await wait(700);
    }
    out = await run("bash ask.sh wait");
    const spin = out("t-dim", h("span", { className: "tspin" }), " waiting for your answer…");
    if (!add) await openLink();

    for (const [kind, id, v] of sc.acts) {
      if (kind === "pick") await pick($(id, `input[value="${v}"]`));
      if (kind === "up") {
        const up = $(id, ".step-up");
        for (let i = 0; i < v; i++) await press(up, () => up.click());
      }
      if (kind === "dice") {
        const d = $(id, ".dice");
        await press(d, () => d.click());
      }
      if (kind === "text") {
        const el = $(id, ".input");
        await press(el, () => {});
        await type(el, v, 16);
      }
      if (kind === "comment") {
        const det = $(id, "details") as unknown as HTMLDetailsElement;
        await press(det.querySelector("summary")!, () => {
          det.open = true;
        });
        await type(det.querySelector("textarea")!, v, 16);
      }
    }
    await wait(500);
    const answer = f.collect(false).a;
    if (fast) {
      scroller.scrollTop = 0;
    } else {
      await press(f.btn, () => {
        f.label.textContent = "Sending…";
        f.btn.classList.add("busy");
      });
      await wait(700);
      scroller.replaceChildren(shell([sentState()], "div"));
    }

    // the agent gets the JSON and carries on
    spin.remove();
    out("json", ...jsonNodes(answer));
    await wait(1200);
    say(sc.after);
    await wait(800);
    out = await run(sc.cmd);
    await wait(900);
    out("", h("span", { className: "t-ok", textContent: "✓ " }), sc.done);
    await wait(5000);
  }

  // Start after the page has laid out, so the phone has a size to scroll in.
  requestAnimationFrame(async () => {
    if (still) return play(true);
    while (root.isConnected)
      await play(false).catch((x) => {
        if (x !== STOP) throw x;
      });
  });
  return root;
}
