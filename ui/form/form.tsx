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
    const elements = [...(section ? [section] : []), ...added.map((question) => question.element)];
    noteField.before(...elements);
    refresh();
    return { elements, fields: added };
  };

  const remove = (removed: Field[]) => {
    for (const question of removed) {
      fields.splice(fields.indexOf(question), 1);
      question.element.remove();
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
    for (const question of only) {
      const id = question.item.id;
      const state = states.get(id);
      if (state === "shown" && question.comment.value.trim()) answer.comments[id] = question.comment.value.trim();
      if (state !== "shown" || question.delegated()) {
        question.element.classList.remove("invalid");
        question.error.textContent = "";
        if (state === "hidden") answer.skipped.push(id);
        else answer.delegated = [...(answer.delegated ?? []), id];
        continue;
      }
      const value = question.value();
      const problem = value === undefined ? (question.item.required ? "required" : null) : question.check();
      const shown = submitted && !!problem;
      question.element.classList.toggle("invalid", shown);
      for (const input of question.element.querySelectorAll("[aria-describedby]"))
        input.setAttribute("aria-invalid", String(shown));
      question.error.textContent = problem && submitted ? capitalise(problem) : "";
      if (problem) problems.push(`${question.item.label}: ${problem}`);
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
    const shown = fields.filter((question) => {
      question.element.hidden = states.get(question.item.id) !== "shown";
      return !question.element.hidden;
    });
    shown.forEach((question, i) => {
      question.element.querySelector(".q-num")!.textContent = String(i + 1);
    });
    const answered = shown.filter((question) => question.delegated() || question.value() !== undefined).length;
    progress.textContent = `${answered} of ${shown.length} answered`;
    if (submitted) collect(false);
  };

  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  append(first, false);
  return { form, fields, note, noteField, error, sendButton, sendLabel, collect, append, remove };
}

const count = (total: number) => (total === 1 ? "1 answer" : `${total} answers`);
