// The app's page frame: top bar, the session feed, status screens and the bell.
import { app, type Child, codeSpans, h, icon, logo, markdown } from "./dom";
import type { Mood, Question } from "./types";

export const sessionName = h("b");
const sessionTime = <span className="sess-time" title="Session running time" />;
// filled by session/push.tsx when the relay can send push notifications
export const pushSlot = <span className="push-slot" />;

export function shell(children: Child[], tag: "main" | "div" = "main") {
  const answering = tag === "main" && location.pathname.startsWith("/a/");
  return (
    <div className="shell">
      <header className="topbar">
        {/* no home link on an answer page: one stray tap would lose a half-filled form */}
        {logo(answering ? undefined : "/")}
        {answering && [<span className="sess">{sessionName}</span>, sessionTime, bellButton(), pushSlot]}
        <span className="e2e" title="End-to-end encrypted">
          {icon("lock")}
          <span>End-to-end encrypted</span>
        </span>
      </header>
      {h(tag, { className: "shell-main" }, children)}
    </div>
  );
}

export const tabTitle = () => (sessionName.textContent ? `${sessionName.textContent} · asku` : "asku");

export function nameSession(name: string) {
  sessionName.textContent = sessionName.title = name;
  if (!document.title.startsWith("●")) document.title = tabTitle();
}

// m:ss, or h:mm:ss
export function formatTime(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const secs = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

export function startClock(start: number) {
  const tick = () => {
    sessionTime.textContent = formatTime(Math.floor((Date.now() - start) / 1000));
  };
  tick();
  setInterval(tick, 1000);
}

// A buzz (Android) and, if the user turned the bell on, a beep when the agent asks something new.
const BELL_KEY = "asku-bell";
let audio: AudioContext | null = null;
try {
  if (localStorage.getItem(BELL_KEY)) audio = new AudioContext();
} catch {}
// a context made without a tap starts suspended; the first tap anywhere wakes it
document.addEventListener("pointerdown", () => audio?.resume(), { once: true });

function bellButton() {
  const button = h("button", { type: "button", className: "bell", ariaLabel: "Beep on new questions" }, icon("bell"));
  const update = () => {
    button.ariaPressed = String(!!audio);
    button.title = audio ? "Beeps on new questions (tap to mute)" : "Tap to beep on new questions";
  };
  button.onclick = () => {
    if (audio) {
      audio.close();
      audio = null;
    } else {
      audio = new AudioContext();
      beep();
    }
    try {
      if (audio) localStorage.setItem(BELL_KEY, "1");
      else localStorage.removeItem(BELL_KEY);
    } catch {}
    update();
  };
  update();
  return button;
}

function beep() {
  if (!audio) return;
  const tone = audio.createOscillator();
  const volume = audio.createGain();
  const now = audio.currentTime;
  tone.frequency.value = 880;
  volume.gain.setValueAtTime(0.15, now);
  volume.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  tone.connect(volume).connect(audio.destination);
  tone.start(now);
  tone.stop(now + 0.25);
}

export function ping(mood?: Mood) {
  // before any tap, Chrome refuses and logs an error
  if (navigator.userActivation?.hasBeenActive ?? true)
    navigator.vibrate?.(mood === "begging" ? [150, 80, 150, 80, 400] : 200);
  beep();
}

// The session as one feed, oldest first: the agent's updates (`ask say`), its forms, and what became of them.
// Whatever the page is doing now (waiting, an error) shows under it.
const feed = <ol className="feed" ariaLabel="Session" />;
const announcer = <p className="sr-only" ariaLive="polite" />;

export function addToFeed(item: HTMLElement) {
  feed.append(item);
  // ponytail: keeps the last 100 entries; the open form is never dropped
  while (feed.childElementCount > 100) feed.querySelector(":scope > li:not(.open)")!.remove();
}

export function say(text: string) {
  addToFeed(<li className="say">{markdown(text)}</li>);
  announcer.textContent = text;
}

export const batchName = (question: Question) => question.title || question.questions[0].label;

export const feedEvent = (iconName: string, text: string, className = "") => (
  <li className={`event ${className}`}>
    {icon(iconName)}
    <span>{text}</span>
  </li>
);

export const WORKING = "Your agent is working. Updates and new questions will appear here.";
export const waiting = () => <div className="waiting">{live(WORKING)}</div>;

type Kind = "wait" | "done" | "error" | "agent";
const KIND_ICONS = { done: "check", error: "alert", agent: "terminal" };

export function statePanel(kind: Kind, title: string, detail?: string, ...extra: Child[]) {
  return (
    <section className={`state ${kind}`} role={kind === "error" ? "alert" : "status"}>
      <div className="state-icon">{kind === "wait" ? <span className="spinner" /> : icon(KIND_ICONS[kind])}</div>
      <h1>{title}</h1>
      {detail && <p className="state-detail">{codeSpans(detail)}</p>}
      {extra}
    </section>
  );
}

// After swapping screens, move focus to the new heading so keyboard and screen-reader users land on it.
export function show(...children: Child[]) {
  app.replaceChildren(shell([feed, announcer, children]));
  const heading = app.querySelector<HTMLElement>(".shell-main > :not(.feed) h1");
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
}

export const status = (kind: Kind, title: string, detail?: string, ...extra: Child[]) =>
  show(statePanel(kind, title, detail, ...extra));

export const live = (text: string) => (
  <p className="live">
    <span className="pulse" />
    {text}
  </p>
);

export const homeLink = () => (
  <a className="btn btn-secondary" href="/">
    Go to {location.host}
  </a>
);

export const newSessionLink = (style = "btn-secondary") => (
  <a className={`btn ${style}`} href="/start">
    Start a new session
  </a>
);

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && document.title.startsWith("●")) document.title = tabTitle();
});

// Text with a copy button. It wraps, so a long link stays readable on a phone.
export function copyable(text: string, prompt?: string, subject?: string) {
  const code = <code className="copy-text">{text}</code>;
  const label = <span>Copy</span>;
  const button = (
    <button type="button" className="copy-btn" ariaLabel={subject ? `Copy ${subject.toLowerCase()}` : null}>
      {icon("copy")}
      {label}
    </button>
  );
  button.onclick = () =>
    navigator.clipboard.writeText(text).then(
      () => {
        label.textContent = "Copied";
        button.classList.add("ok");
        setTimeout(() => {
          label.textContent = "Copy";
          button.classList.remove("ok");
        }, 2000);
      },
      () => getSelection()?.selectAllChildren(code),
    );
  return (
    <div className="copy">
      {prompt && (
        <span className="copy-prompt" ariaHidden="true">
          {prompt}
        </span>
      )}
      {code}
      {button}
    </div>
  );
}

export const installLine = () => `Install the skill at ${location.origin}/skill.md`;
