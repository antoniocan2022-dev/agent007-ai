#!/bin/bash
# Agent007 Permanent Server Manager
# This is the MOST ROBUST way to keep the dev server alive.
# It uses a double-fork pattern (like real daemons) to fully detach from any shell.

cd /home/z/my-project

LOG="/home/z/my-project/dev.log"
MANAGER_LOG="/home/z/my-project/server-manager.log"

# Kill any existing manager + server
pkill -f "server-manager.sh" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 2

echo "[$(date)] === Server Manager starting ===" > "$MANAGER_LOG"

# Start the manager as a fully detached daemon using a subshell + disown
# The key trick: use () to create a subshell, then disown inside it
(
  cd /home/z/my-project
  MAX_RESTARTS=200
  RESTART_COUNT=0
  
  while true; do
    SERVER_PID=$(pgrep -f "next dev" | head -1)
    
    if [ -z "$SERVER_PID" ]; then
      RESTART_COUNT=$((RESTART_COUNT + 1))
      if [ $RESTART_COUNT -gt $MAX_RESTARTS ]; then
        echo "[$(date)] Max restarts reached. Exiting." >> "$MANAGER_LOG"
        exit 1
      fi
      
      echo "[$(date)] Server down. Starting (attempt $RESTART_COUNT)..." >> "$MANAGER_LOG"
      
      # Start dev server — the & backgrounds it within this subshell
      bun run dev >> "$LOG" 2>&1 &
      SERVER_PID=$!
      
      # Wait for it to be ready (up to 90 seconds)
      READY=0
      for i in $(seq 1 45); do
        sleep 2
        if curl -sS -m 5 -o /dev/null http://localhost:3000/ 2>/dev/null; then
          echo "[$(date)] Server UP (PID $SERVER_PID) after ${i}x2s" >> "$MANAGER_LOG"
          READY=1
          break
        fi
      done
      
      if [ $READY -eq 0 ]; then
        echo "[$(date)] Server failed to start in 90s. Will retry." >> "$MANAGER_LOG"
      fi
    else
      # Server is running — reset counter
      if [ $RESTART_COUNT -gt 0 ]; then
        echo "[$(date)] Server stable. Reset counter." >> "$MANAGER_LOG"
        RESTART_COUNT=0
      fi
    fi
    
    # Check every 15 seconds
    sleep 15
  done
) &

# Capture the manager PID and fully detach
MANAGER_PID=$!
disown $MANAGER_PID 2>/dev/null

echo "[$(date)] Manager PID: $MANAGER_PID" >> "$MANAGER_LOG"
echo "✅ Server Manager started (PID $MANAGER_PID)"
echo "The manager will keep the dev server alive permanently."
echo "Even if this shell exits, the manager + server will keep running."
echo ""
echo "Logs: tail -f /home/z/my-project/server-manager.log"
echo "Stop: pkill -f 'server-manager.sh'; pkill -f 'next dev'"
