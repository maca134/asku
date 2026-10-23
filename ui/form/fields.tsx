// One question: its control, a comment box and "Let the agent decide".
import { type Child, capitalise, h, icon, markdown } from "../dom";
import type {
  ConfirmItem,
  DateItem,
  Item,
  MultiItem,
  NumberItem,
  Option,
  RankItem,
  ReviewItem,
  SingleItem,
  TextItem,
} from "../types";
import { withOffset } from "./date";

type Control = { elements: Child[]; value: () => unknown; check?: () => string | null; reset?: () => void };

const hint = (text: string) => (text ? <p className="hint">{capitalise(text)}</p> : null);

function yesNo(name: string, value: "yes" | "no", checked: boolean, text = value === "yes" ? "Yes" : "No") {
  const input = h("input", { type: "radio", name, value, checked, className: "sr-only" });
  const label = (
    <label className={`yn yn-${value}`}>
      {input}
      {icon(value === "yes" ? "check" : "x")}
      <span>{text}</span>
    </label>
  );
  return { input, label };
}

function confirmControl(item: ConfirmItem, name: string): Control {
  const yes = yesNo(name, "yes", item.default === true);
  const no = yesNo(name, "no", item.default === false);
  return {
    elements: [
      <div className="seg">
        {yes.label}
        {no.label}
      </div>,
    ],
    value: () => {
      if (yes.input.checked) return true;
      if (no.input.checked) return false;
    },
  };
}

const option = (choice: Option) =>
  typeof choice === "string" ? { value: choice, label: choice } : { ...choice, label: choice.label ?? choice.value };

// A write-in: an "Other" pick plus a text box. Typing ticks it; ticked with an empty box counts as no answer.
function otherChoice(multi: boolean, name: string, prefill?: string) {
  const pick = h("input", {
    type: multi ? "checkbox" : "radio",
    name,
    value: "",
    checked: !!prefill,
    className: "pick",
  });
  const text = h("input", {
    type: "text",
    value: prefill ?? "",
    placeholder: "Write your own",
    className: "input",
    ariaLabel: "Other answer",
  });
  text.oninput = () => {
    if (text.value.trim()) pick.checked = true;
  };
  const label = (
    <label className="opt">
      {pick}
      <span className="opt-body">
        <span className="opt-label">Other</span>
      </span>
    </label>
  );
  return { elements: [label, text], written: () => (pick.checked ? text.value.trim() : "") };
}

function choiceControl(item: SingleItem | MultiItem, name: string): Control {
  const multi = item.type === "multi";
  const defaults = new Set(multi ? item.default : item.default !== undefined ? [item.default] : []);
  const values = new Set(item.options.map((choice) => option(choice).value));
  const choices = item.options.map(option).map(({ value, label, md }) => {
    const input = h("input", {
      type: multi ? "checkbox" : "radio",
      name,
      value,
      checked: defaults.has(value),
      className: "pick",
    });
    const element = (
      <label className="opt">
        {input}
        <span className="opt-body">
          <span className="opt-label">{label}</span>
          {md && markdown(md)}
        </span>
      </label>
    );
    return { input, element };
  });
  const prefill = [...defaults].find((value) => !values.has(value));
  const other = item.other ? otherChoice(multi, name, prefill) : null;
  const picked = () => {
    const ticked = choices.filter(({ input }) => input.checked).map(({ input }) => input.value);
    const written = other?.written();
    return [...new Set(written ? [...ticked, written] : ticked)];
  };
  const options = (
    <div className="opts">
      {choices.map(({ element }) => element)}
      {other?.elements}
    </div>
  );
  if (!multi) return { elements: [options], value: () => picked()[0] };

  const { min, max } = item;
  const limits = [min !== undefined && min > 1 && `pick at least ${min}`, max !== undefined && `at most ${max}`];
  return {
    elements: [options, hint(limits.filter(Boolean).join(", "))],
    value: () => (picked().length ? picked() : undefined),
    check: () => {
      const count = picked().length;
      if (count && min !== undefined && count < min) return `pick at least ${min}`;
      if (max !== undefined && count > max) return `pick at most ${max}`;
      return null;
    },
  };
}

// One approve/reject pair per option. Undecided options are left out of the answer.
function reviewControl(item: ReviewItem, name: string): Control {
  const rows = item.options.map(option).map(({ value, label, md }, i) => {
    const yes = yesNo(`${name}-${i}`, "yes", false, "Approve");
    const no = yesNo(`${name}-${i}`, "no", false, "Reject");
    const element = (
      <div className="review" role="radiogroup" ariaLabel={label}>
        <span className="opt-body">
          <span className="opt-label">{label}</span>
          {md && markdown(md)}
        </span>
        <div className="seg">
          {yes.label}
          {no.label}
        </div>
      </div>
    );
    return { value, yes: yes.input, no: no.input, element };
  });
  const decided = () => rows.filter(({ yes, no }) => yes.checked || no.checked);
  return {
    elements: [<div className="opts">{rows.map(({ element }) => element)}</div>],
    value: () => {
      const picked = decided();
      if (picked.length) return Object.fromEntries(picked.map(({ value, yes }) => [value, yes.checked]));
    },
    check: () => {
      const left = rows.length - decided().length;
      return item.required && left ? `decide every item (${left} left)` : null;
    },
  };
}

