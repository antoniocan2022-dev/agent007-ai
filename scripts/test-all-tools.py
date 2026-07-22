#!/usr/bin/env python3
"""
Agent007 — Comprehensive Tool Testing Suite
Tests functionality, coordination, and accuracy of all key tools.
"""
import json
import urllib.request
import urllib.parse
import time
import sys

BASE = "https://agent007-ai.vercel.app"
TOKEN = "agent007-owner-backup-2024-antonio-can-2022"

def fetch_json(url, method="GET", data=None, timeout=30):
    """Fetch JSON from URL with optional POST data."""
    try:
        req_data = None
        if data is not None:
            req_data = json.dumps(data).encode()
        req = urllib.request.Request(url, data=req_data, method=method)
        if req_data:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read()), None
    except Exception as e:
        return None, str(e)

def test_endpoint(name, path, method="GET", data=None, expected_keys=None, timeout=30):
    """Test an API endpoint and return result dict."""
    url = f"{BASE}{path}"
    start = time.time()
    result, err = fetch_json(url, method, data, timeout)
    elapsed = time.time() - start
    if err:
        return {"name": name, "ok": False, "error": err, "elapsed": round(elapsed, 2)}
    ok = result.get("ok", True) if isinstance(result, dict) else True
    if expected_keys and isinstance(result, dict):
        for k in expected_keys:
            if k not in result:
                ok = False
                break
    return {
        "name": name,
        "ok": ok,
        "elapsed": round(elapsed, 2),
        "preview": str(result)[:200] if result else "(empty)",
    }

