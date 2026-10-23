---
name: e2e-local
description: End-to-end check of asku against a local relay - the agent client (ask.ps1 or ask.sh) and the real answer page in the browser pane, both directions. Use after changing ui/session/, ui/form/, shared/crypto.ts, the relay, or the agent scripts.
---

# Local end-to-end check

Proves the encrypted round trip still works: the agent client seals a question, the page decrypts and shows it, the
answer comes back decrypted.

## Setup

1. `bun run build`, then start the `dev` preview (`.claude/launch.json`): relay + site on http://localhost:8080.
2. Point the client at it, with a throwaway home so your real sessions aren't touched:
   - `ASKU_URL=http://localhost:8080`
   - `ASKU_HOME=<scratchpad>/askhome`
   - `ASKU_WAIT=3` to `8`, so `ask`/`wait` return quickly
   - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File skill\ask.ps1 <command>`; else `bash skill/ask.sh <command>`.
3. Run `close` first, to clear a session left from a previous run.

## Agent starts

1. `ask examples/question.json`: exits 2 with the link.
2. Open the link in a browser-pane tab. It says "Connected": the browser has bound.
3. `wait`: only now does the agent send the question (it waits for the bind). The form appears.
4. Optional, to cover more: `add` a batch with a `deadline` (countdown, "new question" chip, per-batch send button)
   and `say "text"` (an update in the feed).
5. Answer in the page and send. Driving it with `javascript_tool` is fine: click inputs, then `.btn-send`.
6. `wait` until exit 0 and check the JSON: answers, `skipped`, `comments`, `delegated`.
7. Invalid form: `ask` a file with an unknown field; `wait` returns an `error` answer naming it.
8. `close`: the page shows "Session ended".

## Browser starts

1. On `/start`, write a note and press "Create a link for my agent". Copy the `/j/` link.
2. `join '<link>'` (quoted, it has a `#`): prints `{"note": "..."}` with your note. The page says "Connected".
3. `close`.

## Gotchas

- When the browser pane is hidden, background tabs are throttled: `requestAnimationFrame` pauses and timers slow to
  about once a second. The landing demo then looks stuck. Take screenshots to force paints, or check the DOM instead
  of waiting.
- Answering a batch added with `add` by script, without scrolling it into view, trips the "New questions just
  arrived" guard on the main send. It clears after one warning: send again.
- The relay keeps the session for 24h, so always `close` at the end.
