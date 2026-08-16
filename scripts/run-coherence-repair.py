from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
canonical = ROOT / 'src/lib/canonical-organizational-state.ts'
policy = ROOT / 'src/lib/provider-intelligence-policy.ts'

def already_repaired():
    return canonical.exists() and policy.exists() and "CORE_PROVIDER_PRIORITY" in policy.read_text(encoding='utf-8')

if already_repaired():
    print('coherence repair already applied; skipping non-idempotent transformation pass')
else:
    subprocess.run([sys.executable, str(ROOT / 'scripts/apply-coherence-fixes.py')], check=True)
