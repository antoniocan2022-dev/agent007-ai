#!/usr/bin/env bash
# Dev-server watchdog — keeps `bun run dev` alive on a local machine.
# Checks every 30s; restarts if the server stops responding.
#
# Deep-audit fix: this repo used to carry three near-identical, drifted copies of this script
# (watchdog.sh, watchdog-v2.sh, watchdog-permanent.sh), none referenced by any CI workflow or
# package.json script, all hardcoding /home/z/my-project as the project directory -- a path
# specific to one developer's machine. Consolidated to this one script; PROJECT_DIR now
# defaults to the repo root relative to this script's own location instead of a hardcoded path.
PROJECT_DIR="${PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$PROJECT_DIR" || exit 1

while true; do
  if ! curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date)] Server DOWN — restarting..."
    pkill -9 -f "next-server" 2>/dev/null; sleep 2
    nohup bun run dev > "$PROJECT_DIR/dev.log" 2>&1 &
    sleep 20
    if curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
      echo "[$(date)] Server UP ✅"
    else
      echo "[$(date)] Server FAILED — will retry next cycle"
    fi
  fi
  sleep 30
done
