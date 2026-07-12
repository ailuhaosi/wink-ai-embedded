import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PERIPH_ROOT = path.resolve(__dirname, '..');

/** Packages under peripherals/<type>/ that must not import simulation-runtime. */
function listVueAndTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listVueAndTsFiles(full));
    else if (/\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const RUNTIME_IMPORT_RE =
  /from\s+['"]@\/services\/(simulation-runtime|simulation-client)['"]|from\s+['"]\.\.\/.*(simulation-runtime|simulation-client)['"]/;
const ESLINT_DISABLE_RE = /\/\*\s*eslint-disable(?:[^*]|\*(?!\/))*\*\//; // 扫描禁用注释，防绕过

describe('architecture: peripheral packages must not import simulation-runtime or simulation-client', () => {
  it('has zero offenders (M1→M2 complete: oled cleared in Task 2.4, servo in Task 2.5)', () => {
    const files = listVueAndTsFiles(PERIPH_ROOT).filter((f) => {
      const rel = path.relative(PERIPH_ROOT, f).replace(/\\/g, '/');
      // allow tests, registry, types, observe-builder at package root helpers
      return rel.includes('/');
    });

    const offenders = files.filter((f) => {
      const code = fs.readFileSync(f, 'utf8');
      return RUNTIME_IMPORT_RE.test(code) || ESLINT_DISABLE_RE.test(code);
    });
    const rel = offenders.map((f) => path.relative(PERIPH_ROOT, f).replace(/\\/g, '/')).sort();

    expect(rel).toEqual([]);
  });
});
