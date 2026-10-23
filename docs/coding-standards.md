# Coding standards

asku moves questions and answers that only the agent and the user may read. The code should be quick to review,
above all where keys and plaintext are handled.

## Where things go

| Folder | What | Sees keys or plaintext? |
|---|---|---|
| `shared/crypto.ts` | Wire crypto (WebCrypto), used by the browser and the tests | Yes |
| `ui/session/` | Key storage, joining, binding, sealing and opening messages | Yes |
| `ui/form/` | The answer form. Shows decrypted questions; sends through a `send` callback | Plaintext only, never keys |
| `ui/site/` | Landing pages and demos | No |
| `ui/` (root) | `app.tsx` routing, `dom.tsx` helpers, `page.tsx` frame, `types.ts` wire formats, `jsx-runtime.ts` | No |
| `api/` | The relay: HTTP routes (`relay.ts`) and SQLite (`store.ts`) | No, ciphertext only |
| `skill/` | `SKILL.md` and the agent clients `ask.sh` / `ask.ps1` | Yes |

- Keep that boundary: code outside `shared/crypto.ts`, `ui/session/` and `skill/` must not import keys or call
  `seal`/`open`. If the form needs to send, it takes a callback.
- A wire-format or crypto change lands in `shared/crypto.ts`, `skill/ask.sh`, `skill/ask.ps1`, `test/vectors.json`
  (`bun run vectors`) and the README's Crypto section, in one commit.

## Names

- Names say what a thing is, in one or two words: `form`, `sendButton`, `agentPub`, `formatTime`.
- No single letters (`f`, `o`, `b`, `q`), except `i` for an index and `h` for the element helper.
- No abbreviations beyond the domain's own: `sid`, `seq`, `pub`, `priv`, `iv`, `ct`, `mac`, `q`/`a`.
- Wire fields and the README's crypto names stay as specified (`v`, `seq`, `dir`, `iv`, `ct`, `tag`), even where a
  longer name would read better.

## Comments

- The code should explain itself. A comment is a last resort: a short line saying *why*, when the code can't
  (a browser quirk, a security reason, a deliberate limit).
- Mark a deliberate shortcut with a known ceiling as `// ponytail: <limit>, <upgrade path>`.
- No comments that restate the code, no commented-out code, no section banners.

## Structure

- Functions do one thing and are named for it. When a function grows closures that share state (the open form, the
  demo player), make it a small class with named methods.
- Return early instead of nesting. One level of ternary is fine; deeper, use `if`s.
- Prefer data over code for content (page copy and Terms in `site/pages.ts`, demo scripts in `site/scenes.ts`).

## TypeScript

- `strict`, no `any`, no `@ts-ignore`. Types for untrusted input start as `unknown` and are narrowed or validated.
- Wire types follow `schema.json`; a question `Item` is a union per question type.
- `!` is fine after DOM lookups that can't fail, and nowhere else.

## UI

- JSX for structure. Use `h()` only when you need the element's own type (an input's `value`, a button's `disabled`).
- Text goes in as text (JSX children, `textContent`), never as HTML. The only `innerHTML` writes are `markdown()`
  (DOMPurify, no form controls) and the fixed icon SVGs.
- No inline styles or inline scripts: the CSP forbids them.
- Accessible by default: real buttons and labels, `aria-*` where the role isn't obvious, focus moved to new headings.

## Security

- Validate at every trust boundary: request bodies in the relay, decrypted messages against `schema.json` in the
  browser. Never trust a field of an envelope for `dir` or `seq`.
- Don't weaken the CSP, SRI or other headers in `api/relay.ts`.
- The relay's one runtime dependency is `web-push`, pinned: Web Push crypto isn't worth owning. Add no others.
  Add a browser dependency only when the platform can't do it.

## Tooling

- Biome formats (width 120) and lints: `bun run check`. Types: `bun run typecheck` (after `bun run build`, which
  generates `ui/gen/`). Tests: `bun test`. CI runs all three.
- A formatting-only commit goes in `.git-blame-ignore-revs`.
- Keep moves and renames in their own commits, separate from behaviour changes.
- After changing `ui/session/` or `ui/form/`, run the end-to-end check (`.claude/skills/e2e-local`).
