// Affected-only pre-commit gate (CLAUDE.md invariant #9: tsc + affected tests).
// Runs typecheck + lint + test ONLY for the workspace packages whose files are
// staged, instead of all three every commit. packages/shared is upstream of api
// and web, so a shared change fans out to both. Root config changes run everything.
import { execSync } from 'node:child_process';

const PACKAGES = {
  'packages/shared': '@adyton/shared',
  'apps/api': '@adyton/api',
  'apps/web': '@adyton/web',
};
// Root files that can affect every package — change one → check all.
const ROOT_GLOBS = [
  'eslint.config.js',
  'tsconfig.base.json',
  'tsconfig.json',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
];

const staged = execSync('git diff --cached --name-only --diff-filter=ACMR', { encoding: 'utf8' })
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean);

if (staged.length === 0) process.exit(0);

const affected = new Set();
let runAll = false;

for (const file of staged) {
  if (ROOT_GLOBS.includes(file)) {
    runAll = true;
    break;
  }
  for (const [dir, name] of Object.entries(PACKAGES)) {
    if (file.startsWith(`${dir}/`)) affected.add(name);
  }
}

if (runAll) {
  for (const name of Object.values(PACKAGES)) affected.add(name);
}
// shared is consumed by api + web — fan out.
if (affected.has('@adyton/shared')) {
  affected.add('@adyton/api');
  affected.add('@adyton/web');
}

if (affected.size === 0) {
  console.log('pre-commit: no workspace package affected (docs/config only) — skipping checks.');
  process.exit(0);
}

const filters = [...affected].map((n) => `--filter ${n}`).join(' ');
console.log(`pre-commit: checking ${[...affected].join(', ')}`);

for (const task of ['typecheck', 'lint', 'test']) {
  console.log(`\n▶ pnpm ${filters} ${task}`);
  try {
    execSync(`pnpm ${filters} --if-present ${task}`, { stdio: 'inherit' });
  } catch {
    console.error(`\n✖ pre-commit failed at: ${task}`);
    process.exit(1);
  }
}
