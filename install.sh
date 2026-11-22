#!/usr/bin/env bash
# Packages each extension folder and installs it into VS Code. One argument installs that extension alone.
# Each one builds and installs on its own, so a broken one never blocks the others.
set -uo pipefail
cd "$(dirname "$0")"

names=("$@")
[ ${#names[@]} -eq 0 ] && names=($(ls -d */ | tr -d /))

# A terminal outlives the VS Code window that opened it, and `code` then talks to a dead socket.
# Fall back to the newest socket that still answers.
if ! timeout 10 code --list-extensions >/dev/null 2>&1; then
  for sock in $(ls -t /run/user/"$(id -u)"/vscode-ipc-*.sock 2>/dev/null); do
    if VSCODE_IPC_HOOK_CLI="$sock" timeout 10 code --list-extensions >/dev/null 2>&1; then
      export VSCODE_IPC_HOOK_CLI="$sock"; break
    fi
  done
fi

mkdir -p .build
failed=0
for name in "${names[@]}"; do
  [ -f "$name/package.json" ] || continue
  echo "== $name"
  if (cd "$name" && npx --yes @vscode/vsce package --allow-missing-repository --skip-license -o "../.build/$name.vsix") \
     && code --install-extension ".build/$name.vsix" --force; then
    echo "installed $name"
  else
    echo "FAILED $name" >&2; failed=1
  fi
done
exit $failed
