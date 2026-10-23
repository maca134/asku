// The landing page's demos: the real answer form on a pretend phone, next to a pretend agent terminal.
import { type Child, codeSpans, h, icon, markdown, sleep } from "../dom";
import { buildForm, type Form } from "../form/form";
import { sentPanel } from "../form/open";
import { formatTime, shell, statePanel } from "../page";
import { type Act, DEPLOY, EXAMPLE, type Scene, SHELL } from "./scenes";

const DEMO_URL = "asku.dev/a/k3J9xQ2mVb7LrT0aYc1E-w";
const LINK = `https://${DEMO_URL}#9f2c…e1a0`;
const JSON_TOKENS = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

// Pretty JSON as DOM nodes with highlight spans (built from text nodes, so typed input can't inject markup).
function jsonNodes(value: unknown) {
  const json = JSON.stringify(value, null, 2).replace(
    /\[\n\s*([^[\]{}]*?)\n\s*\]/g,
    (_, inner: string) => `[${inner.split(/,\n\s*/).join(", ")}]`,
  );
  const nodes: (Node | string)[] = [];
  let last = 0;
  for (const match of json.matchAll(JSON_TOKENS)) {
    const [token, string, colon] = match;
    const kind = string ? (colon ? "j-key" : "j-str") : /[\d-]/.test(token[0]) ? "j-num" : "j-lit";
    nodes.push(json.slice(last, match.index), <span className={kind}>{string ?? token}</span>);
    if (colon) nodes.push(colon);
    last = match.index + token.length;
  }
  nodes.push(json.slice(last));
  return nodes;
}

function phone(url: Child, screen: HTMLElement, overlay?: HTMLElement) {
  return (
    <div className="phone">
      <div className="phone-screen">
        <div className="phone-status" ariaHidden="true">
          <span>9:41</span>
          <span className="phone-island" />
          <span className="phone-bars" />
        </div>
        <div className="phone-url" ariaHidden="true">
          {icon("lock")}
          {url}
        </div>
        {screen}
        {overlay}
      </div>
    </div>
  );
}

// A deadline's countdown as on the answer page, on a pretend clock that never runs out.
export function countdown(before: Element, seconds: number, alive: () => boolean, moving = () => true) {
  const text = () => `The agent decides without you in ${formatTime(seconds)}`;
  const label = <span>{text()}</span>;
  before.before(
    <p className="countdown">
      {icon("clock")}
      {label}
    </p>,
  );
  const timer = setInterval(() => {
    if (!alive()) return clearInterval(timer);
    if (moving() && seconds > 1) {
      seconds--;
      label.textContent = text();
    }
  }, 1000);
}

// The real form, lightly interactive, next to the JSON it would send.
export function showcase() {
  const form = buildForm({ ...EXAMPLE, mood: "confident" });
  const output = <pre className="json" ariaLive="polite" ariaLabel="Answer JSON" />;
  countdown(form.fields[0].element, 1800, () => output.isConnected);
  const update = () => output.replaceChildren(...jsonNodes(form.collect(false).answer));
  form.form.addEventListener("input", update);
  form.form.addEventListener("change", update);
  form.form.onsubmit = (event) => {
    event.preventDefault();
    const { problems } = form.collect();
    update();
    const ok = !problems.length;
    if (ok) form.error.textContent = "Looks good. For real, this is encrypted and sent to your agent.";
    form.error.classList.toggle("ok", ok);
  };
  update();
  return (
    <div className="showcase">
      {phone(DEMO_URL, <div className="screen-scroll">{shell([form.form], "div")}</div>)}
      <div className="term term-sm">
        <div className="term-bar">
          <span className="dots" />
          <span className="term-title">ask.sh wait → stdout</span>
        </div>
        <div className="term-body">{output}</div>
      </div>
    </div>
  );
}

type Player = { paused: boolean; visible: boolean; take: number };
type Stage = {
  root: HTMLElement;
  terminal: HTMLElement;
  url: HTMLElement;
  screen: HTMLElement;
  tap: HTMLElement;
  player: Player;
};
const STOP = Symbol("stop");

