#!/bin/bash
# Send a message to an existing Codex thread via the native codex queue
# command, bypassing the desktop composer's client-side usage gate.
#
# Uses only the app's own app-server daemon and thread store. No proxy, no
# certificate, no app modification. Without --thread, the newest rollout
# under ~/.codex/sessions is used.
#
# Usage:
#   ./codex-queue.sh "continue with the next step"
#   ./codex-queue.sh --thread 019f644b-a10a-73c2-8c3f-f3c7713a2928 "status?"
set -euo pipefail

THREAD=""
MESSAGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --thread)
      THREAD="${2:?--thread requires a value}"
      shift 2
      ;;
    --thread=*)
      THREAD="${1#--thread=}"
      shift
      ;;
    --message)
      MESSAGE="${2:?--message requires a value}"
      shift 2
      ;;
    --message=*)
      MESSAGE="${1#--message=}"
      shift
      ;;
    -*)
      echo "unknown option: $1" >&2
      exit 2
      ;;
    *)
      if [ -z "$MESSAGE" ]; then
        MESSAGE="$1"
      else
        echo "unexpected extra argument: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [ -z "$MESSAGE" ]; then
  echo "usage: codex-queue.sh [--thread <id>] <message>" >&2
  exit 2
fi

resolve_codex() {
  if command -v codex >/dev/null 2>&1; then
    command -v codex
    return
  fi
  local candidate
  for candidate in \
    "$HOME/.codex/bin/codex" \
    "$HOME/.codex/bin"/*/codex \
    "$HOME/Applications/Codex.app/Contents/Resources/codex" \
    "/Applications/Codex.app/Contents/Resources/codex"; do
    if [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  echo "codex not found on PATH or in the usual install locations" >&2
  return 1
}

resolve_latest_thread() {
  local sessions="$HOME/.codex/sessions"
  local latest
  latest=$(find "$sessions" -type f -name 'rollout-*.jsonl' -exec ls -t {} + 2>/dev/null | head -n 1)
  if [ -z "$latest" ]; then
    echo "no rollout sessions found under $sessions" >&2
    return 1
  fi
  basename "$latest" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -n 1
}

if [ -z "$THREAD" ]; then
  THREAD=$(resolve_latest_thread)
fi
if [ -z "$THREAD" ]; then
  echo "could not resolve a thread id" >&2
  exit 1
fi

CODEX_EXE=$(resolve_codex)
exec "$CODEX_EXE" queue --thread "$THREAD" --message "$MESSAGE"
