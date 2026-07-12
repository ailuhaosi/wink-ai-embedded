import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { manifestToCanvas } from '@/services/manifest-to-canvas.service';
import { createAvoidanceCarWorkbenchManifest } from '@/services/templates/avoidance-car-w2-minimal';
import { migrateManifest } from '@/services/manifest-migration';
import { createOledDashboardWorkbenchManifest } from '@/services/templates/oled-dashboard-demo';

describe('manifest-to-canvas', () => {
  it('hydrates OLED dashboard template from manifest', () => {
    const { components, layoutPositions } = manifestToCanvas(
      createOledDashboardWorkbenchManifest(),
    );
    expect(components).toHaveLength(3);
    expect(components.find(c => c.id === 'oled1')?.pinConnections.DATA).toBe(21);
    expect(layoutPositions.oled1).toEqual({ x: 530, y: 120 });
  });

  it('hydrates ultrasonic pins from avoidance car manifest', () => {
    const manifest = createAvoidanceCarWorkbenchManifest();
    const { components } = manifestToCanvas(manifest);

    expect(components).toHaveLength(2);
    expect(components.find(c => c.id === 'front_radar')).toMatchObject({
      id: 'front_radar',
      type: 'ultrasonic',
      name: 'Front Radar',
      pinConnections: {
        VCC: 'VCC',
        TRIG: 4,
        ECHO: 5,
        GND: 'GND',
      },
    });
    expect(components.find(c => c.id === 'neck_servo')).toMatchObject({
      id: 'neck_servo',
      type: 'servo',
      name: 'Neck Servo',
      pinConnections: {
        VCC: 'VCC',
        SIG: 2,
        GND: 'GND',
      },
      props: {
        pwmChannel: 0,
        minPulseMs: 0.5,
        maxPulseMs: 2.5,
      },
    });
  });

  it('skips board devices and hydrates canvas peripherals including stubs', () => {
    const manifest = migrateManifest({
      schemaVersion: 2,
      id: 'p1',
      name: 'Mixed',
      target: { boardId: 'esp32-devkit-v1' },
      devices: [
        { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
        { componentId: 'motors', modelId: 'motor_driver_stub' },
        {
          componentId: 'led1',
          modelId: 'led',
          displayName: 'Status LED',
          position: { x: 120, y: 80 },
        },
      ],
      connections: [
        {
          id: 'conn_led',
          from: { componentId: 'led1', pin: 'A' },
          to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO13' },
          routing: { mode: 'orthogonal' },
        },
        {
          id: 'conn_gnd',
          from: { componentId: 'led1', pin: 'C' },
          to: { componentId: '__board__esp32-devkit-v1', pin: 'GND' },
          routing: { mode: 'orthogonal' },
        },
      ],
    });

    const { components, layoutPositions } = manifestToCanvas(manifest);
    expect(components).toHaveLength(2);

    const led = components.find(c => c.id === 'led1');
    expect(led?.pinConnections.A).toBe(13);
    expect(led?.pinConnections.C).toBe('GND');
    expect(layoutPositions.led1).toEqual({ x: 120, y: 80 });

    const motors = components.find(c => c.id === 'motors');
    expect(motors).toMatchObject({
      type: 'motor_driver_stub',
      pinConnections: {
        PWM_LEFT: 14,
        PWM_RIGHT: 15,
        VCC: 'VCC',
        GND: 'GND',
      },
    });
  });

  it('accepts string pin refs in connections', () => {
    const manifest = migrateManifest({
      schemaVersion: 2,
      id: 'p2',
      name: 'String refs',
      target: { boardId: 'esp32-devkit-v1' },
      devices: [{ componentId: 'sonar1', modelId: 'hc-sr04' }],
      connections: [
        {
          id: 'c1',
          from: 'sonar1:TRIG',
          to: '__board__esp32-devkit-v1:GPIO12',
          routing: { mode: 'orthogonal' },
        },
      ],
    });

    const { components } = manifestToCanvas(manifest);
    expect(components[0].pinConnections.TRIG).toBe(12);
  });
});

describe('manifest ↔ canvas SSOT roundtrip', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('commitCanvasSnapshot preserves layout positions and is idempotent after re-project', async () => {
    const { useProjectStore } = await import('@/stores/project.store');
    const store = useProjectStore();
    const source = createOledDashboardWorkbenchManifest();
    store.setManifest(source);

    const first = manifestToCanvas(store.manifest);
    store.commitCanvasSnapshot(first.components, first.layoutPositions);

    const oled = store.manifest.devices.find(d => d.componentId === 'oled1');
    expect(oled?.position).toEqual({ x: 530, y: 120 });

    const second = manifestToCanvas(store.manifest);
    store.commitCanvasSnapshot(second.components, second.layoutPositions);

    const oledAgain = store.manifest.devices.find(d => d.componentId === 'oled1');
    expect(oledAgain?.position).toEqual({ x: 530, y: 120 });
    expect(second.components.map(c => c.id).sort()).toEqual(
      first.components.map(c => c.id).sort(),
    );
  });
});