// The options in order, moved with up/down buttons. Skipped until an item moves or "This order is fine" is ticked.
function rankControl(item: RankItem): Control {
  const list = <ol className="rank" ariaLabel={item.label} />;
  const status = <p className="sr-only" ariaLive="polite" />;
  const fine = h("input", { type: "checkbox", className: "pick" });
  const rows = item.options.map(option).map(({ value, label, md }) => {
    const button = (direction: 1 | -1) => (
      <button
        type="button"
        className="stepbtn"
        ariaLabel={`Move “${label}” ${direction < 0 ? "up" : "down"}`}
        onclick={() => move(row, direction)}
      >
        {icon(direction < 0 ? "up" : "down")}
      </button>
    );
    const up = button(-1);
    const down = button(1);
    const element = (
      <li className="rank-row">
        <span className="rank-pos" ariaHidden="true" />
        <span className="opt-body">
          <span className="opt-label">{label}</span>
          {md && markdown(md)}
        </span>
        {up}
        {down}
      </li>
    );
    const row = { value, label, up, down, element };
    return row;
  });

  const render = () => {
    rows.forEach(({ up, down, element }, i) => {
      element.querySelector(".rank-pos")!.textContent = String(i + 1);
      up.ariaDisabled = String(i === 0);
      down.ariaDisabled = String(i === rows.length - 1);
    });
    list.replaceChildren(...rows.map(({ element }) => element));
  };
  const move = (row: (typeof rows)[number], direction: 1 | -1) => {
    const from = rows.indexOf(row);
    const to = from + direction;
    if (to < 0 || to >= rows.length) return;
    rows.splice(from, 1);
    rows.splice(to, 0, row);
    render();
    // re-inserting a row drops its focus; keep it on the button so the next press moves it again
    (direction < 0 ? row.up : row.down).focus();
    status.textContent = `“${row.label}” moved to ${to + 1} of ${rows.length}`;
    fine.checked = true;
    list.dispatchEvent(new Event("change", { bubbles: true }));
  };
  render();

  return {
    elements: [
      <div className="opts">
        {list}
        <label className="opt">
          {fine}
          <span className="opt-body">
            <span className="opt-label">This order is fine</span>
          </span>
        </label>
      </div>,
      status,
    ],
    value: () => (fine.checked ? rows.map(({ value }) => value) : undefined),
  };
}

function textControl(item: TextItem): Control {
  const props = {
    placeholder: item.placeholder ?? "",
    value: item.default ?? "",
    className: "input",
    ariaLabel: item.label,
  };
  const input = item.multiline ? h("textarea", { rows: 4, ...props }) : h("input", { type: "text", ...props });
  if (item.maxLength) input.maxLength = item.maxLength;
  return { elements: [input], value: () => (input.value.trim() ? input.value : undefined) };
}

function bounds(min?: number | string, max?: number | string) {
  if (min !== undefined && max !== undefined) return `${min} to ${max}`;
  if (min !== undefined) return `at least ${min}`;
  if (max !== undefined) return `at most ${max}`;
  return "";
}

function numberControl(item: NumberItem): Control {
  const { min, max, step } = item;
  const input = h("input", {
    type: "number",
    // iOS's decimal keypad has no minus key
    inputMode: min !== undefined && min >= 0 ? "decimal" : "text",
    className: "input",
    ariaLabel: item.label,
    value: item.default !== undefined ? String(item.default) : "",
  });
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.step = step !== undefined ? String(step) : "any";

  const bump = (direction: 1 | -1) => {
    const current = input.value === "" ? (item.default ?? min ?? 0) : input.valueAsNumber;
    const next = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, current + direction * (step ?? 1)));
    input.value = String(Math.round(next * 1e9) / 1e9);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const stepButton = (direction: 1 | -1) => (
    <button
      type="button"
      className={`stepbtn ${direction > 0 ? "step-up" : "step-down"}`}
      ariaLabel={direction > 0 ? "Increase" : "Decrease"}
      onclick={() => bump(direction)}
    >
      {icon(direction > 0 ? "plus" : "minus")}
    </button>
  );
  const range = [bounds(min, max), step !== undefined ? `step ${step}` : ""].filter(Boolean).join(" · ");
  return {
    elements: [
      <div className="stepper">
        {stepButton(-1)}
        {input}
        {stepButton(1)}
      </div>,
      hint(range),
    ],
    value: () => (input.value === "" ? undefined : input.valueAsNumber),
    check: () => (input.validity.valid ? null : input.validationMessage || "not a valid number"),
  };
}

