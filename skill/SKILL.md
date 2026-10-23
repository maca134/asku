---
name: asku
description: Ask the user questions through an end-to-end encrypted web form they answer on any device (phone, tablet, desktop). Use when you need a decision, a choice between options, or free-text input from the user and they may be away from the terminal, or when they paste an asku.dev/j/ link.
---

# asku

Send the user a form of questions; they answer in a browser at asku.dev; you get the answers as JSON.
Everything is encrypted on your machine, the relay never sees plaintext.

## Setup

If `ask.sh` or `ask.ps1` is next to this file, use that one and skip setup. Never re-download it unless the user asks.

**Installing.** If the user asks you to install this skill, create an `asku` folder in your skills directory,
save https://asku.dev/skill.md there as `SKILL.md`, and download the script for your OS next to it (below).
Installing again updates both; `ask version` shows the client version.

Otherwise, download the script for your OS and keep it somewhere stable (e.g. `~/.asku/`):

```bash
curl -fsSLO https://asku.dev/ask.sh && chmod +x ask.sh      # Linux/macOS: needs bash, curl, OpenSSL >= 1.1.1
```
```powershell
iwr https://asku.dev/ask.ps1 -OutFile ask.ps1                # Windows: PowerShell 5.1+, nothing else
```

On Windows run it as `powershell -NoProfile -ExecutionPolicy Bypass -File ask.ps1 <command> ...` (its messages print that full command).
Below, `ask` means whichever script you use.

## Commands

| Command | Does |
|---|---|
| `ask ask <file.json>` | Send a question form (`-` reads stdin, `ask.sh` only) |
| `ask add <file.json>` | Append questions to the open form (or open one) without waiting |
| `ask join <link>` | Join a session the user started on asku.dev; returns their opening note |
| `ask wait` | Keep waiting for the answer after `PENDING` |
| `ask close` | End the session and purge it from the relay |
| `ask version` | Print the client version |

Exit codes, check every time:
- `0`: answer JSON on stdout. It may be an `error` answer instead (see Answer format). If stderr says batches are still open, run `ask wait` again for their answers.
- `2`: stdout starts with `PENDING`. Show the first link to the user verbatim; later messages repeat it only in case they lost the page. Then run `ask wait` (again, as often as needed).
- `1`: error on stderr, with the command to run next where there is one.

**Timeouts.** `ask`, `wait` and `join` wait up to `ASKU_WAIT` seconds (default 500) and then exit `2`. Run them with a
tool timeout of 10 minutes (Claude Code's Bash: `timeout: 600000`), or set `ASKU_WAIT` below your tool's timeout.
`PENDING` just means the user hasn't answered yet.

## Flow

0. Starting a new task? Run `ask close` first, so a session left over from earlier can't swallow your questions.
1. Write the questions to a file and run `ask ask q.json`. The first call exits `2` right away with the link: give it to the user.
2. Run `ask wait` until it exits `0`.
3. Ask follow-ups with more `ask ask` calls in the same session, one form at a time: the next `ask` is refused until the last one is answered.
4. Run `ask close` when done.

**Appending.** To send questions as you think of them, use `ask add` instead of `ask ask`: each batch goes to the bottom
of the form the user has open and `add` returns at once (exit `2`; the first one prints the link). Run `ask wait` when you
need the answers: one submit returns one answer covering every batch. Ids must be unique across the open form, and
it holds 50 questions at most (`add` refuses otherwise). If `wait` says on stderr that batches are still pending,
some of the form is still unanswered (for example the user submitted before a batch arrived): run `wait` again.

If the user pastes a link like `https://asku.dev/j/<id>#…`, run `ask join '<link>'` (quote it, it has a `#`) instead of step 1. It prints `{"note": "…"}`, the user's opening message (it can exit `2` first: then `ask wait`). If it says the session is in use, `ask close` or set `ASKU_SESSION`. Then continue from step 3.

Sessions are named by `ASKU_SESSION` (default `default`). Use a different name to run separate conversations at once.

## Question format

```json
{
  "title": "Deploy plan",
  "md": "About to deploy **v2.3** to production.",
  "questions": [
    { "id": "go", "type": "confirm", "label": "Deploy now?", "required": true },
    { "id": "env", "type": "single", "label": "Target", "options": ["staging", { "value": "prod", "label": "Production", "md": "Live traffic" }], "default": "staging" },
    { "id": "checks", "type": "multi", "label": "Run checks", "options": ["lint", "test", "e2e"], "min": 1 },
    { "id": "why", "type": "text", "label": "Release notes", "multiline": true, "placeholder": "Optional" },
    { "id": "pct", "type": "number", "label": "Canary %", "min": 0, "max": 100, "step": 5, "default": 10 }
  ]
}
```

- `questions`: 1 to 50 items. `id` matches `[A-Za-z0-9_-]{1,64}`, `label` is required.
- Types and their extra fields:
  - `confirm`: yes/no. `default` boolean.
  - `single`: pick one. `options` required, `default` string.
  - `multi`: pick several. `options` required, `default` string[], `min`, `max`.
  - `text`: `default`, `placeholder`, `multiline`, `maxLength`.
  - `number`: `default`, `min`, `max`, `step`.
- Options are strings, or `{value, label?, md?}`.
- `md` (markdown) works on the form, each question and each option: use it for context, diffs, tables.
- `required: true` forces an answer; anything else can be skipped.
- Unknown fields are rejected. Full schema: https://asku.dev/schema.json

## Answer format

```json
{
  "answers": { "go": true, "env": "prod", "checks": ["lint", "test"], "pct": 25 },
  "skipped": ["why"],
  "comments": { "pct": "Keep it low on Fridays" },
  "note": ""
}
```

- `answers`: confirm → boolean, single/text → string, multi → string[], number → number.
- `skipped`: optional questions the user left blank.
- `comments`: free text the user attached to a question. Read them, they often change the answer.
- `note`: free text for the whole form.
- `error`: present instead if the browser rejected your form as invalid. Fix it and `ask` again. For an appended batch, only that batch was dropped: fix it and `add` it again.

## Tips

- Batch related questions into one form instead of many rounds.
- Prefer `confirm`/`single`/`multi` over `text`: they're quicker to answer on a phone.
- Put the context the user needs in `md` so they can decide without seeing your terminal.
- Always `close` when finished.
