// Dynamically import the compiled tools module via tsx fallback
// Use the project's tsconfig paths via a quick shim.
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
// Try bun first if available, else use tsx
try {
  const { execSync } = await import('node:child_process')
  // Use bun to run an inline script
  const code = `
    const { TOOL_REGISTRY } = require('./src/lib/tools.ts');
    const keys = Object.keys(TOOL_REGISTRY);
    console.log('TOTAL_TOOLS:', keys.length);
    // Look for duplicate handler refs (multiple keys pointing to same fn)
    const fnMap = new Map();
    for (const [k, v] of Object.entries(TOOL_REGISTRY)) {
      const fnName = v.fn.name || '<anon>';
      if (!fnMap.has(fnName)) fnMap.set(fnName, []);
      fnMap.get(fnName).push(k);
    }
    const dups = [...fnMap.entries()].filter(([_, ks]) => ks.length > 1);
    console.log('DUP_FUNCTIONS:', dups.length);
    for (const [fn, ks] of dups) console.log('  ', fn, '=>', ks.join(', '));
    // Verify each entry has fn/icon/label
    let missing = 0;
    for (const [k, v] of Object.entries(TOOL_REGISTRY)) {
      const issues = [];
      if (typeof v.fn !== 'function') issues.push('NO_FN');
      if (typeof v.icon !== 'string' || !v.icon) issues.push('NO_ICON');
      if (typeof v.label !== 'string' || !v.label) issues.push('NO_LABEL');
      if (issues.length) { console.log('  BAD_ENTRY:', k, issues); missing++; }
    }
    console.log('BAD_ENTRIES:', missing);
    console.log('TOOL_KEYS:', keys.sort().join('\\n'));
  `
  execSync(`bun -e '${code.replace(/'/g, "'\\''")}'`, { stdio: 'inherit' })
} catch (e) {
  console.error('bun failed:', e.message)
}
