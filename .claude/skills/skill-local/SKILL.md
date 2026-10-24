---
name: skill-local
description: Hands-on local test of asku for the user - you drive the agent client against a local relay, following skill/SKILL.md, while the user answers in their own browser over several rounds that cover every control, every mood, say lines, progress bars, batches, messages, timeout, decline, STOP and join. Use when the user wants to try asku locally themselves, or after changing skill/SKILL.md, the clients or the form UI.
---

# Local hands-on test

The user is the tester. You play the agent: follow `skill/SKILL.md` exactly, as if it were the installed asku skill,
and the user answers each round in their own browser. Every control, mood and agent feature gets used at least once.

**The link is what matters most.** End every round's turn with the link and that round's instructions in your final
message. Text between tool calls may never reach the user; if they ever have to ask for the link, the test failed.

## Setup

1. `bun run build`, then start the `dev` preview (`.claude/launch.json`): relay + site on http://localhost:8080.
2. Run the client against it with a throwaway home, so real sessions aren't touched:
   - `ASKU_URL=http://localhost:8080`, `ASKU_HOME=<scratchpad>/askhome`, `ASKU_WAIT` left at its default
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File skill\ask.ps1 <command>`; else `bash skill/ask.sh <command>`.
   - `wait` runs in the background (a person is answering); give `ask` and `join` a tool timeout of 600000.
3. `close` first (flow step 0).
4. In the first round's message, tell the user: open the link in their own browser (not the browser pane), keep the tab open for the whole test,
   and use each round's instructions, which are in the form's `md` as well as in chat.

## Each round

1. Write the form to `<scratchpad>/rN.json`. Put the instructions for the user in the form `md` and in chat: what to
   pick, type, comment, skip or delegate, so the expected answer is known.
2. `ask` (or `add`), then start `wait` in the background and end your turn with a message holding the link (every
   round, in case they lost the tab) and the round's instructions. Text between tool calls may never reach the user:
   only the message that ends the turn counts. The finished `wait` wakes you; rerun it on exit `2` with nothing
   before `PENDING`, as `skill/SKILL.md` says.
3. `say` one line acknowledging the answer straight away.
4. Check the answer JSON against the instructions and tell the user in one or two lines: match, or what differs.
   Ask what looked wrong on the page; their `note` and `comments` are a good place for that.

Between rounds, `say` a line or two about what's next, and use a progress bar now and then (several `--progress`
steps with the same label, ending at done = total). Don't say every step: the feed should read like a real agent.

## Rounds

Give every form a `title` and some `md` (a table or code block somewhere). Use each mood once, in this order.

1. **confident**, set `name` ("asku: local test"). `confirm` with a `default`; `single` with object options carrying
   `md`, a `default` and `other`; `multi` with `min`/`max` and `other`; multiline `text` with `placeholder` and
   `maxLength`; one `required`. User: type an "Other" in both, comment on one question, let the agent decide one,
   skip one optional. Check: write-ins come back as plain values, `comments`, `delegated` (name what you chose),
   `skipped`.
2. **excited**, first a progress bar over 4-5 `say`s. `number` stepper with `min`/`max`/`step`; `number` slider with
   no `default`; `date`; `date` with `time` and `min`; `rank`; `review` with `required`. User: leave the slider
   untouched, reorder the rank, reject one review item. Check: slider in `skipped`, rank order, review booleans, the
   date-time has a UTC offset.
3. **nervous**, batches. `add` a batch with a `confirm` and a question `when` on it; `say` something; `add` a second
   batch with a `single` and a question `when` on one of its values, plus a `confirm` with `display: "button"`.
   User: send the first batch on its own with its batch button, then the rest; make one `when` question show and one
   stay hidden; leave the red button unpressed. Check: two `wait`s may each return part, the hidden question and the
   unpressed button are in `skipped`, never `false`.
4. **begging**, `deadline` 60 with the fallback in `md`. User: don't answer. Check: `timeout: true`, then `say` what
   you fell back to.
5. **grumpy**. User: decline the form with a note. Check: `declined: true` and the note.
6. **sheepish**. User: before answering, write a message from the page ("use staging, not prod"). Check: `wait`
   prints `{"message":…}` then `PENDING`; acknowledge it with `say`, then wait again for the answer.
7. **STOP**. No form: count to 20 with `say "Counting" --progress n/20` every few seconds, plus a plain `say` at 5
   and 15. User: press STOP partway. Check: exit `3` with `{"stop":true}`; start nothing new and ask in chat how to
   go on.
8. **Invalid form**: `ask` a file with an unknown field. Check: an `error` answer naming it; tell the user what they
   should have seen on the page.
9. **Join**: `close`. The user opens http://localhost:8080/start, writes a note and creates a link, then pastes it in
   chat. Save it to `<scratchpad>/link` and `join` from that file, never the link in a command. Check: `{"note": …}`
   matches, treated as a request. One small form to prove the joined session works.
10. `close`. The user confirms the page shows "Session ended".

## Wrap up

Summarise per round: what passed, what the user reported looking wrong, and where the fix probably lives
(`ui/form/`, `ui/session/`, a client, or `skill/SKILL.md` if you, following it, were misled by a line).

## Gotchas

- Run `close` with the same env if the test stops early; the relay keeps sessions 24h.
- If the user wants to try it on their phone: localhost won't reach it. Skip unless they ask.