// A native range: "not set" (skipped) until moved, unless there is a default. The schema requires min and max.
function sliderControl(item: NumberItem): Control {
  const input = h("input", { type: "range", ariaLabel: item.label });
  const { min = 0, max = 100 } = item;
  input.min = String(min);
  input.max = String(max);
  if (item.step !== undefined) input.step = String(item.step);
  input.value = String(item.default ?? (min + max) / 2);
  const shown = <output className="range-value" ariaHidden="true" />;
  const slider = (
    <div className="slider">
      {input}
      {shown}
    </div>
  );
  let moved = item.default !== undefined;
  const show = () => {
    shown.textContent = moved ? input.value : "Not set";
    input.ariaValueText = moved ? input.value : "not set";
    slider.classList.toggle("set", moved);
  };
  input.addEventListener("input", () => {
    moved = true;
    show();
  });
  show();
  return {
    elements: [slider],
    value: () => (moved ? input.valueAsNumber : undefined),
    reset: () => {
      moved = false;
      show();
    },
  };
}

// The native picker. With time, the answer carries the phone's UTC offset on the picked day.
function dateControl(item: DateItem): Control {
  const { min, max, time } = item;
  const input = h("input", {
    type: time ? "datetime-local" : "date",
    className: "input",
    ariaLabel: item.label,
    value: item.default ?? "",
  });
  if (min) input.min = min;
  if (max) input.max = max;
  return {
    elements: [input, hint(bounds(min?.replace("T", " "), max?.replace("T", " ")))],
    value: () => (input.value ? (time ? withOffset(input.value) : input.value) : undefined),
    check: () => (input.validity.valid ? null : input.validationMessage || "not a valid date"),
  };
}

function control(item: Item, name: string) {
  switch (item.type) {
    case "confirm":
      return confirmControl(item, name);
    case "single":
    case "multi":
      return choiceControl(item, name);
    case "review":
      return reviewControl(item, name);
    case "rank":
      return rankControl(item);
    case "text":
      return textControl(item);
    case "number":
      return item.display === "slider" ? sliderControl(item) : numberControl(item);
    case "date":
      return dateControl(item);
  }
}

const LOCKABLE =
  ".opts input, .opts button, .seg input, .stepper input, .stepper button, .slider input, :scope > .input, :scope > .clear";

export type Field = ReturnType<typeof field>;

export function field(item: Item, index: number) {
  const { elements, value, check = () => null, reset } = control(item, `f-${item.id}`);
  const box = (
    <fieldset className={`q q-${item.type}`}>
      <legend>
        <span className="q-num" ariaHidden="true">
          {index + 1}
        </span>
        <span className="q-label">{item.label}</span>
        {item.required && <span className="req">Required</span>}
      </legend>
      {item.md && markdown(item.md, "q-md")}
      {elements}
    </fieldset>
  );

  // a radio or a moved slider can't be unset: optional ones get a way back to "skipped"
  if (!item.required && (item.type === "confirm" || item.type === "single" || item.type === "review" || reset)) {
    const clear = () => {
      for (const input of box.querySelectorAll<HTMLInputElement>("input:checked")) input.checked = false;
      reset?.();
      box.dispatchEvent(new Event("change", { bubbles: true }));
    };
    box.append(
      <button type="button" className="clear" onclick={clear}>
        Clear answer
      </button>,
    );
  }

  const error = <p className="q-err" id={`q-err-${item.id}`} />;
  for (const input of box.querySelectorAll("input, textarea")) input.setAttribute("aria-describedby", error.id);

  const delegateLabel = <span>Let the agent decide</span>;
  const delegate = (
    <button type="button" className="dice" ariaPressed="false">
      {icon("dice")}
      {delegateLabel}
    </button>
  );
  delegate.onclick = () => {
    const on = box.classList.toggle("delegated");
    delegate.ariaPressed = String(on);
    delegateLabel.textContent = on ? "The agent decides · undo" : "Let the agent decide";
    for (const input of box.querySelectorAll<HTMLInputElement | HTMLButtonElement>(LOCKABLE)) input.disabled = on;
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const comment = h("textarea", {
    rows: 2,
    className: "input",
    placeholder: "Comment for the agent",
    ariaLabel: `Comment on “${item.label}”`,
  });
  const commentLabel = <span>Add a comment</span>;
  const details = h(
    "details",
    { className: "comment" },
    <summary>
      {icon("message")}
      {commentLabel}
    </summary>,
    comment,
  );
  details.ontoggle = () => {
    if (details.open) comment.focus();
  };
  comment.oninput = () => {
    const added = !!comment.value.trim();
    commentLabel.textContent = added ? "Comment added" : "Add a comment";
    details.classList.toggle("has", added);
  };

  box.append(error, delegate, details);
  return { item, element: box, value, check, comment, error, delegated: () => box.classList.contains("delegated") };
}
