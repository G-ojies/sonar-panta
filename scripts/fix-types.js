// Prune nested @types/react(-dom)@19 copies that wallet-adapter's transitive deps install;
// under React 18 they break JSX typing. Runs on postinstall.
const fs = require('fs'); const path = require('path');
const root = path.join(process.cwd(), 'node_modules');
function walk(dir, depth) {
  if (depth > 8) return;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    const p = path.join(dir, e.name);
    if (e.name === '@types' && dir !== root) {
      for (const t of ['react', 'react-dom']) { const tp = path.join(p, t); if (fs.existsSync(tp)) { fs.rmSync(tp, { recursive: true, force: true }); console.log('pruned', path.relative(root, tp)); } }
      continue;
    }
    if (e.name === 'node_modules' || e.name.startsWith('@') || fs.existsSync(path.join(p, 'node_modules'))) walk(p, depth + 1);
  }
}
walk(root, 0);
