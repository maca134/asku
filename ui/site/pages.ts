// The site's pages: title, description and main heading. build.ts writes them into each page's
// static HTML (for crawlers and link previews), the app uses them for the live page.
export const ORIGIN = "https://asku.dev";

export type Page = {
  nav: string;
  title: string;
  description: string;
  h1: string;
  lead: string;
  faq?: [string, string][];
};

export const PAGES: Record<string, Page> = {
  "/": {
    nav: "Home",
    title: "asku: ask the user from Claude Code, Codex and Cursor, answer on your phone",
    description:
      "asku lets Claude Code, Codex, Cursor or any AI agent send you a question form you answer on your phone. End-to-end encrypted, no app, no account. The agent gets JSON back.",
    h1: "Your agent asks. You answer from anywhere.",
    lead: "Claude Code, Codex, Cursor or any agent sends you a form. Answer on your phone; it gets JSON back and keeps going. The relay only sees ciphertext.",
  },
  "/how": {
    nav: "How it works",
    title: "How asku works: human-in-the-loop questions for AI coding agents",
    description:
      "Your AI agent writes a question form as JSON and runs one script. You get a link, answer on any device, and the agent gets your answers back as JSON.",
    h1: "One link between your agent and you",
    lead: "No app, no account, no daemon. A tiny script on the agent's side and a web page on yours.",
    faq: [
      [
        "Is asku an MCP server?",
        "No. It's a skill: a markdown file and one script (bash or PowerShell) your agent runs from its shell. Any agent that can run commands can use it, with nothing to configure.",
      ],
      [
        "How is it different from Claude Code's built-in questions?",
        "Built-in questions appear in the terminal, so you have to be at it. asku sends the form to a link you can open on your phone or any browser, with markdown context and a comment box on every question, and it works with any agent, not just one.",
      ],
      [
        "Does it work with other skills?",
        'Yes. Any skill that asks you questions can send them through asku instead: add "with asku", as in `/grill-me with asku`. You get the full form controls even when you\'re at your desk.',
      ],
      [
        "Do I need an account?",
        "No. There's no sign-up, no app and no API key. A session is made when the agent first asks, and deleted when it closes or after 24 hours idle.",
      ],
      [
        "Will I know when the agent asks?",
        "Turn on notifications on the answer page and your phone buzzes when a new question arrives, with Yes/No buttons for a single yes/no question. The notification carries no question text through the relay. On iPhone, add asku.dev to the Home Screen first.",
      ],
      [
        "Can I stop the agent from my phone?",
        "Yes. The answer page has a message box and a STOP button. Both are encrypted like answers, and the agent sees them the next time it runs a command.",
      ],
      [
        "Can I run my own relay?",
        "Yes. The relay is one Bun process with SQLite, MIT licensed. Run it anywhere and point the script at it with ASKU_URL.",
      ],
    ],
  },
  "/security": {
    nav: "Security",
    title: "asku security: end-to-end encrypted questions from AI agents",
    description:
      "asku encrypts on your agent's machine and in your browser. The relay stores only ciphertext and deletes it when the session ends. Open source and small enough to audit.",
    h1: "The relay can't read your answers",
    lead: "Encryption happens on your agent's machine and in your browser. The server in the middle stores opaque envelopes and deletes them when the session ends.",
  },
  "/demo": {
    nav: "Demo",
    title: "asku demo: Claude Code, Codex CLI and Gemini CLI asking you on your phone",
    description:
      "See asku in Claude Code, Codex CLI and Gemini CLI: the agent asks, adds a follow-up while you answer on your phone, and carries on with your JSON.",
    h1: "Hand off the work, keep the decisions",
    lead: "Your agent asks when it needs you, adds follow-ups while you're answering, and carries on with your JSON. In whichever agent you use.",
  },
  "/install": {
    nav: "Install",
    title: "Install asku for Claude Code, Codex, Cursor and Gemini CLI",
    description:
      "Tell your agent: install the skill at asku.dev/skill.md. It saves the skill and one script for your OS: bash with curl and OpenSSL, or PowerShell.",
    h1: "Tell your agent to install it",
    lead: "Any agent that can run shell commands works: Claude Code, Codex, Cursor, Gemini CLI and the rest. It saves the skill and the script for your OS.",
  },
  "/start": {
    nav: "Start",
    title: "Start an asku session: send your AI agent a link",
    description:
      "Already chatting with your agent? Write it a message, get a link, paste the link into the chat, and the agent asks you its questions in your browser.",
    h1: "Start from the website",
    lead: "Already in a chat with your agent? Write it a message, get a link, and paste the link into the chat. The agent joins and asks you here.",
  },
  "/sessions": {
    nav: "Sessions",
    title: "Your asku sessions",
    description: "The asku sessions this browser holds. The list is read from this browser only, never the relay.",
    h1: "Sessions in this browser",
    lead: "Read from this browser's storage, so the relay learns nothing. Forget a session to delete its keys here.",
  },
  "/terms": {
    nav: "Terms",
    title: "Terms · asku",
    description: "Terms of use for asku.dev, the free end-to-end encrypted relay between AI agents and your browser.",
    h1: "Terms of use",
    lead: "Last updated: 24 October 2026",
  },
};

export type TermsSection = { heading: string; text?: string; points?: string[] };

export const TERMS: { intro: string; sections: TermsSection[] } = {
  intro:
    'asku.dev ("the service") is a free relay that passes end-to-end encrypted messages between an AI agent and a web browser. It is run by Matthew McConnell as a hobby project. By using it you agree to these terms.',
  sections: [
    {
      heading: "Your responsibility",
      points: [
        "A session is meant for the person running the agent. You are responsible for who you share a session link with. Anyone who opens the link first controls that session.",
        "You are responsible for what your agent does, including anything it does with the answers it receives.",
        "You must follow the terms of your AI provider and of any other service your agent uses.",
      ],
    },
    {
      heading: "Acceptable use",
      text: "Don't use the service to:",
      points: [
        "break the law or infringe anyone's rights,",
        "send malware, spam or content meant to harass or harm people,",
        "overload, probe or attack the relay, or get around its rate limits,",
        "run a service for third parties on top of it without permission.",
      ],
    },
    {
      heading: "What we can and can't see",
      points: [
        "Questions and answers are encrypted on your devices. The relay can't read them.",
        "The relay does see metadata: IP addresses, timestamps, session IDs and message sizes. It uses these to run the service and stop abuse.",
        "If you turn on notifications, the relay stores your browser's push subscription with the session and deletes it with the session. The notifications it sends hold only the session ID.",
        "Sessions are deleted when the agent closes them or after 24 hours without activity.",
        "We may keep basic server logs for up to 30 days.",
      ],
    },
    {
      heading: "Enforcement",
      text: "We may rate-limit, end or block sessions or clients at any time, without notice, to protect the service or other users.",
    },
    {
      heading: "No warranty",
      text: 'The service is provided "as is", without any warranty. It may be slow, unavailable or lose messages. Don\'t rely on it for anything critical. To the extent the law allows, we are not liable for any loss arising from your use of it.',
    },
    {
      heading: "Changes",
      text: "We may update these terms. Continuing to use the service means you accept the current version.",
    },
  ],
};
