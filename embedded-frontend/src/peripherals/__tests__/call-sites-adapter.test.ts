import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Production call sites that must use registry / @/peripherals helpers. */
const CALL_SITES = [
  'components/workbench/WorkbenchPropertyInspector.vue',
  'composables/canvas/useWireRendering.ts',
  'composables/canvas/useCanvasLayout.ts',
  'services/static-check.service.ts',
  'views/EmbeddedWorkbench.vue',
  'services/manifest-to-canvas.service.ts',
] as const;

function readSrc(rel: string): string {
  return readFileSync(join(srcRoot, rel), 'utf8');
}

describe('call sites use registry / @/peripherals (no legacy-adapter)', () => {
  it.each(CALL_SITES)('%s does not import peripheralConfigs from peripheral-pins', (rel) => {
    const src = readSrc(rel);
    expect(src).not.toMatch(
      /import\s*\{[^}]*\bperipheralConfigs\b[^}]*\}\s*from\s*['"]@?\/?\.?\.?\/?types\/peripheral-pins['"]/,
    );
    expect(src).not.toMatch(
      /import\s*\{\s*peripheralConfigs\s*\}\s*from\s*['"][^'"]*peripheral-pins['"]/,
    );
  });

  it('no production source imports legacy-adapter or peripheralConfigsAdapter', () => {
    for (const rel of CALL_SITES) {
      const src = readSrc(rel);
      expect(src).not.toMatch(/legacy-adapter/);
      expect(src).not.toMatch(/peripheralConfigsAdapter/);
    }
  });

  it('WorkbenchPropertyInspector imports registry from @/peripherals', () => {
    const src = readSrc('components/workbench/WorkbenchPropertyInspector.vue');
    expect(src).toMatch(/registry/);
    expect(src).toMatch(/from\s+['"]@\/peripherals['"]/);
  });

  it('useWireRendering and useCanvasLayout use registry', () => {
    expect(readSrc('composables/canvas/useWireRendering.ts')).toMatch(/registry/);
    expect(readSrc('composables/canvas/useCanvasLayout.ts')).toMatch(/registry/);
  });

  it('static-check.service uses registry from @/peripherals', () => {
    const src = readSrc('services/static-check.service.ts');
    expect(src).toMatch(/registry/);
    expect(src).toMatch(/from\s+['"]@\/peripherals['"]/);
  });

  it('EmbeddedWorkbench and manifest-to-canvas get defaults from @/peripherals', () => {
    for (const rel of [
      'views/EmbeddedWorkbench.vue',
      'services/manifest-to-canvas.service.ts',
    ] as const) {
      const src = readSrc(rel);
      expect(src).toMatch(/getDefaultPinConnections/);
      expect(src).toMatch(/getDefaultProps/);
      expect(src).toMatch(/from\s+['"]@\/peripherals['"]/);
    }
  });
});
