#!/usr/bin/env python3
"""
Agent007 VID Full Backup Generator (v2)
========================================
Generates a complete backup of the Agent007 project. This v2 includes
LIVE data fetched from https://agent007-ai.vercel.app so the backup
contains both source code AND the current production state (portfolio,
KPIs, subagents, pods).

Outputs (saved to /home/z/my-project/download/ AND /home/z/my-project/public/download/):
  agent007-backup-{timestamp}.json
  agent007-backup-{timestamp}.zip
  agent007-backup-LATEST.json   (copy of most recent)
  agent007-backup-LATEST.zip    (copy of most recent)
"""

import os
import json
import zipfile
import shutil
import subprocess
import hashlib
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path("/home/z/my-project")
DOWNLOAD_DIR = PROJECT_ROOT / "download"
PUBLIC_DOWNLOAD = PROJECT_ROOT / "public" / "download"
DOWNLOAD_DIR.mkdir(exist_ok=True)
PUBLIC_DOWNLOAD.mkdir(parents=True, exist_ok=True)

LIVE_BASE = "https://agent007-ai.vercel.app"

INCLUDE_DIRS = ["src", "prisma", "public", "docs", "scripts"]
INCLUDE_FILES = [
    "package.json", "package-lock.json", "bun.lock", "tsconfig.json",
    "next.config.ts", "tailwind.config.ts", "postcss.config.mjs",
    "components.json", "vercel.json", "Caddyfile", "README.md",
    "QUICKSTART.md", "eslint.config.mjs", "build.sh", "worklog.md",
    "AUDIT-FINAL-REPORT.md", "AUDIT-FINDINGS.md", "AUDIT-WHOLE-SYSTEM.md",
]

EXCLUDE_PATTERNS = [
    ".next/", "node_modules/", ".git/", ".vercel/", "__pycache__/",
    "*.pyc", "*.log", "dev.pid", ".DS_Store",
    "db/custom.db-journal", "db/custom.db-wal", "db/custom.db-shm",
    "/download/",  # don't recurse into our own output dir
]

def matches_exclude(path: str) -> bool:
    for pat in EXCLUDE_PATTERNS:
        if pat.endswith("/") and (f"/{pat}" in path or path.startswith(pat)):
            return True
        elif pat.startswith("*") and path.endswith(pat[1:]):
            return True
        elif pat.startswith("/") and pat[1:] in path:
            return True
        elif pat in path:
            return True
    return False

def collect_files():
    files = []
    for d in INCLUDE_DIRS:
        root = PROJECT_ROOT / d
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file():
                rel = path.relative_to(PROJECT_ROOT).as_posix()
                if not matches_exclude(rel):
                    files.append((path, rel))
    for f in INCLUDE_FILES:
        p = PROJECT_ROOT / f
        if p.exists() and p.is_file():
            files.append((p, f))
    return files

def get_git_info():
    info = {"available": False}
    try:
        commit = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=PROJECT_ROOT, text=True
        ).strip()
        branch = subprocess.check_output(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=PROJECT_ROOT, text=True
        ).strip()
        message = subprocess.check_output(
            ["git", "log", "-1", "--pretty=%s"], cwd=PROJECT_ROOT, text=True
        ).strip()
        info = {
            "available": True,
            "commit": commit,
            "branch": branch,
            "message": message,
        }
    except Exception as e:
        info["error"] = str(e)
    return info

