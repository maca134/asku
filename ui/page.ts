// The app's page frame: top bar, the session feed, status screens and the bell.
import { app, h, icon, logo, md, p, type Kid } from "./dom";
import type { Mood, Question } from "./types";

// ---- app pages: a slim top bar and one centred column, built for phones
export function shell(kids: Kid[], tag: "main" | "div" = "main") {
  const answering = tag === "main" && location.pathname.startsWith("/a/");
  return h("div", { className: "shell" },
    // no home link on an answer page: one stray tap would lose a half-filled form
    h("header", { className: "topbar" }, logo(answering ? undefined : "/"), answering ? sess : null, answering ? sessTime : null, answering ? bellBtn() : null, h("span", { className: "e2e", title: "End-to-end encrypted" }, icon("lock"), h("span", { textContent: "End-to-end encrypted" }))),
    h(tag, { className: "shell-main" }, ...kids));
}

// ---- session name (set by the agent) and running time, in the top bar and the tab title
export const sessName = h("b");
const sessTime = h("span", { className: "sess-time", title: "Session running time" });
const sess = h("span", { className: "sess" }, sessName);
export const tabTitle = () => (sessName.textContent ? `${sessName.textContent} · asku` : "asku");
export function nameSession(name: string) {
  sessName.textContent = sessName.title = name;
  if (!document.title.startsWith("●")) document.title = tabTitle();
}
// seconds as m:ss, or h:mm:ss
export const hms = (s: number) => {
  const hr = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
  return `${hr ? `${hr}:${String(m).padStart(2, "0")}` : m}:${String(s % 60).padStart(2, "0")}`;
};
export function clock(start: number) {
  const tick = () => { sessTime.textContent = hms(Math.floor((Date.now() - start) / 1000)); };
  tick();
  setInterval(tick, 1000);
}

// ---- pings: a buzz (Android) and, if the user turned the bell on, a beep when the agent asks something new
let audio: AudioContext | null = null;
const bellKey = "asku-bell";
try { if (localStorage.getItem(bellKey)) audio = new AudioContext(); } catch {}
// a context made without a tap starts suspended; the first tap anywhere wakes it
document.addEventListener("pointerdown", () => audio?.resume(), { once: true });
function bellBtn() {
  const b = h("button", { type: "button", className: "bell", ariaLabel: "Beep on new questions" }, icon("bell"));
  const set = () => { b.ariaPressed = String(!!audio); b.title = audio ? "Beeps on new questions (tap to mute)" : "Tap to beep on new questions"; };
  b.onclick = () => {
    if (audio) { audio.close(); audio = null; } else { audio = new AudioContext(); beep(); }
    try { audio ? localStorage.setItem(bellKey, "1") : localStorage.removeItem(bellKey); } catch {}
    set();
  };
  set();
  return b;
}
function beep() {
  if (!audio) return;
  const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
  o.frequency.value = 880;
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
  o.connect(g).connect(audio.destination);
  o.start(t);
  o.stop(t + 0.25);
}
export const ping = (mood?: Mood) => {
  // before any tap, Chrome refuses and logs an error
  if (navigator.userActivation?.hasBeenActive ?? true) navigator.vibrate?.(mood === "begging" ? [150, 80, 150, 80, 400] : 200);
  beep();
};

// ---- the session as one feed, oldest first: the agent's updates (`ask say`), its forms, and what became of them.
// Whatever the page is doing now (waiting, an error) shows under it.
const feed = h("ol", { className: "feed", ariaLabel: "Session" });
const heard = h("p", { className: "sr-only", ariaLive: "polite" });
export function toFeed(li: HTMLLIElement) {
  feed.append(li);
  // ponytail: keeps the last 100 entries; the open form is never dropped
  while (feed.childElementCount > 100) feed.querySelector(":scope > li:not(.open)")!.remove();
}
export function say(text: string) {
  toFeed(h("li", { className: "say" }, md(text)));
  heard.textContent = text;
}
export const batchName = (q: Question) => q.title || q.questions[0].label;
export const event = (ico: string, text: string, cls = "") => h("li", { className: `event ${cls}` }, icon(ico), h("span", { textContent: text }));
export const WORKING = "Your agent is working. Updates and new questions will appear here.";
export const waiting = () => h("div", { className: "waiting" }, live(WORKING));


type Kind = "wait" | "done" | "error" | "agent";
export function stateEl(kind: Kind, title: string, detail?: string, ...extra: Kid[]) {
  const ico = kind === "wait" ? h("span", { className: "spinner" }) : icon(kind === "done" ? "check" : kind === "error" ? "alert" : "terminal");
  return h("section", { className: `state ${kind}`, role: kind === "error" ? "alert" : "status" },
    h("div", { className: "state-icon" }, ico),
    h("h1", { textContent: title }),
    detail ? p(detail, "state-detail") : null,
    ...extra);
}
// After swapping screens, move focus to the new heading so keyboard and screen-reader users land on it.
export const show = (...kids: Kid[]) => {
  app.replaceChildren(shell([feed, heard, ...kids]));
  const h1 = app.querySelector<HTMLElement>(".shell-main > :not(.feed) h1");
  if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }); }
};
export const status = (kind: Kind, title: string, detail?: string, ...extra: Kid[]) => show(stateEl(kind, title, detail, ...extra));
export const live = (text: string) => h("p", { className: "live" }, h("span", { className: "pulse" }), text);
export const home = () => h("a", { className: "btn btn-secondary", href: "/" }, `Go to ${location.host}`);
export const startNew = (kind = "btn-secondary") => h("a", { className: `btn ${kind}`, href: "/start" }, "Start a new session");

document.addEventListener("visibilitychange", () => { if (!document.hidden && document.title.startsWith("●")) document.title = tabTitle(); });

// Text with a copy button. It wraps, so a long link stays readable on a phone.
export function copyable(text: string, prompt?: string, label = "Copy") {
  const field = h("code", { className: "copy-text", textContent: text });
  const lbl = h("span", { textContent: "Copy" });
  const copy = h("button", { type: "button", className: "copy-btn", ...(label !== "Copy" && { ariaLabel: `Copy ${label.toLowerCase()}` }) }, icon("copy"), lbl);
  copy.onclick = () => navigator.clipboard.writeText(text).then(() => {
    lbl.textContent = "Copied";
    copy.classList.add("ok");
    setTimeout(() => { lbl.textContent = "Copy"; copy.classList.remove("ok"); }, 2000);
  }, () => getSelection()?.selectAllChildren(field));
  return h("div", { className: "copy" }, prompt ? h("span", { className: "copy-prompt", textContent: prompt, ariaHidden: "true" }) : null, field, copy);
}

export const installLine = () => `Install the skill at ${location.origin}/skill.md`;
