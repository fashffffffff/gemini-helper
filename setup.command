#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS:$PATH"

if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) < 22 ? 1 : 0)'; then
  print 'Установи Node.js 22 или новее с https://nodejs.org/ и запусти установку снова.'
  read '?Enter для выхода'
  exit 1
fi

npm ci --no-fund --no-audit
npm run build

if [[ ! -x .agy-bin/agy ]]; then
  mkdir -p .agy-bin
  installer=$(mktemp)
  trap 'rm -f -- "$installer"' EXIT
  curl -fsSL https://antigravity.google/cli/install.sh -o "$installer"
  bash "$installer" --dir "$PWD/.agy-bin"
fi

if command -v codex >/dev/null; then
  node dist/cli.js install codex
  mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills/gemini-helper"
  cp skills/gemini-helper/SKILL.md "${CODEX_HOME:-$HOME/.codex}/skills/gemini-helper/"
fi
if command -v claude >/dev/null; then
  node dist/cli.js install claude-code
  mkdir -p "$HOME/.claude/skills/gemini-helper"
  cp skills/gemini-helper/SKILL.md "$HOME/.claude/skills/gemini-helper/"
fi
if [[ -d /Applications/Claude.app || -d "$HOME/Applications/Claude.app" || -f "$HOME/Library/Application Support/Claude/claude_desktop_config.json" ]]; then
  node dist/cli.js install claude-desktop
fi

print 'Войди в свой Google AI Pro. После входа перезапусти Codex или Claude.'
exec "$PWD/.agy-bin/agy" acp --login
