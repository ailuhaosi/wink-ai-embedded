import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  isBlockingResult,
  validateBindings,
} from '@/services/binding-validation.service';
import { deviceCatalog } from '@/catalog/device-catalog';
import { bindingPinResolver } from '@/services/binding-pin-resolver';
import {
  AVOIDANCE_CAR_W2_MINIMAL,
  createUltrasonicBinding,
  createUltrasonicMount,
} from '@/services/templates/avoidance-car-w2-minimal';
import type { EmbeddedProjectManifest } from '@/types/manifest-v2';
import { suggestBindings } from '@/services/binding-suggest.service';

const deps = { catalog: deviceCatalog, pinResolver: bindingPinResolver };

describe('binding-validation B-01~B-10', () => {
  it('b-01: rejects unknown deviceComponentId', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      bindings: {
        actuators: [],
        displays: [],
        sensors: [
          {
            bindingId: 'bad',
            deviceComponentId: 'missing_device',
            mechanicalPartId: 'mount',
            mapping: {
              type: 'raycast_range_cm',
              maxRangeCm: 400,
              rayOriginOffset: { x: 0, y: 0, z: 0 },
              rayDirection: { x: 1, y: 0, z: 0 },
            },
          },
        ],
      },
    };
    const r = validateBindings(manifest, { targetMode: 'simulate' }, deps);
    expect(r.some(x => x.ruleId === 'B-01' && x.severity === 'error')).toBe(true);
  });

  it('b-03: rejects duplicate PWM actuator on same pin', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      devices: [
        ...AVOIDANCE_CAR_W2_MINIMAL.devices,
        { componentId: 'motors', modelId: 'motor_driver_stub' },
      ],
      bindings: {
        sensors: [],
        displays: [],
        actuators: [
          {
            bindingId: 'a1',
            deviceComponentId: 'motors',
            pin: 'PWM_LEFT',
            mechanicalJointId: 'j1',
            mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false },
          },
          {
            bindingId: 'a2',
            deviceComponentId: 'motors',
            pin: 'PWM_LEFT',
            mechanicalJointId: 'j2',
            mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false },
          },
        ],
      },
    };
    expect(validateBindings(manifest, { targetMode: 'simulate' }, deps).some(x => x.ruleId === 'B-03')).toBe(true);
  });

  it('b-04: missing mechanicalPartId is warning in design, error in simulate', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      bindings: {
        actuators: [],
        displays: [],
        sensors: [
          {
            bindingId: 'bind_radar',
            deviceComponentId: 'front_radar',
            mapping: {
              type: 'raycast_range_cm',
              maxRangeCm: 400,
              rayOriginOffset: { x: 0, y: 0, z: 0 },
              rayDirection: { x: 1, y: 0, z: 0 },
            },
          },
        ],
      },
    };
    const design = validateBindings(manifest, { targetMode: 'design' }, deps).find(x => x.ruleId === 'B-04');
    expect(design?.severity).toBe('warning');
    const sim = validateBindings(manifest, { targetMode: 'simulate' }, deps).find(x => x.ruleId === 'B-04');
    expect(sim?.severity).toBe('error');
  });

  it('b-06: rejects PWM mapping on GPIO-only pin', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      devices: [{ componentId: 'led1', modelId: 'led' }],
      bindings: {
        sensors: [],
        displays: [],
        actuators: [
          {
            bindingId: 'led_pwm',
            deviceComponentId: 'led1',
            pin: 'A',
            mechanicalPartId: 'part_led',
            mapping: { type: 'pwm_to_brightness', maxLumens: 100, curve: 'linear' },
          },
        ],
      },
      mechanical: {
        parts: [{ partId: 'part_led', modelId: 'led', displayName: 'LED', transform: { position: { x: 0, y: 0, z: 0 } }, physics: { collider: 'none' } }],
        joints: [],
      },
    };
    expect(validateBindings(manifest, { targetMode: 'simulate' }, deps).some(x => x.ruleId === 'B-06')).toBe(true);
  });

  it('b-07: pwm_to_angular_velocity requires mechanicalJointId', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      devices: [{ componentId: 'motors', modelId: 'motor_driver_stub' }],
      bindings: {
        sensors: [],
        displays: [],
        actuators: [
          {
            bindingId: 'm1',
            deviceComponentId: 'motors',
            pin: 'PWM_LEFT',
            mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false },
          },
        ],
      },
    };
    expect(validateBindings(manifest, { targetMode: 'simulate' }, deps).some(x => x.ruleId === 'B-07')).toBe(true);
  });

  it('a5: B-09 blocks simulate when hc-sr04 has no binding', () => {
    const results = validateBindings(AVOIDANCE_CAR_W2_MINIMAL, { targetMode: 'simulate' }, deps);
    const b09 = results.find(x => x.ruleId === 'B-09');
    expect(b09).toBeDefined();
    expect(isBlockingResult(b09!, { targetMode: 'simulate' })).toBe(true);
  });

  it('a5b: B-10 blocks simulate when binding exists but TRIG/ECHO not wired', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      connections: [],
      mechanical: createUltrasonicMount(),
      bindings: createUltrasonicBinding('mount_ultrasonic'),
    };
    const b10 = validateBindings(manifest, { targetMode: 'simulate' }, deps).find(x => x.ruleId === 'B-10');
    expect(b10).toBeDefined();
    expect(isBlockingResult(b10!, { targetMode: 'simulate' })).toBe(true);
  });

  it('a6: passes when ultrasonic binding + connections complete', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      mechanical: createUltrasonicMount(),
      bindings: createUltrasonicBinding('mount_ultrasonic'),
    };
    const blocking = validateBindings(
      manifest,
      { targetMode: 'simulate', blockingOnly: true },
      deps,
    ).filter(r => isBlockingResult(r, { targetMode: 'simulate' }));
    expect(blocking).toEqual([]);
  });

  it('a7: suggestBindings proposes ultrasonic raycast when mount exists', () => {
    const manifest: EmbeddedProjectManifest = {
      ...AVOIDANCE_CAR_W2_MINIMAL,
      mechanical: createUltrasonicMount(),
    };
    const suggestions = suggestBindings(manifest);
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions[0].suggestedMapping.type).toBe('raycast_range_cm');
  });
});

