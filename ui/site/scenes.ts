// The demo's scripts: what you ask, the form, an optional `ask say` update and `ask add` follow-up, your taps on the
// phone, and what the agent does next.
import example from "../../examples/question.json";
import type { Question } from "../types";

export const EXAMPLE = example as Question;

// How each agent CLI draws its chat (approximated with text and colours, no logos).
export type Cli = {
  id: string;
  name: string;
  title: string;
  say: string;
  tool: string;
  run: (command: string) => string;
};

export const SHELL: Cli = {
  id: "shell",
  name: "Any agent",
  title: "agent — ~/shop",
  say: "● ",
  tool: "$ ",
  run: (command) => command,
};
const CLAUDE: Cli = {
  id: "claude",
  name: "Claude Code",
  title: "claude — ~/shop",
  say: "● ",
  tool: "● ",
  run: (command) => `Bash(${command})`,
};
const CODEX: Cli = {
  id: "codex",
  name: "Codex CLI",
  title: "codex — ~/shop",
  say: "• ",
  tool: "• ",
  run: (command) => `Ran ${command}`,
};
const GEMINI: Cli = {
  id: "gemini",
  name: "Gemini CLI",
  title: "gemini — ~/shop",
  say: "✦ ",
  tool: "✔ ",
  run: (command) => `Shell ${command}`,
};

export type Act =
  | ["pick", id: string, value: string]
  | ["up", id: string, times: number]
  | ["comment", id: string, text: string]
  | ["text", id: string, text: string]
  | ["delegate", id: string];

export type Scene = {
  name: string;
  cli: Cli;
  caption: string;
  prompt: string;
  intro: string;
  file: string;
  question: Question;
  say?: string;
  followUp?: { say: string; file: string; question: Question };
  acts: Act[];
  reply: string;
  command: string;
  result: string;
};

export const DEPLOY: Scene = {
  name: "Sign off a deploy",
  cli: SHELL,
  caption: "An agent asks for sign-off with `ask.sh`, you answer on your phone, it gets JSON back.",
  prompt: "Ship v2.3 once I've signed off. I'm heading out, ask me on my phone.",
  intro: "I'll send you the deploy plan to approve.",
  file: "deploy.json",
  question: EXAMPLE,
  acts: [
    ["pick", "go", "yes"],
    ["pick", "env", "prod"],
    ["pick", "checks", "lint"],
    ["pick", "checks", "test"],
    ["up", "pct", 3],
    ["comment", "pct", "Keep it low on Fridays"],
  ],
  reply: "Approved: Production, 25% canary, after lint and test. You noted Fridays, so I'll hold it at 25%.",
  command: "./deploy.sh v2.3 --env prod --canary 25",
  result: "v2.3 is live on 25% of production traffic",
};

export const SCENES: Scene[] = [
  {
    ...DEPLOY,
    cli: CLAUDE,
    caption:
      "In Claude Code: sign-off before it ships, a progress update with `say`, and a question added while you answer.",
    question: { ...EXAMPLE, mood: "confident" },
    say: "Build is green: **214** tests passed",
    followUp: {
      say: "One more thing while you're in there.",
      file: "notify.json",
      question: {
        title: "Afterwards",
        questions: [{ id: "notify", type: "confirm", label: "Post in #releases when it's live?" }],
      },
    },
    acts: [...DEPLOY.acts, ["pick", "notify", "yes"]],
    reply:
      "Approved: Production, 25% canary, after lint and test. You noted Fridays, so I'll hold it at 25% and post in #releases.",
  },
  {
    name: "Plan a feature",
    cli: CODEX,
    caption: "In Codex CLI: the design gets settled up front, and what you don't mind you leave to the agent.",
    prompt: "Add CSV export to the reports page. I'm in meetings all afternoon, ask me what you need.",
    intro: "A few choices before I start building.",
    file: "export.json",
    question: {
      title: "CSV export",
      md: "Reports page, **14 columns**, up to 50k rows.",
      questions: [
        {
          id: "rows",
          type: "single",
          label: "Which rows?",
          options: [
            { value: "filtered", label: "Current filters", md: "What's on screen" },
            { value: "all", label: "Everything" },
          ],
          default: "filtered",
        },
        {
          id: "cols",
          type: "multi",
          label: "Columns",
          options: ["date", "customer", "amount", "status", "notes"],
          default: ["date", "customer", "amount"],
        },
        { id: "email", type: "confirm", label: "Email a link for exports over 10k rows?" },
      ],
    },
    followUp: {
      say: "Spotted one more: amounts are stored in cents.",
      file: "amounts.json",
      question: {
        title: "Amounts",
        questions: [
          {
            id: "money",
            type: "single",
            label: "Show amounts as",
            options: [
              { value: "decimal", label: "12.34" },
              { value: "cents", label: "1234 (raw cents)" },
            ],
          },
        ],
      },
    },
    acts: [
      ["pick", "cols", "status"],
      ["pick", "email", "yes"],
      ["comment", "email", "Send from reports@"],
      ["delegate", "money"],
    ],
    reply:
      "Got it: current filters, 4 columns, and big exports go out by email from reports@. You left amounts to me: decimals, as on the page. Building it now.",
    command: "npm test -- export",
    result: "12 passed: CSV export",
  },
  {
    name: "Unblock a migration",
    cli: GEMINI,
    caption: "In Gemini CLI: a risky case waits for your call, with a deadline so the job can't stall all night.",
    prompt: "Migrate the users table to the new schema tonight. Don't guess on anything risky.",
    intro: "312 users share an email with another account. I need a call on these before I migrate.",
    file: "dupes.json",
    question: {
      title: "Duplicate accounts",
      mood: "nervous",
      deadline: 1800,
      md: "**312** users share an email with another account. No answer in 30 min and I'll skip them and migrate the rest.",
      questions: [
        {
          id: "merge",
          type: "single",
          label: "Merge each group into",
          options: [
            { value: "recent", label: "Most recent login" },
            { value: "oldest", label: "Oldest account" },
            { value: "skip", label: "Skip them, migrate the rest" },
          ],
        },
        { id: "snapshot", type: "confirm", label: "Snapshot the table first?" },
        { id: "batch", type: "number", label: "Batch size", min: 100, max: 5000, step: 100, default: 500 },
      ],
    },
    followUp: {
      say: "Also: 9 accounts have no email at all.",
      file: "no-email.json",
      question: {
        title: "No email",
        questions: [
          { id: "noEmail", type: "text", label: "What should I do with these 9?", placeholder: "e.g. archive them" },
        ],
      },
    },
    acts: [
      ["pick", "merge", "recent"],
      ["pick", "snapshot", "yes"],
      ["up", "batch", 3],
      ["text", "noEmail", "Archive them, I'll look Monday"],
    ],
    reply: "Merging into the most recent login, snapshot first, 800 rows a batch. Archiving the 9 with no email.",
    command: "bun run migrate --snapshot --batch 800",
    result: "48,213 users migrated · 312 merged · 9 archived",
  },
];
