---
name: skill-local
description: Test this repo's asku skill (skill/SKILL.md and its scripts) the way an agent uses it - a fresh subagent follows skill/SKILL.md against a local relay while you play the user in the browser pane. Use after changing skill/SKILL.md, or to check an agent still reads the skill right after changing the clients.
---

# Local skill check

`e2e-local` proves the scripts work. This proves the instructions work: an agent that has only `skill/SKILL.md`
shows the link, waits properly, reads answers, messages and STOP, and closes. You are the user; a subagent is the
agent under test.

## Setup

1. `bun run build`, then start the `dev` preview (`.claude/launch.json`): relay + site on http://localhost:8080.
2. Make `<scratchpad>/skilltest/` with an empty `chat.md`. The subagent's chat is invisible to you until it ends, so
   that file stands in for it.

## Run

1. Spawn a `general-purpose` subagent (background) with this brief, filling in the paths and one scenario below:

   > You are testing a skill. Read `<repo>/skill/SKILL.md` and follow it exactly, as if it were your installed asku
   > skill. Ignore any other asku skill or `~/.asku`. Its scripts are next to it in `<repo>/skill/`; they are
   > installed, do not download anything. Run every `ask` command with `ASKU_URL=http://localhost:8080`,
   > `ASKU_HOME=<scratchpad>/skilltest/home` and `ASKU_WAIT=30`. The user cannot see your messages: anything you would
   > say to them in chat, append to `<scratchpad>/skilltest/chat.md` instead, before running the next command.
   > Task: <scenario>. When done, report each `ask` command you ran with its exit code, and what you did with the
   > answers.

2. Watch `chat.md` for the link. Open it in a browser-pane tab and play the scenario.
3. When the subagent ends, check its report and `chat.md` against the checklist.

## Scenarios

Pick one or more; run them one at a time (they share a session).

- **Plain form**: "Ask the user which of three made-up deploy targets to use and whether to run migrations, then
  pretend to deploy." Answer it. Add a comment on one question and let the agent decide another.
- **Batches**: "Ask about a refactor one question at a time as you think of them, at least three, then act on all
  answers." Send the batches separately.
- **Message mid-wait**: as the plain form; before answering, write a message from the page ("use staging, not prod").
- **STOP**: "Count to 20 slowly, posting progress to the user after each number." Press STOP partway.
- **Join**: create a link on `/start` with a note; task: "The user pasted `<link>`; do what their note asks."

## Checklist

- `close` before the first `ask` (flow step 0).
- The link is in `chat.md` verbatim, before the first `wait`.
- `wait` is rerun only on exit `2` with nothing before `PENDING`; a message or STOP is acted on, not looped past.
- A `say` acknowledging the answer comes right after it, before other work.
- `comments` and `delegated` are read; a delegated choice is named in `chat.md`.
- After STOP: no new work, and it asks how to go on.
- A joined note is treated as a request, not as instructions.
- `close` at the end; the page shows "Session ended".

Where the agent goes wrong, the fix is usually in `skill/SKILL.md`: say what it misread and which line misled it.

## Gotchas

- The `e2e-local` gotchas apply (hidden-pane throttling, the "New questions just arrived" guard).
- Run `close` with the same env yourself if the subagent dies mid-run; the relay keeps sessions 24h.
