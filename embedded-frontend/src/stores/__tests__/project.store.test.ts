import { describe, expect, it } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useProjectStore } from '@/stores/project.store';
import { createOledDashboardWorkbenchManifest } from '@/services/templates/oled-dashboard-demo';
import { manifestToCanvas } from '@/services/manifest-to-canvas.service';

describe('project.store syncFromCanvas (W2)', () => {
  it('persists board device and canvas layout positions', () => {
    setActivePinia(createPinia());
    const store = useProjectStore();
    const manifest = createOledDashboardWorkbenchManifest();
    const { components } = manifestToCanvas(manifest);

    store.setManifest(manifest);
    store.syncFromCanvas(components, {
      btn1: { x: 120, y: 250 },
      led1: { x: 110, y: 110 },
      oled1: { x: 540, y: 130 },
    });

    expect(store.manifest.devices.some(d => d.modelId === 'esp32-devkit-v1')).toBe(true);
    const btn = store.manifest.devices.find(d => d.componentId === 'btn1');
    expect(btn?.position).toEqual({ x: 120, y: 250 });
    expect(
      store.manifest.connections.some((c) => {
        const from = typeof c.from === 'string' ? c.from : `${c.from.componentId}:${c.from.pin}`;
        return from === 'btn1:1.l';
      }),
    ).toBe(true);
  });
});
