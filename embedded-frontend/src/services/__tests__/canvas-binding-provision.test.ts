import { describe, expect, it } from 'vitest';
import { provisionImplicitCanvasBindings } from '@/services/canvas-binding-provision';
import { createEmptyManifestV2 } from '@/types/manifest-v2';
import { AVOIDANCE_CAR_W2_MINIMAL } from '@/services/templates/avoidance-car-w2-minimal';
import type { CircuitComponentInstance } from '@/types/circuit-component';

const sonarComponent: CircuitComponentInstance = {
  id: 'sonar1',
  type: 'ultrasonic',
  name: 'HC-SR04 Sensor',
  pinConnections: { VCC: 'VCC', TRIG: 12, ECHO: 13, GND: 'GND' },
  props: { distance: 25 },
  rotation: 0,
};

describe('canvas-binding-provision', () => {
  it('auto-provisions raycast binding for default demo sonar1', () => {
    const base = createEmptyManifestV2();
    const result = provisionImplicitCanvasBindings(base, [sonarComponent]);
    expect(result.bindings?.sensors.some(s => s.deviceComponentId === 'sonar1')).toBe(true);
    expect(result.mechanical?.parts.some(p => p.partId === 'mount_sonar1')).toBe(true);
  });

  it('does not auto-bind for M1 avoidance car template', () => {
    const result = provisionImplicitCanvasBindings(AVOIDANCE_CAR_W2_MINIMAL, [
      {
        ...sonarComponent,
        id: 'front_radar',
      },
    ]);
    expect(result.bindings?.sensors).toEqual([]);
    expect(result.mechanical?.parts).toEqual([]);
  });

  it('skips when binding already exists', () => {
    const base = createEmptyManifestV2();
    const withBinding = provisionImplicitCanvasBindings(base, [sonarComponent]);
    const again = provisionImplicitCanvasBindings(withBinding, [sonarComponent]);
    expect(again.bindings?.sensors).toHaveLength(1);
  });
});

describe('createAvoidanceCarWorkbenchManifest', () => {
  it('includes mount and binding for simulate-ready template', async () => {
    const { createAvoidanceCarWorkbenchManifest } = await import(
      '@/services/templates/avoidance-car-w2-minimal',
    );
    const { validateBindings, isBlockingResult } = await import(
      '@/services/binding-validation.service',
    );
    const { deviceCatalog } = await import('@/catalog/device-catalog');
    const { bindingPinResolver } = await import('@/services/binding-pin-resolver');

    const manifest = createAvoidanceCarWorkbenchManifest();
    expect(manifest.bindings?.sensors.some(s => s.deviceComponentId === 'front_radar')).toBe(
      true,
    );
    const blocking = validateBindings(
      manifest,
      { targetMode: 'simulate', blockingOnly: true },
      { catalog: deviceCatalog, pinResolver: bindingPinResolver },
    ).filter(r => isBlockingResult(r, { targetMode: 'simulate' }));
    expect(blocking).toEqual([]);
  });
});
