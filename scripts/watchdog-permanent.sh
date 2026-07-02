#!/usr/bin/env bash
# Permanent watchdog — keeps Agent007 alive 24/7
# Checks every 30s; restarts if down
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date)] Server DOWN — restarting..."
    pkill -9 -f "next-server" 2>/dev/null; sleep 2
    nohup bun run dev > /home/z/my-project/dev.log 2>&1 &
    sleep 20
    if curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
      echo "[$(date)] Server UP ✅"
    else
      echo "[$(date)] Server FAILED — will retry next cycle"
    fi
  fi
  sleep 30
done
