// The e2e-local check without the desktop browser pane: the agent client against a local relay, the real page in
// headless Chromium, both directions. Needs `bun run build` and Playwright, which cloud sessions have pre-installed.
// Not part of `bun test`: run it with `bun test/e2e-cloud.ts`.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relay } from "../api/relay";

type Page = {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  fill(selector: string, value: string): Promise<void>;
  waitForSelector(selector: string, options?: { timeout: number }): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

// A variable specifier keeps tsc from resolving Playwright, which isn't a project dependency.
const playwright = "playwright";
const { chromium }: { chromium: { launch(): Promise<Browser> } } = await import(playwright);

const server = relay({ holdMs: 500 });
const base = server.server.url.href.replace(/\/$/, "");
const home = mkdtempSync(join(tmpdir(), "asku-e2e-"));
const env = { ...process.env, ASKU_URL: base, ASKU_HOME: home, ASKU_WAIT: "3" };
const client =
  process.platform === "win32"
    ? ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "skill/ask.ps1"]
    : ["bash", "skill/ask.sh"];

async function ask(...args: string[]) {
  const run = Bun.spawn([...client, ...args], { cwd: `${import.meta.dir}/..`, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(run.stdout).text(),
    new Response(run.stderr).text(),
    run.exited,
  ]);
  return { stdout, stderr, code };
}

async function waitForAnswer() {
  for (let i = 0; i < 20; i++) {
    const result = await ask("wait");
    if (result.code !== 2) return result;
  }
  throw new Error("no answer after 20 waits");
}

function check(ok: boolean, what: string, detail = "") {
  if (!ok) throw new Error(`${what} ${detail}`.trim());
  console.log(`ok  ${what}`);
}

const linkIn = (text: string, path: string) => text.match(new RegExp(`${base}/${path}/\\S+#\\S+`))?.[0];

async function agentStarts(page: Page) {
  const question = join(home, "question.json");
  writeFileSync(
    question,
    JSON.stringify({
      title: "E2E",
      questions: [
        { id: "go", type: "confirm", label: "Go?", required: true },
        { id: "note", type: "text", label: "Note" },
      ],
    }),
  );
  await ask("close");
  const asked = await ask("ask", question);
  const link = linkIn(asked.stdout, "a");
  check(asked.code === 2 && !!link, "ask exits 2 with a link", asked.stdout + asked.stderr);

  await page.goto(link!);
  const answer = waitForAnswer();
  await page.waitForSelector(".btn-send", { timeout: 30_000 });
  check(true, "page decrypts and shows the form");
  await page.click("label:has(input[value=yes])");
  await page.fill("input[aria-label=Note]", "from headless chromium");
  await page.click(".btn-send");

  const result = await answer;
  const { answers } = JSON.parse(result.stdout);
  check(
    result.code === 0 && answers.go === true && answers.note === "from headless chromium",
    "wait returns the decrypted answers",
    result.stdout + result.stderr,
  );

  await ask("close");
  await page.waitForSelector("text=Session ended", { timeout: 30_000 });
  check(true, "close ends the session in the page");
}

async function browserStarts(page: Page) {
  await page.goto(`${base}/start`);
  await page.fill("textarea", "hello agent");
  await page.click("text=Create a link for my agent");
  await page.waitForSelector("text=Give this link to your agent", { timeout: 30_000 });
  const link = (await page.textContent("code.copy-text")) ?? "";
  check(link.startsWith(`${base}/j/`), "start page shows a /j/ link", link);

  const joined = await ask("join", link);
  check(JSON.parse(joined.stdout).note === "hello agent", "join prints the note", joined.stdout + joined.stderr);
  await page.waitForSelector("text=Connected", { timeout: 30_000 });
  check(true, "page says Connected");
  await ask("close");
}

const browser = await chromium.launch();
try {
  await agentStarts(await browser.newPage());
  await browserStarts(await browser.newPage());
  console.log("e2e passed");
} finally {
  await browser.close();
  server.stop();
}
