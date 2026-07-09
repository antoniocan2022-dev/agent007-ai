#!/bin/bash
# Called by cron every minute. Starts the dev server if it's not running.
cd /home/z/my-project

if ! pgrep -f "next dev" > /dev/null 2>&1; then
  echo "[$(date)] Server not running. Starting..." >> /home/z/my-project/cron-server.log
  nohup setsid bun run dev >> /home/z/my-project/dev.log 2>&1 < /dev/null &
  echo "[$(date)] Started with PID $!" >> /home/z/my-project/cron-server.log
fi
