// Prints Sonar findings for the given folders/files as `path:line rule message`, skipping lines marked
// `// NOSONAR` (SonarQube ignores those too), then a count per rule. Run from the repository root:
//   node /tmp/sonar-check/check.mjs apps/web/src/app/dashboard
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ESLint } from 'eslint';

const targets = process.argv.slice(2);
if (!targets.length) {
  console.error('Usage: node /tmp/sonar-check/check.mjs <folder or file> [...]');
  process.exit(2);
}

const eslint = new ESLint({ overrideConfigFile: new URL('./eslint.config.mjs', import.meta.url).pathname, errorOnUnmatchedPattern: false });
const results = await eslint.lintFiles(targets);
const counts = new Map();
let total = 0;
for (const { filePath, messages } of results) {
  if (!messages.length) continue;
  const lines = readFileSync(filePath, 'utf8').split('\n');
  for (const m of messages) {
    if (m.line && lines[m.line - 1]?.includes('NOSONAR')) continue;
    const rule = m.ruleId ?? 'parse-error';
    console.log(`${relative(process.cwd(), filePath)}:${m.line ?? 0} ${rule} ${m.message.split('\n')[0].slice(0, 140)}`);
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
    total++;
  }
}
console.log(`\n${total} finding(s)`);
for (const [rule, n] of [...counts].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(5)}  ${rule}`);
