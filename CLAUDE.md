## Project

asku: an agent sends the user an end-to-end encrypted question form; the relay only ever stores ciphertext.
Follow `docs/coding-standards.md`: it covers layout, the key/plaintext boundary, names, comments and tooling.

- `api/` relay (Bun + SQLite), `shared/crypto.ts` wire crypto, `ui/` browser app (`session/` is the trusted part),
  `skill/` the agent clients and SKILL.md.
- `bun run build` first: it generates `ui/gen/` (schema validator and its types), which typecheck and the app need.
- Before committing: `bun run check`, `bun run typecheck`, `bun test`.
- Changing `ui/session/` or `ui/form/`: also run the `e2e-local` skill (`.claude/skills/e2e-local/SKILL.md`).
- Changes to `shared/`, `ui/session/`, `ui/form/`, `ui/dom.tsx`, `skill/`, `api/`, `build.ts`, `Dockerfile`, `compose.yaml` or
  `.github/workflows/`: run the `security-reviewer` agent before the PR.
- Wire-format or crypto changes go in all of `shared/crypto.ts`, `skill/ask.sh`, `skill/ask.ps1`, `test/vectors.json`
  and the README's Crypto section together.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for maca134/asku, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.
