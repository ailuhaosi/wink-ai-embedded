import { describe, expect, it } from 'vitest';
import { deviceCatalog } from '@/catalog/device-catalog';
import { worldRegistry } from '@/world-assets';

describe('world-assets registry', () => {
  it('lists mechanical models via deviceCatalog', () => {
    const ids = deviceCatalog.listMechanicalModels().map(m => m.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ultrasonic_mount_v1',
        'diff_drive_chassis_v1',
        'drive_wheel_v1',
        'sensor_enclosure_v1',
      ]),
    );
  });

  it('lists environment models via deviceCatalog', () => {
    const ids = deviceCatalog.listEnvironmentModels().map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['env_wall_segment', 'env_heat_source']));
  });

  it('supports runtime registration', () => {
    const id = `test_mechanical_${Date.now()}`;
    worldRegistry.registerMechanical({
      id,
      displayName: 'Test Mount',
      category: 'mount',
    });
    expect(deviceCatalog.listMechanicalModels().some(m => m.id === id)).toBe(true);
  });
});
