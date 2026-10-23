// The open form on the answer page: batches, deadlines, and sending.
import type { Keys } from "../../shared/crypto";
import { h, icon } from "../dom";
import { batchName, event, hms, live, show, stateEl, tabTitle, toFeed, waiting, WORKING } from "../page";
import { send } from "../session/send";
import type { State } from "../session/storage";
import type { Answer, Question } from "../types";
import { buildForm } from "./form";

export const sentState = () => stateEl("done", "Answers sent", "Encrypted on this device and delivered to your agent. Keep this tab open for follow-up questions.", live(WORKING));
const smooth = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export type Batch = [seq: number, q: Question];
type Fields = ReturnType<typeof buildForm>["fields"];
type Part = { seq: number; fields: Fields; foot: HTMLElement; clock?: HTMLElement };
export type Say = { say: string };
export type Open = { f: ReturnType<typeof buildForm>; sending: boolean; add: (b: Batch) => void };

// Shows a form for one or more batches. Later batches go under it, with a chip pointing at them; with more than one
// open, each batch can be sent on its own, and the main button sends the rest.
export function render(sid: string, keys: Keys, st: State, batches: Batch[], done: () => void): Open {
  const [[seq, q], ...rest] = batches;
  const f = buildForm(q);
  const li = h("li", { className: "open" }, f.form);
  const names = [batchName(q)];
  const born = Date.now();
  const parts: Part[] = [];
  let unseen = 0, first: Element | undefined;
  const said = h("p", { className: "sr-only", ariaLive: "polite" });
  const chip = h("button", { type: "button", className: "new-chip", onclick: () => first?.scrollIntoView({ behavior: smooth(), block: "start" }) });
  const seen = new IntersectionObserver((es) => {
    if (!es.some((x) => x.isIntersecting)) return;
    chip.remove(); unseen = 0; first = undefined; seen.disconnect();
  });
  const decline = h("button", { type: "button", className: "btn btn-secondary btn-sm" }, "Decline, send only the note");
  decline.onclick = () => submit(parts, true);
  f.tail.after(h("div", { className: "decline" }, decline));
  f.form.append(said);

  const part = (s: number, fs: Fields, q: Question) => {
    const btn = h("button", { type: "button", className: "btn btn-secondary btn-sm" }, `Send ${fs.length === 1 ? "this answer" : `these ${fs.length} answers`}`);
    const p: Part = { seq: s, fields: fs, foot: h("div", { className: "batch-foot" }, btn) };
    btn.onclick = () => submit([p]);
    fs[fs.length - 1].el.after(p.foot);
    parts.push(p);
    f.form.classList.toggle("multi", parts.length > 1);
    if (q.deadline) clock(p, ((q.sent ?? Date.now() / 1000) + q.deadline) * 1000);
  };

  // A batch with a deadline counts down above its first question. At zero it locks: the agent stops waiting then.
  // ponytail: trusts the agent's and the phone's clocks to agree; both are usually NTP-synced.
  const clock = (p: Part, end: number) => {
    const el = p.clock = h("p", { className: "countdown", role: "timer" }, icon("clock"), h("span"));
    p.fields[0].el.before(el);
    const tick = () => {
      if (!el.isConnected) return clearInterval(t); // sent, or the form is gone
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left > 0) {
        el.lastChild!.textContent = `The agent decides without you in ${hms(left)}`;
        el.classList.toggle("soon", left <= 60);
      } else if (!o.sending) {
        clearInterval(t);
        expire(p);
      }
    };
    const t = setInterval(tick, 1000);
    setTimeout(tick); // after render() has put the form on the page
  };
  const expire = (p: Part) => {
    p.clock!.replaceWith(h("p", { className: "batch-sent expired" }, icon("clock"), "Time's up. The agent went ahead without these answers."));
    p.foot.remove();
    f.remove(p.fields);
    parts.splice(parts.indexOf(p), 1);
    f.form.classList.toggle("multi", parts.length > 1);
    if (parts.length) return;
    seen.disconnect();
    li.replaceWith(event("clock", `Time's up, the agent went ahead: ${names.join(" · ")}`, "expired"));
    show(waiting());
    done();
  };

  const busy = (on: boolean) => {
    o.sending = on;
    f.form.querySelectorAll<HTMLButtonElement>(".btn").forEach((b) => (b.disabled = on));
    f.label.textContent = on ? "Sending…" : "Send answers";
  };
  const submit = async (ps: Part[], declined = false) => {
    if (o.sending) return;
    const all = ps.length === parts.length;
    const fields = ps.flatMap((p) => p.fields);
    let a: Answer;
    if (declined) {
      if (!f.note.value.trim()) {
        f.err.textContent = "Write a note first, so the agent knows why you're not answering.";
        return f.note.focus();
      }
      a = { answers: {}, skipped: fields.map((x) => x.it.id), comments: {}, note: f.note.value.trim(), declined: true };
    } else {
      const r = f.collect(true, fields);
      if (r.problems.length) {
        f.form.querySelector(".invalid")?.scrollIntoView({ behavior: smooth(), block: "start" });
        f.form.querySelector<HTMLElement>(".invalid [aria-describedby]")?.focus({ preventScroll: true });
        return;
      }
      if (all && unseen) { // don't send questions the user hasn't seen as "skipped"
        f.err.textContent = "New questions just arrived. Have a look, then send again.";
        first?.scrollIntoView({ behavior: smooth(), block: "start" });
        unseen = 0;
        return;
      }
      a = all ? r.a : { ...r.a, note: "" };
    }
    busy(true);
    try {
      const seqs = ps.map((p) => p.seq);
      await send(sid, keys, st, seqs, { seqs, ...a });
      if (all) {
        seen.disconnect();
        li.replaceWith(event("check", `${declined ? "Declined" : "Answered"}: ${names.join(" · ")}`));
        show(waiting());
      } else {
        for (const p of ps) {
          p.clock?.remove();
          p.foot.replaceWith(h("p", { className: "batch-sent" }, icon("check"), `Sent ${p.fields.length === 1 ? "1 answer" : `${p.fields.length} answers`}`));
          f.remove(p.fields);
          parts.splice(parts.indexOf(p), 1);
        }
        f.form.classList.toggle("multi", parts.length > 1);
        f.err.textContent = "";
        busy(false);
      }
    } catch (x) {
      busy(false);
      const m = (x as Error).message;
      f.err.textContent = m === "Failed to fetch" ? "Couldn't reach the relay. Check your connection and send again." : `Not sent: ${m}. Try again.`;
    }
    done();
  };

  const o: Open = {
    f, sending: false,
    add([s, b]) {
      const r = f.append(b);
      names.push(batchName(b));
      part(s, r.fields, b);
      if (Date.now() - born < 1000) return; // replayed after a reload, not new
      const el = r.els[0];
      unseen += b.questions.length;
      first ??= el;
      const above = el.getBoundingClientRect().bottom < 0;
      const text = `${unseen} new question${unseen === 1 ? "" : "s"} ${above ? "above" : "below"}`;
      chip.replaceChildren(icon(above ? "up" : "down"), text);
      said.textContent = text;
      if (!chip.isConnected) f.form.append(chip);
      seen.observe(el);
      if (document.hidden) document.title = `● New questions · ${tabTitle()}`;
    },
  };
  part(seq, f.fields.slice(), q);
  rest.forEach(o.add);
  f.form.onsubmit = (e) => { e.preventDefault(); submit(parts); };
  toFeed(li);
  show();
  li.scrollIntoView({ block: "start" });
  if (document.hidden) document.title = `● Question waiting · ${tabTitle()}`;
  return o;
}