// Animated centrepiece: the agent asks in a terminal, the phone answers, the JSON comes back. Loops.
export function demo(scene = DEPLOY) {
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const player: Player = { paused: false, visible: true, take: 0 };
  const toggle = h("button", { type: "button", className: "demo-toggle" });
  const showToggle = () =>
    toggle.replaceChildren(icon(player.paused ? "play" : "pause"), player.paused ? "Play" : "Pause");
  toggle.onclick = () => {
    player.paused = !player.paused;
    showToggle();
  };
  showToggle();

  const terminal = <div className="term-body" />;
  const url = <span className="url-text" />;
  const screen = <div className="screen-scroll" />;
  const tap = <span className="tap" />;
  const root = (
    <figure className={`demo cli-${scene.cli.id}`}>
      <figcaption className="demo-cap">
        <span>{codeSpans(scene.caption)}</span>
        {!still && toggle}
      </figcaption>
      <div className="demo-stage" ariaHidden="true" inert={true}>
        <div className="term">
          <div className="term-bar">
            <span className="dots" />
            <span className="term-title">{scene.cli.title}</span>
          </div>
          {terminal}
        </div>
        {phone(url, screen, tap)}
      </div>
    </figure>
  );
  new IntersectionObserver(([entry]) => {
    player.visible = entry.isIntersecting;
  }).observe(root);

  const stage: Stage = { root, terminal, url, screen, tap, player };
  // Start after the page has laid out, so the phone has a size to scroll in.
  requestAnimationFrame(async () => {
    if (still) return new Take(scene, stage, true).play(true);
    for (let first = true; root.isConnected; first = false)
      await new Take(scene, stage, false).play(first).catch((error) => {
        if (error !== STOP) throw error;
      });
  });
  return root;
}

// One run through a scene. A newer take, or the demo leaving the page, stops it at its next wait.
class Take {
  private readonly id: number;
  private readonly form: Form;
  private readonly feed: HTMLElement;

  constructor(
    private readonly scene: Scene,
    private readonly stage: Stage,
    private readonly fast: boolean,
  ) {
    this.id = ++stage.player.take;
    this.form = buildForm(scene.question);
    this.feed = (
      <ol className="feed">
        <li className="open">{this.form.form}</li>
      </ol>
    );
  }

  private get current() {
    return this.id === this.stage.player.take && this.stage.root.isConnected;
  }

  private get moving() {
    return !this.stage.player.paused && this.stage.player.visible && !this.fast;
  }

  // the first take opens on the prompt, not a blank terminal
  async play(first: boolean) {
    this.reset();
    const { deadline } = this.scene.question;
    if (deadline)
      countdown(
        this.form.fields[0].element,
        deadline,
        () => this.current,
        () => this.moving,
      );
    await this.ask(first);
    if (this.scene.followUp) await this.addFollowUp();
    const waiting = await this.waitForAnswer();
    const answer = await this.answer();
    await this.carryOn(waiting, answer);
  }

  private reset() {
    const { terminal, url, screen } = this.stage;
    terminal.replaceChildren();
    url.textContent = "";
    screen.scrollTop = 0;
    screen.replaceChildren(
      <div className="phone-idle">
        {icon("bubble")}
        <p>Waiting for a link from your agent</p>
      </div>,
    );
  }

  private async ask(first: boolean) {
    const prompt = this.line("prompt", <span className="t-dim">{"› "}</span>);
    if (first) prompt.append(this.scene.prompt);
    else {
      await this.wait(700);
      await this.type(prompt, this.scene.prompt);
    }
    await this.wait(500);
    this.say(this.scene.intro);
    await this.wait(600);
    const output = await this.run(`bash ask.sh ask ${this.scene.file}`);
    await this.wait(500);
    output("", <span className="t-warn">PENDING</span>);
    output("", "Give the user this link: ", <span className="t-link">{LINK}</span>);
    output("t-dim", "Run again to keep waiting: ask.sh wait");
    await this.wait(700);
  }

  private async addFollowUp() {
    const { say, followUp } = this.scene;
    this.say("Open this on your phone: ", <span className="t-link">{LINK}</span>);
    await this.openLink();
    if (say) {
      const output = await this.run(`bash ask.sh say "${say.replaceAll("*", "")}"`);
      await this.wait(300);
      output("", "Said.");
      const update = <li className="say">{markdown(say)}</li>;
      this.feed.append(update);
      await this.scrollTo(update);
      await this.wait(1200);
    }
    this.say(followUp!.say);
    await this.wait(500);
    const output = await this.run(`bash ask.sh add ${followUp!.file}`);
    await this.wait(400);
    this.form.append(followUp!.question);
    output("", <span className="t-warn">PENDING</span>);
    output("", "Sent. Add more with add, or run wait for the answer.");
    output("t-dim", "Run again to keep waiting: ask.sh wait");
    await this.wait(700);
  }

  private async waitForAnswer() {
    const output = await this.run("bash ask.sh wait");
    const spinner = output("t-dim", <span className="tspin" />, " waiting for your answer…");
    if (!this.scene.followUp) await this.openLink();
    return { output, spinner };
  }

  private async answer() {
    for (const act of this.scene.acts) await this.perform(act);
    await this.wait(500);
    const { answer } = this.form.collect(false);
    if (this.fast) this.stage.screen.scrollTop = 0;
    else {
      await this.press(this.form.sendButton, () => {
        this.form.sendLabel.textContent = "Sending…";
        this.form.sendButton.classList.add("busy");
      });
      await this.wait(700);
      this.stage.screen.replaceChildren(shell([sentPanel()], "div"));
    }
    return answer;
  }

