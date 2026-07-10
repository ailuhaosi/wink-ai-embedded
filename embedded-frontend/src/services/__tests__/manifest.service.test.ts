import { describe, expect, it } from 'vitest';
import {
  parseManifestJson,
  prepareManifestForExport,
} from '@/services/manifest.service';
import { createAvoidanceCarWorkbenchManifest } from '@/services/templates/avoidance-car-w2-minimal';

describe('manifest.service', () => {
  it('prepareManifestForExport normalizes connection pin refs', () => {
    const manifest = createAvoidanceCarWorkbenchManifest();
    const exported = prepareManifestForExport(manifest);
    const conn = exported.connections[0];

    expect(typeof conn.from).toBe('object');
    expect(conn.from).toEqual({
      componentId: 'front_radar',
      pin: 'TRIG',
    });
  });

  it('parseManifestJson migrates v1 payloads', () => {
    const parsed = parseManifestJson({
      schemaVersion: 1,
      id: 'legacy',
      name: 'Legacy',
      target: { boardId: 'esp32-devkit-v1' },
      devices: [],
      connections: [],
    });
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.bindings?.sensors).toEqual([]);
  });
});
