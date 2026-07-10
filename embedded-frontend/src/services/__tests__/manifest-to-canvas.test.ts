import { describe, expect, it } from 'vitest';
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
    expect(components.find((c) => c.id === 'oled1')?.pinConnections.DATA).toBe(21);
    expect(layoutPositions.oled1).toEqual({ x: 530, y: 120 });
  });

  it('hydrates ultrasonic pins from avoidance car manifest', () => {
    const manifest = createAvoidanceCarWorkbenchManifest();
    const { components } = manifestToCanvas(manifest);

    expect(components).toHaveLength(1);
    expect(components[0]).toMatchObject({
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
  });

  it('skips board devices and non-canvas stubs', () => {
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
    expect(components).toHaveLength(1);
    expect(components[0].pinConnections.A).toBe(13);
    expect(components[0].pinConnections.C).toBe('GND');
    expect(layoutPositions.led1).toEqual({ x: 120, y: 80 });
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