  private async carryOn({ output, spinner }: Awaited<ReturnType<Take["waitForAnswer"]>>, answer: unknown) {
    spinner.remove();
    output("json", jsonNodes(answer));
    await this.wait(1200);
    this.say(this.scene.reply);
    await this.wait(800);
    const result = await this.run(this.scene.command);
    await this.wait(900);
    result("", <span className="t-ok">{"✓ "}</span>, this.scene.result);
    await this.wait(5000);
  }

  private async openLink() {
    const { url, screen } = this.stage;
    await this.wait(300);
    for (const chunk of this.fast ? [DEMO_URL] : DEMO_URL.match(/.{1,4}/g)!) {
      url.textContent += chunk;
      await this.wait(35);
    }
    screen.replaceChildren(
      shell([statePanel("wait", "Verifying link…", "Checking the agent's key against the link.")], "div"),
    );
    await this.wait(1100);
    screen.replaceChildren(shell([this.feed], "div"));
    this.form.form.classList.add("enter");
    await this.wait(1100);
  }

  private async perform(act: Act) {
    switch (act[0]) {
      case "pick": {
        const input = this.control<HTMLInputElement>(act[1], `input[value="${act[2]}"]`);
        return this.press(input.closest("label")!, () => {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      case "up": {
        const button = this.control(act[1], ".step-up");
        for (let i = 0; i < act[2]; i++) await this.press(button, () => button.click());
        return;
      }
      case "delegate": {
        const button = this.control(act[1], ".dice");
        return this.press(button, () => button.click());
      }
      case "text": {
        const input = this.control(act[1], ".input");
        await this.press(input, () => {});
        return this.type(input, act[2], 16);
      }
      case "comment": {
        const details = this.control<HTMLDetailsElement>(act[1], "details");
        await this.press(details.querySelector("summary")!, () => {
          details.open = true;
        });
        return this.type(details.querySelector("textarea")!, act[2], 16);
      }
    }
  }

  private control<T extends HTMLElement = HTMLElement>(id: string, selector: string) {
    return this.form.fields.find((f) => f.item.id === id)!.element.querySelector<T>(selector)!;
  }

  private async wait(ms: number) {
    if (this.fast) return;
    for (let waited = 0; waited < ms; ) {
      await sleep(40);
      if (!this.current) throw STOP;
      if (this.moving && !document.hidden) waited += 40;
    }
  }

  private scrollTerminal() {
    this.stage.terminal.scrollTop = this.stage.terminal.scrollHeight;
  }

  private line(className: string, ...children: Child[]) {
    const line = <div className={`tl ${className}`}>{children}</div>;
    this.stage.terminal.append(line);
    this.scrollTerminal();
    return line;
  }

  private say(...children: Child[]) {
    return this.line("agent", <span className="t-accent">{this.scene.cli.say}</span>, children);
  }

  private async type(target: HTMLElement, text: string, perSecond = 28) {
    const field = target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement ? target : null;
    for (const char of this.fast ? [text] : text) {
      if (field) {
        field.value += char;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      } else target.append(char); // after the prompt or tool mark
      this.scrollTerminal();
      await this.wait((1000 / perSecond) * (0.6 + Math.random() * 0.8));
    }
  }

  // A command and its output, grouped so each CLI can frame them its own way.
  private async run(command: string) {
    const { cli } = this.scene;
    const commandLine = (
      <div className="tl cmd">
        <span className="t-dim tool-mark">{cli.tool}</span>
      </div>
    );
    const group = <div className="tool">{commandLine}</div>;
    this.stage.terminal.append(group);
    await this.type(commandLine, cli.run(command), cli === SHELL ? 22 : 70);
    return (className: string, ...children: Child[]) => {
      const line = <div className={`tl out ${className}`}>{children}</div>;
      group.append(line);
      this.scrollTerminal();
      return line;
    };
  }

  private async scrollTo(element: HTMLElement) {
    const { screen } = this.stage;
    const target = element.getBoundingClientRect();
    const view = screen.getBoundingClientRect();
    const offset = target.top - view.top;
    if (offset < 50 || offset + target.height > view.height - 90) {
      screen.scrollBy({ top: offset - view.height * 0.3, behavior: this.fast ? "auto" : "smooth" });
      await this.wait(550);
    }
  }

  private async press(element: HTMLElement, action: () => void) {
    await this.scrollTo(element);
    if (!this.fast) await this.showTap(element);
    action();
    await this.wait(650);
  }

  private async showTap(element: HTMLElement) {
    const { tap, screen } = this.stage;
    const target = element.getBoundingClientRect();
    const frame = screen.parentElement!.getBoundingClientRect();
    tap.style.setProperty("--x", `${target.left - frame.left + Math.min(target.width / 2, 60)}px`);
    tap.style.setProperty("--y", `${target.top - frame.top + target.height / 2}px`);
    tap.classList.remove("on");
    void tap.offsetWidth; // restarts the ripple animation
    tap.classList.add("on");
    element.classList.add("pressed");
    await this.wait(180);
    element.classList.remove("pressed");
  }
}
