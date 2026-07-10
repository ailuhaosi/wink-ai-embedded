import { describe, expect, it } from 'vitest';
import { migrateManifest } from '@/services/manifest-migration';

describe('manifest-migration', () => {
  it('migrates schema v1 to v2 with empty sections', () => {
    const raw = {
      schemaVersion: 1,
      id: 'p1',
      name: 'Test',
      target: { boardId: 'esp32-devkit-v1' },
      devices: [],
      connections: [],
    };
    const m = migrateManifest(raw);
    expect(m.schemaVersion).toBe(2);
    expect(m.mechanical?.parts).toEqual([]);
    expect(m.bindings?.sensors).toEqual([]);
  });

  it('normalizes intensity → valueC on v2', () => {
    const m = migrateManifest({
      schemaVersion: 2,
      id: 'p2',
      name: 'Test',
      target: { boardId: 'esp32-devkit-v1' },
      devices: [],
      connections: [],
      environment: {
        props: [],
        fields: [{ fieldId: 'ambient', type: 'uniform_temperature', intensity: 30 }],
      },
    });
    expect(m.environment?.fields[0].valueC).toBe(30);
  });

  it('throws on unknown schema version', () => {
    expect(() => migrateManifest({ schemaVersion: 99 })).toThrow(/Unknown manifest schemaVersion/);
  });
});