def fetch_live(url):
    """Fetch JSON from live Vercel deployment."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "agent007-backup/1.0"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                return {"ok": True, "status": resp.status, "data": json.loads(body)}
            except json.JSONDecodeError:
                return {"ok": False, "status": resp.status, "error": "Not JSON", "preview": body[:200]}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}

def snapshot_live_vercel():
    """Snapshot all the live Vercel endpoints for inclusion in the backup."""
    endpoints = {
        "version":            "/api/version",
        "health":              "/api/health",
        "subagents":           "/api/subagents",
        "pods":                "/api/team/scout?action=pods",
        "vid_status":          "/api/team/vid?action=status",
        "portfolio":           "/api/system/portfolio",
        "portfolio_value":     "/api/system/portfolio?value=true",
        "portfolio_health":   "/api/system/portfolio-health",
        "vid_kpis":            "/api/system/vid-kpis",
    }
    snapshot = {}
    for name, path in endpoints.items():
        url = LIVE_BASE + path
        print(f"    Fetching {name:20s} {path}")
        snapshot[name] = fetch_live(url)
    return snapshot

def build_json_manifest(files, git_info, live_snapshot, timestamp):
    file_entries = []
    for abs_path, rel_path in files:
        try:
            stat = abs_path.stat()
            with open(abs_path, "rb") as f:
                content = f.read()
            sha = hashlib.sha256(content).hexdigest()
            file_entries.append({
                "path": rel_path,
                "size": stat.st_size,
                "sha256": sha,
                "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
            })
        except Exception as e:
            file_entries.append({"path": rel_path, "error": str(e)})

    manifest = {
        "backup_metadata": {
            "generated_at": timestamp,
            "tool": "agent007-vid-backup-generator v2.0",
            "project": "Agent007 AI",
            "live_url": LIVE_BASE,
            "git": git_info,
            "total_files": len(file_entries),
            "total_size_bytes": sum(f.get("size", 0) for f in file_entries if "size" in f),
        },
        "live_vercel_snapshot": live_snapshot,
        "files": file_entries,
    }
    return manifest

def write_json_backup(manifest, timestamp):
    json_path = DOWNLOAD_DIR / f"agent007-backup-{timestamp}.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, default=str)
    return json_path

def write_zip_backup(files, manifest, timestamp):
    zip_path = DOWNLOAD_DIR / f"agent007-backup-{timestamp}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        manifest_path = DOWNLOAD_DIR / f"agent007-backup-{timestamp}.json"
        zf.write(manifest_path, "BACKUP-MANIFEST.json")
        for abs_path, rel_path in files:
            try:
                zf.write(abs_path, f"src/{rel_path}")
            except Exception as e:
                print(f"  ⚠ Skipped {rel_path}: {e}")
        # Save the live snapshot as a separate JSON inside the zip
        snapshot_json = json.dumps(manifest.get("live_vercel_snapshot", {}), indent=2, default=str)
        zf.writestr("LIVE-VERCEL-SNAPSHOT.json", snapshot_json)
    return zip_path

def main():
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    print(f"═══════════════════════════════════════════════════════════════")
    print(f"  Agent007 VID Full Backup v2.0 — {timestamp}")
    print(f"═══════════════════════════════════════════════════════════════")
    print()

    print("Step 1: Collecting files...")
    files = collect_files()
    total_size = sum(f[0].stat().st_size for f in files)
    print(f"  ✓ {len(files)} files, {total_size / 1024:.1f} KB total")

    print("Step 2: Git info...")
    git_info = get_git_info()
    if git_info["available"]:
        print(f"  ✓ commit: {git_info['commit']}")
        print(f"  ✓ branch: {git_info['branch']}")
        print(f"  ✓ msg:    {git_info['message']}")

    print("Step 3: Snapshotting LIVE Vercel data...")
    live_snapshot = snapshot_live_vercel()
    ok_count = sum(1 for v in live_snapshot.values() if v.get("ok"))
    print(f"  ✓ {ok_count}/{len(live_snapshot)} endpoints snapshot OK")

    print("Step 4: Building JSON manifest...")
    manifest = build_json_manifest(files, git_info, live_snapshot, timestamp)
    json_path = write_json_backup(manifest, timestamp)
    print(f"  ✓ {json_path}")

    print("Step 5: Building ZIP archive...")
    zip_path = write_zip_backup(files, manifest, timestamp)
    print(f"  ✓ {zip_path}")

    print("Step 6: Creating LATEST copies...")
    latest_json = DOWNLOAD_DIR / "agent007-backup-LATEST.json"
    latest_zip = DOWNLOAD_DIR / "agent007-backup-LATEST.zip"
    shutil.copy2(json_path, latest_json)
    shutil.copy2(zip_path, latest_zip)
    print(f"  ✓ {latest_json}")
    print(f"  ✓ {latest_zip}")

    print("Step 7: Copying to /public/download/ for static Vercel serving...")
    for src in [json_path, zip_path, latest_json, latest_zip]:
        shutil.copy2(src, PUBLIC_DOWNLOAD / src.name)
    print(f"  ✓ All 4 files copied to public/download/")

    json_size = json_path.stat().st_size
    zip_size = zip_path.stat().st_size

    print()
    print(f"═══════════════════════════════════════════════════════════════")
    print(f"  BACKUP COMPLETE — DEPLOY TO ACTIVATE PUBLIC DOWNLOAD URLS")
    print(f"═══════════════════════════════════════════════════════════════")
    print(f"  Local files:")
    print(f"    {json_path} ({json_size:,} bytes)")
    print(f"    {zip_path}  ({zip_size:,} bytes)")
    print()
    print(f"  Public download URLs (LIVE on Vercel after `vercel --prod`):")
    print(f"    {LIVE_BASE}/download/agent007-backup-LATEST.json")
    print(f"    {LIVE_BASE}/download/agent007-backup-LATEST.zip")
    print()
    print(f"  Timestamped URLs:")
    print(f"    {LIVE_BASE}/download/agent007-backup-{timestamp}.json")
    print(f"    {LIVE_BASE}/download/agent007-backup-{timestamp}.zip")
    print()
    print(f"  Manifest summary:")
    print(f"    Files:           {manifest['backup_metadata']['total_files']}")
    print(f"    Source size:     {manifest['backup_metadata']['total_size_bytes']:,} bytes")
    print(f"    Live endpoints:  {ok_count}/{len(live_snapshot)} OK")
    print(f"    Git commit:      {git_info.get('commit', 'N/A')[:8]}")
    print(f"═══════════════════════════════════════════════════════════════")
    return json_path, zip_path

if __name__ == "__main__":
    main()
