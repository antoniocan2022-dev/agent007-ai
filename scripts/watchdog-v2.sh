#!/bin/bash
# Agent007 Watchdog — uses setsid -f to fully detach
# Restarts the dev server if it dies. Checks every 15 seconds.

cd /home/z/my-project

LOG="/home/z/my-project/dev.log"
WLOG="/home/z/my-project/watchdog.log"

echo "[$(date)] Watchdog started" > "$WLOG"

while true; do
  if ! pgrep -f "next dev" > /dev/null 2>&1; then
    echo "[$(date)] Server down. Restarting..." >> "$WLOG"
    setsid -f bun run dev >> "$LOG" 2>&1 &
    # Wait for ready
    for i in $(seq 1 30); do
      sleep 2
      if curl -sS -m 5 -o /dev/null http://localhost:3000/ 2>/dev/null; then
        echo "[$(date)] Server UP after ${i}x2s" >> "$WLOG"
        break
      fi
    done
  fi
  sleep 15
done
