## Project

asku: an agent sends the user an end-to-end encrypted question form; the relay only ever stores ciphertext.
Follow `docs/coding-standards.md`: it covers layout, the key/plaintext boundary, names, comments and tooling.

- `api/` relay (Bun + SQLite), `shared/crypto.ts` wire crypto, `ui/` browser app (`session/` is the trusted part),
  `skill/` the agent clients and SKILL.md, `test/` bun tests and `vectors.json`, `examples/` sample question and answer
  JSON, `schema.json` the wire schema. After changing `skill/SKILL.md` or the clients, the `skill-local` skill is a
  hands-on local test.
- Before committing: `bun run check`, `bun run typecheck`, `bun test`.
- Changes to `shared/`, `ui/session/`, `ui/form/`, `ui/dom.tsx`, `skill/`, `api/`, `build.ts`, `Dockerfile`, `compose.yaml` or
  `.github/workflows/`: run the `security-reviewer` agent before the PR.

## Agent skills

### Issue tracker

Issues live in GitHub Issues for maca134/asku, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` and `docs/adr/` don't exist yet; they're created when needed. See `docs/agents/domain.md`.
