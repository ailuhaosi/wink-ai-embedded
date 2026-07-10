import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workbenchSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../EmbeddedWorkbench.vue'),
  'utf8',
);

describe('EmbeddedWorkbench peripheral wiring (P0.3)', () => {
  it('uses WorldPeripheralsPane and has no Virtual* named branches', () => {
    expect(workbenchSrc).toContain('WorldPeripheralsPane');
    expect(workbenchSrc).not.toContain('VirtualLED');
    expect(workbenchSrc).not.toContain('VirtualButton');
    expect(workbenchSrc).not.toContain('VirtualOLED');
    expect(workbenchSrc).not.toContain('VirtualUltrasonic');
  });
});
