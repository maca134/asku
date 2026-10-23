// The site's pages: title, description and main heading. build.ts writes them into each page's
// static HTML (for crawlers and link previews), the app uses them for the live page.
export const ORIGIN = "https://asku.dev";

export type Page = { nav: string; title: string; description: string; h1: string; lead: string; faq?: [string, string][] };

export const PAGES: Record<string, Page> = {
  "/": {
    nav: "Home",
    title: "asku: ask the user from Claude Code, Codex and Cursor, answer on your phone",
    description: "asku lets Claude Code, Codex, Cursor or any AI agent send you a question form you answer on your phone. End-to-end encrypted, no app, no account. The agent gets JSON back.",
    h1: "Your agent asks. You answer from anywhere.",
    lead: "asku turns questions from Claude Code, Codex, Cursor or any other agent into a rich form you answer on your phone. The agent gets JSON back and keeps working. The relay in between only ever sees ciphertext.",
  },
  "/how": {
    nav: "How it works",
    title: "How asku works: human-in-the-loop questions for AI coding agents",
    description: "Your AI agent writes a question form as JSON and runs one script. You get a link, answer on any device, and the agent gets your answers back as JSON.",
    h1: "One link between your agent and you",
    lead: "No app, no account, no daemon. A tiny script on the agent's side and a web page on yours.",
    faq: [
      ["Is asku an MCP server?", "No. It's a skill: a markdown file and one script (bash or PowerShell) your agent runs from its shell. Any agent that can run commands can use it, with nothing to configure."],
      ["How is it different from Claude Code's built-in questions?", "Built-in questions appear in the terminal, so you have to be at it. asku sends the form to a link you can open on your phone or any browser, with markdown context and a comment box on every question, and it works with any agent, not just one."],
      ["Do I need an account?", "No. There's no sign-up, no app and no API key. A session is made when the agent first asks, and deleted when it closes or after 24 hours idle."],
      ["Can I run my own relay?", "Yes. The relay is one Bun process with SQLite, MIT licensed. Run it anywhere and point the script at it with ASKU_URL."],
    ],
  },
  "/security": {
    nav: "Security",
    title: "asku security: end-to-end encrypted questions from AI agents",
    description: "asku encrypts on your agent's machine and in your browser. The relay stores only ciphertext and deletes it when the session ends. Open source and small enough to audit.",
    h1: "The relay can't read your answers",
    lead: "Encryption happens on your agent's machine and in your browser. The server in the middle stores opaque envelopes and deletes them when the session ends.",
  },
  "/demo": {
    nav: "Demo",
    title: "asku demo: Claude Code, Codex CLI and Gemini CLI asking you on your phone",
    description: "See asku in Claude Code, Codex CLI and Gemini CLI: the agent asks, adds a follow-up while you answer on your phone, and carries on with your JSON.",
    h1: "Hand off the work, keep the decisions",
    lead: "Your agent asks when it needs you, adds follow-ups while you're answering, and carries on with your JSON. In whichever agent you use.",
  },
  "/install": {
    nav: "Install",
    title: "Install asku for Claude Code, Codex, Cursor and Gemini CLI",
    description: "Tell your agent: install the skill at asku.dev/skill.md. It saves the skill and one script for your OS: bash with curl and OpenSSL, or PowerShell.",
    h1: "Tell your agent to install it",
    lead: "Any agent that can run shell commands works: Claude Code, Codex, Cursor, Gemini CLI and the rest. It saves the skill and the script for your OS.",
  },
  "/start": {
    nav: "Start",
    title: "Start an asku session: send your AI agent a link",
    description: "Already chatting with your agent? Write it a message, get a link, paste the link into the chat, and the agent asks you its questions in your browser.",
    h1: "Start from the website",
    lead: "Already in a chat with your agent? Write it a message, get a link, and paste the link into the chat. The agent joins and asks you here.",
  },
  "/terms": {
    nav: "Terms",
    title: "Terms · asku",
    description: "Terms of use for asku.dev, the free end-to-end encrypted relay between AI agents and your browser.",
    h1: "Terms of use",
    lead: "Last updated: 23 October 2026",
  },
};
