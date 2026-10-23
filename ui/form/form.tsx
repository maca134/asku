// The answer form, shared by the real page and the landing demos.
import { capitalise, h, icon, markdown } from "../dom";
import type { Answer, Mood, Question } from "../types";
import { type Field, field } from "./fields";
import { visibility } from "./when";

// A line under the title, and a class on the form that the CSS plays with.
export const MOODS: Record<Mood, [face: string, text: string]> = {
  confident: ["😎", "The agent is confident about this one."],
  excited: ["🤩", "The agent is very excited about this."],
  nervous: ["😬", "The agent is nervous about this one."],
  begging: ["🥺", "The agent is begging you."],
  grumpy: ["😤", "The agent is grumpy about having to ask."],
  sheepish: ["🙈", "The agent is a bit embarrassed to ask."],
};

export const moodLine = (mood: Mood) => (
  <p className="mood">
    <span className="mood-face" ariaHidden="true">
      {MOODS[mood][0]}
    </span>
    {MOODS[mood][1]}
  </p>
);

function heading(batch: Question, className: string, title: (text: string) => HTMLElement) {
  if (!batch.title && !batch.md && !batch.mood) return null;
  return (
    <header className={className}>
      {batch.title && title(batch.title)}
      {batch.mood && moodLine(batch.mood)}
      {batch.md && markdown(batch.md, "context")}
    </header>
  );
}

export type Form = ReturnType<typeof buildForm>;

export function buildForm(first: Question) {
  const fields: Field[] = [];
  const note = h("textarea", { rows: 3, className: "input", placeholder: "Anything else the agent should know?" });
  const error = <div className="form-err" role="alert" />;
  const sendLabel = <span>Send answers</span>;
  const sendButton = (
    <button type="submit" className="btn btn-primary btn-send">
      {icon("lock")}
      {sendLabel}
    </button>
  );
  const progress = <span className="progress" />;
  const noteField = (
    <label className="q note">
      <span className="note-label">
        Note for the agent
        <span className="opt-tag">Optional</span>
      </span>
      {note}
    </label>
  );
  const form = h(
    "form",
    { className: "qform", noValidate: true },
    heading(first, "qform-head", (title) => <h1>{title}</h1>),
    noteField,
    <p className="fine">Sent by an AI agent. Don't enter passwords or payment details.</p>,
    error,
    <div className="submit-bar">
      {progress}
      {sendButton}
    </div>,
  );

  // A batch's questions go above the note, numbered on from the last. Later batches get their own section head.
  const append = (batch: Question, withHeading = true) => {
    const added = batch.questions.map((item, i) => field(item, fields.length + i));
    fields.push(...added);
    if (batch.mood) {
      form.classList.remove(...Object.keys(MOODS).map((mood) => `mood-${mood}`));
      form.classList.add(`mood-${batch.mood}`);
    }
    const section = withHeading ? heading(batch, "qform-sec", (title) => <h2>{title}</h2>) : null;
    const elements = [...(section ? [section] : []), ...added.map((f) => f.element)];
    noteField.before(...elements);
    refresh();
    return { elements, fields: added };
  };

  const remove = (removed: Field[]) => {
    for (const f of removed) {
      fields.splice(fields.indexOf(f), 1);
      f.element.remove();
    }
    refresh();
  };

  // Problems are flagged on the fields from the first submit on, then follow every edit.
  let submitted = false;
  const collect = (flag = true, only = fields) => {
    submitted ||= flag;
    const answer: Answer = { answers: {}, skipped: [], comments: {}, note: note.value.trim() };
    const problems: string[] = [];
    const states = visibility(fields);
    for (const f of only) {
      const id = f.item.id;
      const state = states.get(id);
      if (state === "shown" && f.comment.value.trim()) answer.comments[id] = f.comment.value.trim();
      if (state !== "shown" || f.delegated()) {
        f.element.classList.remove("invalid");
        f.error.textContent = "";
        if (state === "hidden") answer.skipped.push(id);
        else answer.delegated = [...(answer.delegated ?? []), id];
        continue;
      }
      const value = f.value();
      const problem = value === undefined ? (f.item.required ? "required" : null) : f.check();
      const shown = submitted && !!problem;
      f.element.classList.toggle("invalid", shown);
      for (const input of f.element.querySelectorAll("[aria-describedby]"))
        input.setAttribute("aria-invalid", String(shown));
      f.error.textContent = problem && submitted ? capitalise(problem) : "";
      if (problem) problems.push(`${f.item.label}: ${problem}`);
      else if (value === undefined) answer.skipped.push(id);
      else answer.answers[id] = value;
    }
    if (submitted)
      error.textContent = problems.length ? `Check ${count(problems.length)}: ${problems.join(" · ")}` : "";
    return { answer, problems };
  };

  // A dependent left to the agent with its question is hidden too: nothing for the user to do there.
  const refresh = () => {
    const states = visibility(fields);
    const shown = fields.filter((f) => {
      f.element.hidden = states.get(f.item.id) !== "shown";
      return !f.element.hidden;
    });
    shown.forEach((f, i) => {
      f.element.querySelector(".q-num")!.textContent = String(i + 1);
    });
    const answered = shown.filter((f) => f.delegated() || f.value() !== undefined).length;
    progress.textContent = `${answered} of ${shown.length} answered`;
    if (submitted) collect(false);
  };

  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  append(first, false);
  return { form, fields, note, noteField, error, sendButton, sendLabel, collect, append, remove };
}

const count = (n: number) => (n === 1 ? "1 answer" : `${n} answers`);
