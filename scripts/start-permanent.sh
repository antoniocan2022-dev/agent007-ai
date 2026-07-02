#!/usr/bin/env bash
cd /home/z/my-project
pkill -9 -f "next-server" 2>/dev/null; sleep 2
rm -rf .next 2>/dev/null
bun run dev > dev.log 2>&1 &
DEV_PID=$!
echo "[$(date)] Dev server started PID:$DEV_PID"
sleep 20
while true; do
  if ! curl -s -o /dev/null --connect-timeout 5 http://localhost:3000/ 2>/dev/null; then
    echo "[$(date)] Server DOWN — restarting..."
    pkill -9 -f "next-server" 2>/dev/null; sleep 2
    bun run dev > dev.log 2>&1 &
    DEV_PID=$!
    sleep 20
    echo "[$(date)] Server restarted PID:$DEV_PID"
  fi
  sleep 30
done
