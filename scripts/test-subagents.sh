#!/bin/bash
# Test each of the 10 subagents sequentially with proper rate-limit spacing
# Each test: send prompt → wait for completion → record result → wait 60s before next

LOG="/home/z/my-project/scripts/subagent-test-results.log"
> "$LOG"

test_subagent() {
  local name="$1"
  local prompt="$2"
  echo "===========================================" | tee -a "$LOG"
  echo "TEST: $name" | tee -a "$LOG"
  echo "PROMPT: $prompt" | tee -a "$LOG"
  echo "START: $(date)" | tee -a "$LOG"
  echo "===========================================" | tee -a "$LOG"
  
  # Click NEW CHAT
  agent-browser snapshot -i -c > /tmp/snap.txt 2>&1
  NEWCHAT=$(grep "NEW CHAT" /tmp/snap.txt | head -1 | grep -oE '@e[0-9]+')
  agent-browser click $NEWCHAT > /dev/null 2>&1
  sleep 2
  
  # Find textbox and send button
  agent-browser snapshot -i -c > /tmp/snap.txt 2>&1
  TB=$(grep "textbox" /tmp/snap.txt | head -1 | grep -oE '@e[0-9]+')
  
  agent-browser fill $TB "$prompt" > /dev/null 2>&1
  sleep 1
  
  agent-browser snapshot -i -c > /tmp/snap.txt 2>&1
  SEND=$(grep "Send message" /tmp/snap.txt | head -1 | grep -oE '@e[0-9]+')
  
  agent-browser click $SEND > /dev/null 2>&1
  sleep 4
  
  # Wait for completion (up to 180s)
  STATUS="unknown"
  for i in $(seq 1 36); do
    sleep 5
    STATUS=$(agent-browser eval "document.body.textContent.match(/(Reasoning|Executing tools|Streaming|Ready|Error)/)?.[0] || 'unknown'" 2>&1 | tr -d '"')
    if [ "$STATUS" = "Ready" ] || [ "$STATUS" = "Error" ]; then
      break
    fi
  done
  
  # Verify subagent was dispatched
  SUBAGENT_COUNT=$(agent-browser eval "document.body.textContent.split('$name').length - 1" 2>&1)
  ERROR_PRESENT=$(agent-browser eval "document.body.textContent.includes('429') || document.body.textContent.includes('Too many') || document.body.textContent.includes('Error')" 2>&1)
  MSG_COUNT=$(agent-browser eval "Array.from(document.querySelectorAll('main *')).filter(e => e.textContent?.length > 50).length" 2>&1)
  
  echo "STATUS: $STATUS" | tee -a "$LOG"
  echo "SUBAGENT_MENTIONS: $SUBAGENT_COUNT" | tee -a "$LOG"
  echo "ERROR_PRESENT: $ERROR_PRESENT" | tee -a "$LOG"
  echo "MSG_ELEMENTS: $MSG_COUNT" | tee -a "$LOG"
  echo "END: $(date)" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  
  # Wait 60s before next test to avoid rate limit
  if [ "$name" != "ECHO" ]; then
    echo "Waiting 60s for rate limit cooldown..." | tee -a "$LOG"
    sleep 60
  fi
}

# Test each subagent with a short, targeted prompt
test_subagent "HUNT" "Hunt, find 3 high-paying freelance categories. Be brief."
test_subagent "VERTEX" "Vertex, design a micro-SaaS blueprint for an AI resume optimizer. Be brief."
test_subagent "QUANTUM" "Quantum, what are 2 passive income options for \$5000? Be brief."
test_subagent "FORGE" "Forge, write a Python compound interest function and test it. Be brief."
test_subagent "QUILL" "Quill, write a 30-second TikTok script about AI for business. Be brief."
test_subagent "PRISM" "Prism, generate a simple logo for 'Nebula Studio'. Use 1024x1024."
test_subagent "PULSE" "Pulse, define 3 KPIs for a SaaS business. Be brief."
test_subagent "ECHO" "Echo, recommend 2 A/B tests for a blog getting 100, 250, 80 views. Be brief."

echo "ALL TESTS COMPLETE" | tee -a "$LOG"