def main():
    print("=" * 70)
    print("AGENT007 — COMPREHENSIVE TOOL TESTING SUITE")
    print(f"URL: {BASE}")
    print(f"Date: {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())}")
    print("=" * 70)
    print()

    results = []

    # === TEST GROUP 1: Core Infrastructure ===
    print(">>> TEST GROUP 1: CORE INFRASTRUCTURE")
    print("-" * 70)

    r = test_endpoint("health", "/api/health", expected_keys=["ok", "status"])
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} health ({r['elapsed']}s)")

    r = test_endpoint("manifest", "/api/system/manifest", expected_keys=["totalUpgrades", "integrity"])
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} manifest ({r['elapsed']}s)")

    r = test_endpoint("capabilities", "/api/system/capabilities", expected_keys=["tools", "agents"])
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} capabilities ({r['elapsed']}s)")

    r = test_endpoint("subagents", "/api/subagents")
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} subagents ({r['elapsed']}s)")

    r = test_endpoint("diagnose-llm", "/api/system/diagnose-llm", expected_keys=["overallStatus"])
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} diagnose-llm ({r['elapsed']}s)")

    r = test_endpoint("fix-agents", "/api/system/fix-agents")
    results.append(("INFRA", r))
    print(f"  {'✅' if r['ok'] else '❌'} fix-agents ({r['elapsed']}s)")

    # === TEST GROUP 2: MAX Autonomy V2 Tools ===
    print()
    print(">>> TEST GROUP 2: MAX AUTONOMY V2 TOOLS")
    print("-" * 70)

    # Test mission_mode status
    r = test_endpoint("mission_mode (status)", "/api/mission/tick?action=status")
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} mission_mode status ({r['elapsed']}s)")

    # Test mission_action_tick
    r = test_endpoint("mission_action_tick", "/api/reality-check",
                      method="POST", data={"tool": "mission_action_tick"})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} mission_action_tick ({r['elapsed']}s)")

    # Test recipe_engine
    r = test_endpoint("recipe_engine (list)", "/api/recipes")
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} recipe_engine list ({r['elapsed']}s)")

    # Test decisions
    r = test_endpoint("decisions (log)", "/api/decisions")
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} decisions log ({r['elapsed']}s)")

    # Test triggers
    r = test_endpoint("triggers (pending)", "/api/triggers")
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} triggers pending ({r['elapsed']}s)")

    # Test reality-check
    r = test_endpoint("reality-check (all)", "/api/reality-check?check=all")
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} reality-check all ({r['elapsed']}s)")

    # Test auto_decision (auto-approve <$50)
    r = test_endpoint("auto_decision (<$50)", "/api/decisions", method="POST",
                      data={"action": "evaluate", "type": "spend", "description": "Test $20 spend",
                            "amount": 20, "duration": 5})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} auto_decision <$50 ({r['elapsed']}s)")

    # Test auto_decision (require owner >$50)
    r = test_endpoint("auto_decision (>$50)", "/api/decisions", method="POST",
                      data={"action": "evaluate", "type": "spend", "description": "Test $200 spend",
                            "amount": 200, "duration": 15})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} auto_decision >$50 ({r['elapsed']}s)")

    # Test income_reality_check
    r = test_endpoint("income_reality_check", "/api/reality-check", method="POST",
                      data={"tool": "income_reality_check", "action": "stats"})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} income_reality_check ({r['elapsed']}s)")

    # Test tools_reality_check
    r = test_endpoint("tools_reality_check", "/api/reality-check", method="POST",
                      data={"tool": "tools_reality_check", "action": "classify"})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} tools_reality_check ({r['elapsed']}s)")

    # Test schedule_action_mode
    r = test_endpoint("schedule_action_mode", "/api/reality-check", method="POST",
                      data={"tool": "schedule_action_mode", "action": "view"})
    results.append(("AUTONOMY", r))
    print(f"  {'✅' if r['ok'] else '❌'} schedule_action_mode ({r['elapsed']}s)")

    # === TEST GROUP 3: Mission Tick (real execution) ===
    print()
    print(">>> TEST GROUP 3: MISSION EXECUTION")
    print("-" * 70)

    r = test_endpoint("mission_tick (execute)", "/api/mission/tick", method="POST",
                      data={"action": "tick"})
    results.append(("MISSION", r))
    print(f"  {'✅' if r['ok'] else '❌'} mission_tick execute ({r['elapsed']}s)")

    r = test_endpoint("mission_report", "/api/mission/tick", method="POST",
                      data={"action": "report"})
    results.append(("MISSION", r))
    print(f"  {'✅' if r['ok'] else '❌'} mission_report ({r['elapsed']}s)")

    # === TEST GROUP 4: External Trigger Queue ===
    print()
    print(">>> TEST GROUP 4: EXTERNAL TRIGGER")
    print("-" * 70)

    r = test_endpoint("trigger_queue", "/api/triggers", method="POST",
                      data={"action": "queue", "source": "test", "from": "audit@test.com",
                            "command": "Test trigger for audit"})
    results.append(("TRIGGER", r))
    print(f"  {'✅' if r['ok'] else '❌'} trigger_queue ({r['elapsed']}s)")

    # === TEST GROUP 5: Schedules + Monitors ===
    print()
    print(">>> TEST GROUP 5: SCHEDULES + MONITORS")
    print("-" * 70)

    r = test_endpoint("schedules_tick", "/api/schedules/tick")
    results.append(("SCHEDULE", r))
    print(f"  {'✅' if r['ok'] else '❌'} schedules_tick ({r['elapsed']}s)")

    r = test_endpoint("monitor_qa", "/api/monitor/qa")
    results.append(("MONITOR", r))
    print(f"  {'✅' if r['ok'] else '❌'} monitor_qa ({r['elapsed']}s)")

    r = test_endpoint("monitor_external", "/api/monitor/external")
    results.append(("MONITOR", r))
    print(f"  {'✅' if r['ok'] else '❌'} monitor_external ({r['elapsed']}s)")

    # === TEST GROUP 6: Owner Backup (token-gated) ===
    print()
    print(">>> TEST GROUP 6: OWNER BACKUP (SECURITY)")
    print("-" * 70)

    r = test_endpoint("backup_no_token (should 403)", "/api/owner-backup")
    # 403 is the EXPECTED behavior here, so ok=True if error contains 403
    r["ok"] = "403" in str(r.get("error", "")) or "Forbidden" in str(r.get("error", ""))
    results.append(("SECURITY", r))
    print(f"  {'✅' if r['ok'] else '❌'} backup_no_token (403 expected) ({r['elapsed']}s)")

    r = test_endpoint("backup_wrong_token (should 403)", "/api/owner-backup?token=wrong")
    r["ok"] = "403" in str(r.get("error", "")) or "Forbidden" in str(r.get("error", ""))
    results.append(("SECURITY", r))
    print(f"  {'✅' if r['ok'] else '❌'} backup_wrong_token (403 expected) ({r['elapsed']}s)")

    r = test_endpoint("backup_correct_token", f"/api/owner-backup?token={TOKEN}&format=json", timeout=60)
    results.append(("SECURITY", r))
    print(f"  {'✅' if r['ok'] else '❌'} backup_correct_token ({r['elapsed']}s)")

    # === TEST GROUP 7: UI Pages ===
    print()
    print(">>> TEST GROUP 7: UI PAGES")
    print("-" * 70)

    for page in ["/", "/login", "/reality-check"]:
        r = test_endpoint(f"page{page}", page, expected_keys=None)
        # Pages return HTML, not JSON — check HTTP 200 via error absence
        r["ok"] = r.get("error") is None or "HTTP" not in str(r.get("error", ""))
        results.append(("UI", r))
        print(f"  {'✅' if r['ok'] else '❌'} page {page} ({r['elapsed']}s)")

    # === SUMMARY ===
    print()
    print("=" * 70)
    print("TEST SUMMARY")
    print("=" * 70)
    print()

    by_group = {}
    for group, r in results:
        if group not in by_group:
            by_group[group] = {"pass": 0, "fail": 0, "total": 0}
        by_group[group]["total"] += 1
        if r["ok"]:
            by_group[group]["pass"] += 1
        else:
            by_group[group]["fail"] += 1

    total_pass = sum(g["pass"] for g in by_group.values())
    total_fail = sum(g["fail"] for g in by_group.values())
    total = total_pass + total_fail

    for group, counts in by_group.items():
        pct = (counts["pass"] / counts["total"]) * 100 if counts["total"] > 0 else 0
        print(f"  {group:<12}: {counts['pass']}/{counts['total']} passed ({pct:.0f}%) — {counts['fail']} failed")

    print()
    print(f"  TOTAL: {total_pass}/{total} passed ({(total_pass/total)*100:.1f}%) — {total_fail} failed")
    print()

    if total_fail > 0:
        print("FAILED TESTS:")
        for group, r in results:
            if not r["ok"]:
                print(f"  ❌ [{group}] {r['name']}: {r.get('error', r.get('preview', ''))[:100]}")
        print()

    # Save full results
    with open("/home/z/my-project/download/tool-test-results.json", "w") as f:
        json.dump({
            "timestamp": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
            "url": BASE,
            "summary": {
                "total": total,
                "passed": total_pass,
                "failed": total_fail,
                "pass_rate": f"{(total_pass/total)*100:.1f}%",
            },
            "by_group": by_group,
            "results": [{"group": g, **r} for g, r in results],
        }, f, indent=2)
    print("Full results saved to: /home/z/my-project/download/tool-test-results.json")

    return total_fail

if __name__ == "__main__":
    sys.exit(main())
