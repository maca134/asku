import { h, icon, md } from "../dom";
import type { Answer, Mood, Question } from "../types";
import { field } from "./fields";

// ---- moods: a line under the title, and a class on the form that the CSS plays with
export const MOODS: Record<Mood, [string, string]> = {
  confident: ["😎", "The agent is confident about this one."],
  excited: ["🤩", "The agent is very excited about this."],
  nervous: ["😬", "The agent is nervous about this one."],
  begging: ["🥺", "The agent is begging you."],
  grumpy: ["😤", "The agent is grumpy about having to ask."],
  sheepish: ["🙈", "The agent is a bit embarrassed to ask."],
};
export const moodEl = (m: Mood) => h("p", { className: "mood" }, h("span", { className: "mood-face", textContent: MOODS[m][0], ariaHidden: "true" }), MOODS[m][1]);

// The answer form, shared by the real page and the landing demos.
export function buildForm(q: Question) {
  const fields: ReturnType<typeof field>[] = [];
  const note = h("textarea", { rows: 3, className: "input", placeholder: "Anything else the agent should know?" });
  const err = h("div", { className: "form-err", role: "alert" });
  const label = h("span", { textContent: "Send answers" });
  const btn = h("button", { type: "submit", className: "btn btn-primary btn-send" }, icon("lock"), label);
  const progress = h("span", { className: "progress" });
  const tail = h("label", { className: "q note" }, h("span", { className: "note-label" }, "Note for the agent", h("span", { className: "opt-tag", textContent: "Optional" })), note);
  const form = h("form", { className: "qform", noValidate: true },
    q.title || q.md || q.mood ? h("header", { className: "qform-head" }, q.title ? h("h1", { textContent: q.title }) : null, q.mood ? moodEl(q.mood) : null, q.md ? md(q.md, "context") : null) : null,
    tail,
    h("p", { className: "fine", textContent: "Sent by an AI agent. Don't enter passwords or payment details." }),
    err,
    h("div", { className: "submit-bar" }, progress, btn));

  // Adds a batch's questions above the note, numbered on from the last; later batches get their title/md as a section head.
  const append = (b: Question, head = true) => {
    const fs = b.questions.map((it, i) => field(it, fields.length + i));
    fields.push(...fs);
    const sec = head && (b.title || b.md || b.mood) ? h("header", { className: "qform-sec" }, b.title ? h("h2", { textContent: b.title }) : null, b.mood ? moodEl(b.mood) : null, b.md ? md(b.md, "context") : null) : null;
    if (b.mood) { form.classList.remove(...Object.keys(MOODS).map((m) => `mood-${m}`)); form.classList.add(`mood-${b.mood}`); } // the newest batch sets the mood
    const els = [sec, ...fs.map((f) => f.el)].filter((e) => e !== null);
    tail.before(...els);
    refresh();
    return { els, fields: fs };
  };
  const remove = (fs: typeof fields) => {
    for (const x of fs) { fields.splice(fields.indexOf(x), 1); x.el.remove(); }
    refresh();
  };

  let tried = false;
  // mark: flag problems on the fields (after the first submit, flags then follow every edit); only: just these fields
  const collect = (mark = true, only = fields) => {
    tried ||= mark;
    const a: Answer = { answers: {}, skipped: [], comments: {}, note: note.value.trim() };
    const problems: string[] = [];
    for (const f of only) {
      if (f.comment.value.trim()) a.comments[f.it.id] = f.comment.value.trim();
      if (f.delegated()) {
        (a.delegated ??= []).push(f.it.id);
        f.el.classList.remove("invalid");
        f.msg.textContent = "";
        continue;
      }
      const v = f.value();
      const bad = v === undefined ? (f.it.required ? "required" : null) : f.check();
      f.el.classList.toggle("invalid", tried && !!bad);
      f.el.querySelectorAll("[aria-describedby]").forEach((x) => x.setAttribute("aria-invalid", String(tried && !!bad)));
      f.msg.textContent = tried && bad ? bad[0].toUpperCase() + bad.slice(1) : "";
      if (bad) problems.push(`${f.it.label}: ${bad}`);
      else if (v === undefined) a.skipped.push(f.it.id);
      else a.answers[f.it.id] = v;
    }
    if (tried) err.textContent = problems.length ? `Check ${problems.length === 1 ? "1 answer" : `${problems.length} answers`}: ${problems.join(" · ")}` : "";
    return { a, problems };
  };
  const refresh = () => {
    const n = fields.filter((f) => f.delegated() || f.value() !== undefined).length;
    progress.textContent = `${n} of ${fields.length} answered`;
    if (tried) collect(false);
  };
  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  append(q, false);
  return { form, fields, note, tail, err, btn, label, collect, append, remove };
}
