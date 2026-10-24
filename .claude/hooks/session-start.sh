#!/bin/bash
# Cloud sessions start without node_modules or ui/gen/: install and build so check, typecheck and test work.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
bun install
bun run build
