import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

describe('layout store mode defaults', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('a15: simulate collapses left panel and design restores prior state', async () => {
    const { useLayoutStore } = await import('../layout.store');
    const { useWorkbenchModeStore } = await import('../workbench-mode.store');
    const layout = useLayoutStore();
    const mode = useWorkbenchModeStore();

    layout.leftPanelCollapsed = false;
    mode.current = 'design';
    layout.applyModeDefaults('simulate');

    expect(layout.leftPanelCollapsed).toBe(true);
    expect(layout.leftPanelCollapsedBeforeSimulate).toBe(false);

    layout.applyModeDefaults('design');
    expect(layout.leftPanelCollapsed).toBe(false);
  });

  it('a15: restores collapsed-before-simulate when returning to design', async () => {
    const { useLayoutStore } = await import('../layout.store');
    const layout = useLayoutStore();

    layout.leftPanelCollapsed = true;
    layout.applyModeDefaults('simulate');
    expect(layout.leftPanelCollapsed).toBe(true);
    expect(layout.leftPanelCollapsedBeforeSimulate).toBe(true);

    layout.applyModeDefaults('design');
    expect(layout.leftPanelCollapsed).toBe(true);
  });

  it('a16: simulate opens Trace; diagnose opens Causal', async () => {
    const { useLayoutStore } = await import('../layout.store');
    const layout = useLayoutStore();

    layout.applyModeDefaults('simulate');
    expect(layout.bottomPanelActiveTab).toBe('trace');
    expect(layout.bottomPanelExpanded).toBe(true);

    layout.applyModeDefaults('diagnose');
    expect(layout.bottomPanelActiveTab).toBe('causal');
  });

  it('a4/A19: mode defaults set expected split ratios', async () => {
    const { useLayoutStore } = await import('../layout.store');
    const { useWorkbenchModeStore } = await import('../workbench-mode.store');
    const layout = useLayoutStore();
    const mode = useWorkbenchModeStore();

    mode.userOverriddenRatio = false;
    mode.designSubMode = 'circuit-first';

    layout.applyModeDefaults('design');
    expect(layout.splitRatio).toBe(0.7);

    layout.applyModeDefaults('simulate');
    expect(layout.splitRatio).toBe(0.4);

    layout.applyModeDefaults('diagnose');
    expect(layout.splitRatio).toBe(0.5);
  });
});
