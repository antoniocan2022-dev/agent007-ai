#!/usr/bin/env bash
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date)] DOWN — restarting..."
    pkill -9 -f "next-server" 2>/dev/null; sleep 2
    setsid bun run dev > /home/z/my-project/dev.log 2>&1 < /dev/null &
    sleep 25
    echo "[$(date)] Restarted"
  fi
  sleep 30
done
