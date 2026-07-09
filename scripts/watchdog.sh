#!/bin/bash
# Agent007 Dev Server Watchdog
# Keeps the Next.js dev server running permanently.
# If the server dies, this script restarts it within 5 seconds.
# Runs in its own session (setsid) so it survives shell exits.

cd /home/z/my-project

LOG_FILE="/home/z/my-project/dev.log"
PID_FILE="/home/z/my-project/dev.pid"
MAX_RESTARTS=50
RESTART_COUNT=0
RESTART_DELAY=5

echo "[$(date)] Agent007 watchdog starting..." >> "$LOG_FILE"

while true; do
  # Check if server is already running
  SERVER_PID=$(pgrep -f "next dev" | head -1)
  
  if [ -z "$SERVER_PID" ]; then
    RESTART_COUNT=$((RESTART_COUNT + 1))
    if [ $RESTART_COUNT -gt $MAX_RESTARTS ]; then
      echo "[$(date)] ERROR: Max restarts ($MAX_RESTARTS) reached. Stopping watchdog." >> "$LOG_FILE"
      exit 1
    fi
    
    echo "[$(date)] Server not running. Starting (attempt $RESTART_COUNT/$MAX_RESTARTS)..." >> "$LOG_FILE"
    
    # Start the dev server in a new session, detached from this script's process group
    # Use exec to replace the shell, so the process is fully detached
    setsid bash -c 'exec bun run dev' >> "$LOG_FILE" 2>&1 < /dev/null &
    SERVER_PID=$!
    echo "$SERVER_PID" > "$PID_FILE"
    
    # Wait for server to be ready (up to 60 seconds)
    WAIT_COUNT=0
    while [ $WAIT_COUNT -lt 60 ]; do
      sleep 2
      if curl -sS -m 5 -o /dev/null http://localhost:3000/ 2>/dev/null; then
        echo "[$(date)] Server is UP (PID: $SERVER_PID, waited ${WAIT_COUNT}x2s)" >> "$LOG_FILE"
        break
      fi
      WAIT_COUNT=$((WAIT_COUNT + 1))
    done
    
    if [ $WAIT_COUNT -ge 60 ]; then
      echo "[$(date)] WARNING: Server did not become ready in 120s" >> "$LOG_FILE"
    fi
  else
    # Server is running — reset restart count
    if [ $RESTART_COUNT -gt 0 ]; then
      echo "[$(date)] Server stable. Resetting restart count." >> "$LOG_FILE"
      RESTART_COUNT=0
    fi
  fi
  
  # Check every 10 seconds
  sleep 10
done
