// One question's control, with its comment box and "Let the agent decide".
import { h, icon, md } from "../dom";
import type { Item, Option } from "../types";

// ---- controls
const opt = (o: Option) => (typeof o === "string" ? { value: o, label: o, md: undefined } : { value: o.value, label: o.label ?? o.value, md: o.md });

function choice(type: "radio" | "checkbox", name: string, value: string, label: string, checked: boolean, detail?: string) {
  const input = h("input", { type, name, value, checked, className: "pick" });
  return { input, el: h("label", { className: "opt" }, input, h("span", { className: "opt-body" }, h("span", { className: "opt-label", textContent: label }), detail ? md(detail) : null)) };
}

function yesNo(name: string, value: string, label: string, checked: boolean) {
  const input = h("input", { type: "radio", name, value, checked, className: "sr-only" });
  return { input, el: h("label", { className: `yn yn-${value}` }, input, icon(value === "yes" ? "check" : "x"), h("span", { textContent: label })) };
}

const range = (it: Item) => [
  it.min !== undefined && it.max !== undefined ? `${it.min} to ${it.max}` : it.min !== undefined ? `at least ${it.min}` : it.max !== undefined ? `at most ${it.max}` : "",
  it.step !== undefined ? `step ${it.step}` : "",
].filter(Boolean).join(" · ");

export function field(it: Item, i: number) {
  const msg = h("p", { className: "q-err", id: `q-err-${it.id}` });
  const box = h("fieldset", { className: `q q-${it.type}` },
    h("legend", {},
      h("span", { className: "q-num", textContent: String(i + 1), ariaHidden: "true" }),
      h("span", { className: "q-label", textContent: it.label }),
      it.required ? h("span", { className: "req", textContent: "Required" }) : null),
    it.md ? md(it.md, "q-md") : null);
  const name = `f-${it.id}`;
  let value: () => unknown;
  let check = (): string | null => null;

  switch (it.type) {
    case "confirm": {
      const yes = yesNo(name, "yes", "Yes", it.default === true);
      const no = yesNo(name, "no", "No", it.default === false);
      box.append(h("div", { className: "seg" }, yes.el, no.el));
      value = () => (yes.input.checked ? true : no.input.checked ? false : undefined);
      break;
    }
    case "single":
    case "multi": {
      const multi = it.type === "multi";
      const def = new Set<string>(multi ? it.default ?? [] : it.default !== undefined ? [it.default] : []);
      const cs = it.options!.map(opt).map((o) => choice(multi ? "checkbox" : "radio", name, o.value, o.label, def.has(o.value), o.md));
      const hint = multi ? [it.min !== undefined && it.min > 1 && `pick at least ${it.min}`, it.max !== undefined && `at most ${it.max}`].filter(Boolean).join(", ") : "";
      box.append(h("div", { className: "opts" }, ...cs.map((c) => c.el)));
      if (hint) box.append(h("p", { className: "hint", textContent: hint[0].toUpperCase() + hint.slice(1) }));
      const picked = () => cs.filter((c) => c.input.checked).map((c) => c.input.value);
      value = () => (multi ? (picked().length ? picked() : undefined) : picked()[0]);
      if (multi) check = () => {
        const n = picked().length;
        if (n && it.min !== undefined && n < it.min) return `pick at least ${it.min}`;
        if (it.max !== undefined && n > it.max) return `pick at most ${it.max}`;
        return null;
      };
      break;
    }
    case "text": {
      const el = it.multiline ? h("textarea", { rows: 4 }) : h("input", { type: "text" });
      Object.assign(el, { placeholder: it.placeholder ?? "", value: it.default ?? "", className: "input", ariaLabel: it.label });
      if (it.maxLength) el.maxLength = it.maxLength;
      box.append(el);
      value = () => (el.value.trim() ? el.value : undefined);
      break;
    }
    case "number": {
      // iOS's decimal keypad has no minus key
      const el = h("input", { type: "number", inputMode: it.min !== undefined && it.min >= 0 ? "decimal" : "text", className: "input", ariaLabel: it.label, value: it.default !== undefined ? String(it.default) : "" });
      if (it.min !== undefined) el.min = String(it.min);
      if (it.max !== undefined) el.max = String(it.max);
      el.step = it.step !== undefined ? String(it.step) : "any";
      const bump = (d: number) => {
        const v = (el.value === "" ? it.default ?? it.min ?? 0 : el.valueAsNumber) + d * (it.step ?? 1);
        el.value = String(Math.round(Math.min(it.max ?? Infinity, Math.max(it.min ?? -Infinity, v)) * 1e9) / 1e9);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      };
      const btn = (d: number) => h("button", { type: "button", className: `stepbtn ${d > 0 ? "step-up" : "step-down"}`, ariaLabel: d > 0 ? "Increase" : "Decrease", onclick: () => bump(d) }, icon(d > 0 ? "plus" : "minus"));
      const r = range(it);
      box.append(h("div", { className: "stepper" }, btn(-1), el, btn(1)));
      if (r) box.append(h("p", { className: "hint", textContent: r[0].toUpperCase() + r.slice(1) }));
      value = () => (el.value === "" ? undefined : el.valueAsNumber);
      check = () => (el.validity.valid ? null : el.validationMessage || "not a valid number");
      break;
    }
  }

  // a radio can't be unticked: optional ones get a way back to "skipped"
  if (!it.required && (it.type === "confirm" || it.type === "single")) {
    box.append(h("button", { type: "button", className: "clear", textContent: "Clear answer", onclick: () => {
      box.querySelectorAll<HTMLInputElement>("input:checked").forEach((x) => (x.checked = false));
      box.dispatchEvent(new Event("change", { bubbles: true }));
    } }));
  }
  box.querySelectorAll("input, textarea").forEach((x) => x.setAttribute("aria-describedby", msg.id));
  // "you decide": the question counts as answered, and the agent picks
  const dice = h("button", { type: "button", className: "dice", ariaPressed: "false" }, icon("dice"), h("span", { textContent: "Let the agent decide" }));
  dice.onclick = () => {
    const on = box.classList.toggle("delegated");
    dice.ariaPressed = String(on);
    dice.lastChild!.textContent = on ? "The agent decides · undo" : "Let the agent decide";
    box.querySelectorAll<HTMLInputElement | HTMLButtonElement>(".opts input, .seg input, .stepper input, .stepper button, :scope > .input, :scope > .clear").forEach((x) => (x.disabled = on));
    box.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const comment = h("textarea", { rows: 2, className: "input", placeholder: "Comment for the agent", ariaLabel: `Comment on “${it.label}”` });
  const sumText = h("span", { textContent: "Add a comment" });
  const det = h("details", { className: "comment" }, h("summary", {}, icon("message"), sumText), comment);
  det.ontoggle = () => { if (det.open) comment.focus(); };
  comment.oninput = () => { sumText.textContent = comment.value.trim() ? "Comment added" : "Add a comment"; det.classList.toggle("has", !!comment.value.trim()); };
  box.append(msg, dice, det);
  return { it, el: box, value: value!, check, comment, msg, delegated: () => box.classList.contains("delegated") };
}