describe('a10 VITE_MANIFEST_SCHEMA_V2 gate', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MANIFEST_SCHEMA_V2', 'false');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('project store skips validation when flag false', async () => {
    vi.resetModules();
    const { useProjectStore } = await import('@/stores/project.store');
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const store = useProjectStore();
    store.setManifest(AVOIDANCE_CAR_W2_MINIMAL);
    expect(store.lastValidationResults).toEqual([]);
    expect(store.getBlockingValidationResults()).toEqual([]);
  });
});

describe('workbench binding gate with V2 enabled', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_MANIFEST_SCHEMA_V2', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('blocks design → simulate when hc-sr04 lacks binding', async () => {
    vi.resetModules();
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const { useWorkbenchModeStore } = await import('@/stores/workbench-mode.store');
    const { useProjectStore } = await import('@/stores/project.store');
    const { AVOIDANCE_CAR_W2_MINIMAL } = await import('@/services/templates/avoidance-car-w2-minimal');

    useProjectStore().setManifest(AVOIDANCE_CAR_W2_MINIMAL);
    const modeStore = useWorkbenchModeStore();

    const ok = await modeStore.switchTo('simulate', {
      isSimulationReady: true,
      components: [
        {
          id: 'sonar1',
          type: 'ultrasonic',
          name: 'HC-SR04',
          pinConnections: { VCC: 'VCC', TRIG: 12, ECHO: 13, GND: 'GND' },
        },
      ],
    });

    expect(ok).toBe(false);
    expect(modeStore.lastBindingValidationIssues.some(x => x.ruleId === 'B-09')).toBe(true);
  });

  it('allows simulate after binding + mount configured', async () => {
    vi.resetModules();
    const { createPinia, setActivePinia } = await import('pinia');
    setActivePinia(createPinia());
    const { useWorkbenchModeStore } = await import('@/stores/workbench-mode.store');
    const { useProjectStore } = await import('@/stores/project.store');
    const {
      AVOIDANCE_CAR_W2_MINIMAL,
      createUltrasonicBinding,
      createUltrasonicMount,
    } = await import('@/services/templates/avoidance-car-w2-minimal');

    useProjectStore().setManifest({
      ...AVOIDANCE_CAR_W2_MINIMAL,
      mechanical: createUltrasonicMount(),
      bindings: createUltrasonicBinding('mount_ultrasonic'),
    });

    const ok = await useWorkbenchModeStore().switchTo('simulate', {
      isSimulationReady: true,
      components: [
        {
          id: 'front_radar',
          type: 'ultrasonic',
          name: 'Front Radar',
          pinConnections: { VCC: 'VCC', TRIG: 4, ECHO: 5, GND: 'GND' },
        },
      ],
    });

    expect(ok).toBe(true);
  });
});
