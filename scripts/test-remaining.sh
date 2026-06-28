#!/bin/bash
# Test remaining subagents sequentially with 90s spacing
LOG="/home/z/my-project/scripts/remaining-tests.log"
> "$LOG"

test_one() {
  local name="$1"
  local prompt="$2"
  echo "=== TEST: $name ===" | tee -a "$LOG"
  echo "TIME: $(date)" | tee -a "$LOG"
  
  # New chat
  NEWCHAT=$(agent-browser snapshot -i -c 2>/dev/null | grep "NEW CHAT" | head -1 | grep -oE '@e[0-9]+')
  agent-browser click $NEWCHAT > /dev/null 2>&1
  sleep 2
  
  # Fill + send
  TB=$(agent-browser snapshot -i 2>/dev/null | grep "textbox" | head -1 | grep -oE '@e[0-9]+')
  agent-browser fill $TB "$prompt" > /dev/null 2>&1
  sleep 1
  SEND=$(agent-browser snapshot -i 2>/dev/null | grep "Send message" | head -1 | grep -oE '@e[0-9]+')
  agent-browser click $SEND > /dev/null 2>&1
  sleep 5
  
  # Wait for completion (max 3 min)
  for i in $(seq 1 36); do
    sleep 5
    STATUS=$(agent-browser eval "document.body.textContent.match(/(Reasoning|Executing tools|Streaming|Ready|Error)/)?.[0] || 'unknown'" 2>&1 | tr -d '"')
    if [ "$STATUS" = "Ready" ] || [ "$STATUS" = "Error" ]; then
      break
    fi
  done
  
  # Check subagent dispatch
  DISPATCHED=$(agent-browser eval "document.body.textContent.match(/${name}[^]{0,200}dispatched/) ? 'YES' : 'NO'" 2>&1 | tr -d '"')
  ERROR=$(agent-browser eval "document.body.textContent.includes('429') || document.body.textContent.includes('Error: LLM') ? 'YES' : 'NO'" 2>&1 | tr -d '"')
  ANSWER=$(agent-browser eval "document.body.textContent.match(/SUB-AGENT ANSWER[\\s\\S]{0,200}/)?.[0]?.slice(0,150) || 'NO_ANSWER'" 2>&1 | tr -d '"' | head -c 200)
  
  echo "STATUS: $STATUS" | tee -a "$LOG"
  echo "DISPATCHED: $DISPATCHED" | tee -a "$LOG"
  echo "ERROR: $ERROR" | tee -a "$LOG"
  echo "ANSWER_PREVIEW: $ANSWER" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  
  # Wait 90s before next test
  echo "Waiting 90s..." | tee -a "$LOG"
  sleep 90
}

test_one "QUANTUM" "Quantum, what are 2 passive income options for \$5000? Be brief."
test_one "FORGE" "Forge, write Python code for compound interest. Be brief."
test_one "QUILL" "Quill, write a 30-sec TikTok script about AI for business. Be brief."
test_one "PRISM" "Prism, generate a simple logo for 'Nebula Studio'."
test_one "PULSE" "Pulse, define 3 KPIs for a SaaS business. Be brief."
test_one "ECHO" "Echo, recommend 2 A/B tests for a blog getting 100, 250, 80 views. Be brief."

echo "ALL DONE" | tee -a "$LOG"
