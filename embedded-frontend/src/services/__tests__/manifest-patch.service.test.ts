import { describe, expect, it } from 'vitest';
import {
  createWorkbenchTemplateManifest,
  isOledDashboardTemplate,
  normalizeTemplateId,
  WORKBENCH_TEMPLATE_IDS,
} from '@/services/manifest-patch.service';
import { manifestToCanvas } from '@/services/manifest-to-canvas.service';

describe('manifest-patch.service', () => {
  it('normalizes template aliases', () => {
    expect(normalizeTemplateId('tpl_oled_dashboard')).toBe(
      WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD,
    );
    expect(normalizeTemplateId('unknown')).toBeNull();
  });

  it('creates OLED dashboard manifest hydratable to canvas', () => {
    const manifest = createWorkbenchTemplateManifest(WORKBENCH_TEMPLATE_IDS.OLED_DASHBOARD);
    expect(manifest).not.toBeNull();
    const { components, layoutPositions } = manifestToCanvas(manifest!);
    expect(components).toHaveLength(3);
    expect(components.find(c => c.id === 'btn1')?.pinConnections['1.l']).toBe(10);
    expect(layoutPositions.btn1).toEqual({ x: 80, y: 240 });
    expect(isOledDashboardTemplate('tpl_oled_dashboard')).toBe(true);
  });

  it('creates avoidance car manifest with bindings', () => {
    const manifest = createWorkbenchTemplateManifest(WORKBENCH_TEMPLATE_IDS.AVOIDANCE_CAR);
    expect(manifest?.bindings?.sensors.length).toBeGreaterThan(0);
    expect(manifest?.mechanical?.parts.length).toBeGreaterThan(0);
  });
});
