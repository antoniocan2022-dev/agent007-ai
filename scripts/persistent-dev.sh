#!/bin/bash
# Persistent dev server launcher — restarts on crash (resilient version)
cd /home/z/my-project
LOG=/home/z/my-project/dev.log

while true; do
  echo "[$(date)] Starting dev server..." >> $LOG
  bun run dev >> $LOG 2>&1
  EXIT_CODE=$?
  echo "[$(date)] Dev server exited with code $EXIT_CODE, restarting in 5s..." >> $LOG
  sleep 5
done
