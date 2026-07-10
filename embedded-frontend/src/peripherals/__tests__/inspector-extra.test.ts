import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { registry } from '@/peripherals';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

describe('P3.3 inspectorExtra', () => {
  it('ultrasonic definition has inspectorExtra; led/button/oled do not', () => {
    expect(registry.get('ultrasonic')?.inspectorExtra).toBeTruthy();
    expect(registry.get('led')?.inspectorExtra).toBeUndefined();
    expect(registry.get('button')?.inspectorExtra).toBeUndefined();
    expect(registry.get('oled')?.inspectorExtra).toBeUndefined();
  });

  it('WorkbenchPropertyInspector has no ultrasonic type special-case', () => {
    const src = readSrc('components/workbench/WorkbenchPropertyInspector.vue');
    expect(src).not.toMatch(/type\s*===\s*['"]ultrasonic['"]/);
    expect(src).not.toMatch(/===\s*['"]ultrasonic['"]/);
  });
});
