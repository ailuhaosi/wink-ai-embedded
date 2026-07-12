import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workbenchSrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../EmbeddedWorkbench.vue'),
  'utf8',
);
const repoSrc = join(dirname(fileURLToPath(import.meta.url)), '../..');
const simulationClientSrc = readFileSync(
  join(repoSrc, 'services/simulation-client.ts'),
  'utf8',
);
const buttonWorldWidgetSrc = readFileSync(
  join(repoSrc, 'peripherals/button/WorldWidget.vue'),
  'utf8',
);
const ultrasonicWorldWidgetSrc = readFileSync(
  join(repoSrc, 'peripherals/ultrasonic/WorldWidget.vue'),
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

  it('routes ideal inputs through peripheral inject plugins', () => {
    const hostSources = `${workbenchSrc}\n${simulationClientSrc}`;
    expect(hostSources).not.toMatch(/type === 'ultrasonic'|type !== 'button'|type === 'button'/);
    expect(workbenchSrc).toContain('syncIdealInputs(activeComponents.value)');
    expect(workbenchSrc).toContain("runInject(comp, { event: 'press' })");
    expect(workbenchSrc).toContain("runInject(comp, { event: 'release' })");
    expect(simulationClientSrc).toContain('runInjectIdle(components');
  });

  it('keeps world widgets off direct simulation pin APIs', () => {
    expect(buttonWorldWidgetSrc).not.toContain('@/services/simulation-pin-api');
    expect(ultrasonicWorldWidgetSrc).not.toContain('@/services/simulation-pin-api');
    expect(buttonWorldWidgetSrc).toContain('@/services/ideal-inject');
    expect(ultrasonicWorldWidgetSrc).toContain('@/services/ideal-inject');
  });
});
