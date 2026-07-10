import { describe, expect, it } from 'vitest';
import {
  OLED_DASHBOARD_DEMO_MANIFEST,
  OLED_DASHBOARD_TEMPLATE_ID,
  createOledDashboardCanvasComponents,
  createOledDashboardWorkbenchManifest,
} from '@/services/templates/oled-dashboard-demo';

describe('oled-dashboard-demo template', () => {
  it('manifest has correct schemaVersion and id', () => {
    expect(OLED_DASHBOARD_DEMO_MANIFEST.schemaVersion).toBe(2);
    expect(OLED_DASHBOARD_DEMO_MANIFEST.id).toBe(OLED_DASHBOARD_TEMPLATE_ID);
  });

  it('manifest devices do NOT contain hc-sr04', () => {
    const modelIds = OLED_DASHBOARD_DEMO_MANIFEST.devices.map(d => d.modelId);
    expect(modelIds).not.toContain('hc-sr04');
  });

  it('manifest has zero bindings (no B-09 blocker)', () => {
    const { bindings } = OLED_DASHBOARD_DEMO_MANIFEST;
    expect(bindings?.actuators).toHaveLength(0);
    expect(bindings?.sensors).toHaveLength(0);
    expect(bindings?.displays).toHaveLength(0);
  });

  it('canvas preset button 1.l === 10 (GPIO10)', () => {
    const comps = createOledDashboardCanvasComponents();
    const btn = comps.find(c => c.type === 'button');
    expect(btn).toBeDefined();
    expect(btn!.pinConnections['1.l']).toBe(10);
  });

  it('canvas preset LED A === 2 (GPIO2)', () => {
    const comps = createOledDashboardCanvasComponents();
    const led = comps.find(c => c.type === 'led');
    expect(led).toBeDefined();
    expect(led!.pinConnections.A).toBe(2);
  });

  it('canvas preset OLED DATA === 21, CLK === 22', () => {
    const comps = createOledDashboardCanvasComponents();
    const oled = comps.find(c => c.type === 'oled');
    expect(oled).toBeDefined();
    expect(oled!.pinConnections.DATA).toBe(21);
    expect(oled!.pinConnections.CLK).toBe(22);
  });

  it('canvas preset button has activeLow: true', () => {
    const comps = createOledDashboardCanvasComponents();
    const btn = comps.find(c => c.type === 'button');
    expect(btn!.props.activeLow).toBe(true);
  });

  it('createOledDashboardWorkbenchManifest returns deep clone', () => {
    const m1 = createOledDashboardWorkbenchManifest();
    const m2 = createOledDashboardWorkbenchManifest();
    expect(m1).toEqual(m2);
    expect(m1).not.toBe(m2);
    // Mutating one should not affect the other
    m1.name = 'mutated';
    expect(m2.name).toBe('OLED Dashboard Demo');
  });
});
