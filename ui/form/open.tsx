// The open form on the answer page: batches, deadlines, and sending.
// It never sees keys: the caller's send() encrypts.
import { icon } from "../dom";
import {
  addToFeed,
  batchName,
  feedEvent,
  formatTime,
  live,
  show,
  statePanel,
  tabTitle,
  WORKING,
  waiting,
} from "../page";
import type { Answer, Question } from "../types";
import type { Field } from "./fields";
import { buildForm, type Form } from "./form";

export type Batch = [seq: number, question: Question];
export type Send = (seqs: number[], answer: Answer) => Promise<void>;
type Part = { seq: number; fields: Field[]; footer: HTMLElement; countdown?: HTMLElement };

export const sentPanel = () =>
  statePanel(
    "done",
    "Answers sent",
    "Encrypted on this device and delivered to your agent. Keep this tab open for follow-up questions.",
    live(WORKING),
  );

const reveal = (element?: Element | null) =>
  element?.scrollIntoView({
    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    block: "start",
  });

const answers = (count: number) => (count === 1 ? "1 answer" : `${count} answers`);

const sendError = ({ message }: Error) =>
  message === "Failed to fetch"
    ? "Couldn't reach the relay. Check your connection and send again."
    : `Not sent: ${message}. Try again.`;

// Shows a form for one or more batches. Later batches go under it, with a chip pointing at them; with more than one
// open, each batch can be sent on its own, and the main button sends the rest.
export class OpenForm {
  readonly form: Form;
  sending = false;
  private readonly entry: HTMLElement;
  private readonly names: string[] = [];
  private readonly parts: Part[] = [];
  private readonly opened = Date.now();
  private unseen = 0;
  private firstUnseen?: Element;
  private readonly announcer = <p className="sr-only" ariaLive="polite" />;
  private readonly chip = <button type="button" className="new-chip" onclick={() => reveal(this.firstUnseen)} />;
  private readonly seen = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    this.chip.remove();
    this.unseen = 0;
    this.firstUnseen = undefined;
    this.seen.disconnect();
  });

  constructor(
    batches: Batch[],
    private readonly send: Send,
    private readonly done: () => void,
  ) {
    const [[seq, question], ...rest] = batches;
    this.form = buildForm(question);
    this.entry = <li className="open">{this.form.form}</li>;
    this.names.push(batchName(question));

    this.form.noteField.after(
      <div className="decline">
        <button type="button" className="btn btn-secondary btn-sm" onclick={() => this.submit(this.parts, true)}>
          Decline, send only the note
        </button>
      </div>,
    );
    this.form.form.append(this.announcer);
    this.form.form.onsubmit = (event) => {
      event.preventDefault();
      this.submit(this.parts);
    };

    this.addPart(seq, this.form.fields.slice(), question);
    for (const batch of rest) this.add(batch);

    addToFeed(this.entry);
    show();
    this.entry.scrollIntoView({ block: "start" });
    if (document.hidden) document.title = `● Question waiting · ${tabTitle()}`;
  }

  get closed() {
    return !this.form.form.isConnected;
  }

  add([seq, batch]: Batch) {
    const { elements, fields } = this.form.append(batch);
    this.names.push(batchName(batch));
    this.addPart(seq, fields, batch);
    const replayed = Date.now() - this.opened < 1000;
    if (!replayed) this.flagNew(elements[0], batch.questions.length);
  }

  private flagNew(element: Element, count: number) {
    this.unseen += count;
    this.firstUnseen ??= element;
    const above = element.getBoundingClientRect().bottom < 0;
    const text = `${this.unseen} new question${this.unseen === 1 ? "" : "s"} ${above ? "above" : "below"}`;
    this.chip.replaceChildren(icon(above ? "up" : "down"), text);
    this.announcer.textContent = text;
    if (!this.chip.isConnected) this.form.form.append(this.chip);
    this.seen.observe(element);
    if (document.hidden) document.title = `● New questions · ${tabTitle()}`;
  }

  private addPart(seq: number, fields: Field[], batch: Question) {
    const part: Part = { seq, fields, footer: <div className="batch-foot" /> };
    part.footer.append(
      <button type="button" className="btn btn-secondary btn-sm" onclick={() => this.submit([part])}>
        Send {fields.length === 1 ? "this answer" : `these ${fields.length} answers`}
      </button>,
    );
    fields[fields.length - 1].element.after(part.footer);
    this.parts.push(part);
    this.markMulti();
    if (batch.deadline) this.startCountdown(part, ((batch.sent ?? Date.now() / 1000) + batch.deadline) * 1000);
  }

  private markMulti() {
    this.form.form.classList.toggle("multi", this.parts.length > 1);
  }

  // A batch with a deadline counts down above its first question. At zero it locks: the agent stops waiting then.
  // ponytail: trusts the agent's and the phone's clocks to agree; both are usually NTP-synced.
  private startCountdown(part: Part, end: number) {
    const text = <span />;
    const countdown = (
      <p className="countdown" role="timer">
        {icon("clock")}
        {text}
      </p>
    );
    part.countdown = countdown;
    part.fields[0].element.before(countdown);
    const tick = () => {
      if (!countdown.isConnected) return clearInterval(timer);
      const left = Math.ceil((end - Date.now()) / 1000);
      if (left > 0) {
        text.textContent = `The agent decides without you in ${formatTime(left)}`;
        countdown.classList.toggle("soon", left <= 60);
      } else if (!this.sending) {
        clearInterval(timer);
        this.expire(part);
      }
    };
    const timer = setInterval(tick, 1000);
    setTimeout(tick); // once the constructor has put the form on the page
  }

  private expire(part: Part) {
    part.countdown!.replaceWith(
      <p className="batch-sent expired">
        {icon("clock")}
        Time's up. The agent went ahead without these answers.
      </p>,
    );
    part.footer.remove();
    this.drop(part);
    if (this.parts.length) return;
    this.close(feedEvent("clock", `Time's up, the agent went ahead: ${this.names.join(" · ")}`, "expired"));
    this.done();
  }

  private drop(part: Part) {
    this.form.remove(part.fields);
    this.parts.splice(this.parts.indexOf(part), 1);
    this.markMulti();
  }

  private close(entry: HTMLElement) {
    this.seen.disconnect();
    this.entry.replaceWith(entry);
    show(waiting());
  }

  private setBusy(on: boolean) {
    this.sending = on;
    for (const button of this.form.form.querySelectorAll<HTMLButtonElement>(".btn")) button.disabled = on;
    this.form.sendLabel.textContent = on ? "Sending…" : "Send answers";
  }

  private async submit(parts: Part[], declined = false) {
    if (this.sending) return;
    const all = parts.length === this.parts.length;
    const answer = declined ? this.declined(parts) : this.answered(parts, all);
    if (!answer) return;
    this.setBusy(true);
    try {
      const seqs = parts.map((part) => part.seq);
      await this.send(seqs, { seqs, ...answer });
      if (all) this.close(feedEvent("check", `${declined ? "Declined" : "Answered"}: ${this.names.join(" · ")}`));
      else this.markSent(parts);
    } catch (error) {
      this.setBusy(false);
      this.form.error.textContent = sendError(error as Error);
    }
    this.done();
  }

  private declined(parts: Part[]): Answer | undefined {
    const note = this.form.note.value.trim();
    if (!note) {
      this.form.error.textContent = "Write a note first, so the agent knows why you're not answering.";
      this.form.note.focus();
      return;
    }
    const skipped = parts.flatMap((part) => part.fields.map((f) => f.item.id));
    return { answers: {}, skipped, comments: {}, note, declined: true };
  }

  private answered(parts: Part[], all: boolean): Answer | undefined {
    const { answer, problems } = this.form.collect(
      true,
      parts.flatMap((part) => part.fields),
    );
    if (problems.length) {
      reveal(this.form.form.querySelector(".invalid"));
      this.form.form.querySelector<HTMLElement>(".invalid [aria-describedby]")?.focus({ preventScroll: true });
      return;
    }
    // unseen questions would go out as "skipped"
    if (all && this.unseen) {
      this.form.error.textContent = "New questions just arrived. Have a look, then send again.";
      reveal(this.firstUnseen);
      this.unseen = 0;
      return;
    }
    // the note is for the whole form, so it goes with the last send
    return all ? answer : { ...answer, note: "" };
  }

  private markSent(parts: Part[]) {
    for (const part of parts) {
      part.countdown?.remove();
      part.footer.replaceWith(
        <p className="batch-sent">
          {icon("check")}
          Sent {answers(part.fields.length)}
        </p>,
      );
      this.drop(part);
    }
    this.form.error.textContent = "";
    this.setBusy(false);
  }
}
