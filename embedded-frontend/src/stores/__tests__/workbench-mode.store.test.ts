import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { runStaticCheck } from '../../services/static-check.service';

describe('static-check.service', () => {
  it('blocks when simulation is not ready', () => {
    const result = runStaticCheck({
      isSimulationReady: false,
      components: [{ id: 'led1', type: 'led', name: 'LED', pinConnections: { A: 2, C: 'GND' } }],
    });
    expect(result.ok).toBe(false);
  });

  it('blocks when no components', () => {
    const result = runStaticCheck({
      isSimulationReady: true,
      components: [],
    });
    expect(result.ok).toBe(false);
  });

  it('passes with connected components', () => {
    const result = runStaticCheck({
      isSimulationReady: true,
      components: [{ id: 'led1', type: 'led', name: 'LED', pinConnections: { A: 2, C: 'GND' } }],
    });
    expect(result.ok).toBe(true);
  });

  it('allows button with open signal pins (demo default)', () => {
    const result = runStaticCheck({
      isSimulationReady: true,
      components: [
        { id: 'led1', type: 'led', name: 'LED', pinConnections: { A: 13, C: 'GND' } },
        {
          id: 'btn1',
          type: 'button',
          name: 'Push Button',
          pinConnections: { '1.l': null, '2.l': 'VCC', '1.r': null, '2.r': null },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });

  it('passes with default workbench demo peripherals', () => {
    const result = runStaticCheck({
      isSimulationReady: true,
      components: [
        { id: 'led1', type: 'led', name: 'Virtual LED', pinConnections: { A: 13, C: 'GND' } },
        {
          id: 'btn1',
          type: 'button',
          name: 'Push Button',
          pinConnections: { '1.l': null, '2.l': 'VCC', '1.r': null, '2.r': null },
        },
        {
          id: 'oled1',
          type: 'oled',
          name: 'SSD1306 Display',
          pinConnections: { DATA: 21, CLK: 22, DC: null, RST: null, CS: null, '3V3': '3V3', VIN: null, GND: 'GND' },
        },
        {
          id: 'sonar1',
          type: 'ultrasonic',
          name: 'HC-SR04 Sensor',
          pinConnections: { VCC: 'VCC', TRIG: 12, ECHO: 13, GND: 'GND' },
        },
      ],
    });
    expect(result.ok).toBe(true);
  });
});

describe('workbench-mode store guards', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('blocks design → simulate when static check fails', async () => {
    const { useWorkbenchModeStore } = await import('../workbench-mode.store');
    const { useLayoutStore } = await import('../layout.store');
    const modeStore = useWorkbenchModeStore();
    const layoutStore = useLayoutStore();

    const ok = await modeStore.switchTo('simulate', {
      isSimulationReady: false,
      components: [],
    });

    expect(ok).toBe(false);
    expect(modeStore.current).toBe('design');
    expect(layoutStore.bottomPanelActiveTab).toBe('static-check');
  });

  it('allows design → simulate when static check passes', async () => {
    const { useWorkbenchModeStore } = await import('../workbench-mode.store');
    const modeStore = useWorkbenchModeStore();

    const ok = await modeStore.switchTo('simulate', {
      isSimulationReady: true,
      components: [{ id: 'led1', type: 'led', name: 'LED', pinConnections: { A: 2, C: 'GND' } }],
    });

    expect(ok).toBe(true);
    expect(modeStore.current).toBe('simulate');
  });

  it('requires confirmation for simulate → design', async () => {
    const { useWorkbenchModeStore } = await import('../workbench-mode.store');
    const modeStore = useWorkbenchModeStore();

    await modeStore.switchTo('simulate', {
      isSimulationReady: true,
      components: [{ id: 'led1', type: 'led', name: 'LED', pinConnections: { A: 2, C: 'GND' } }],
    });

    const ok = await modeStore.switchTo('design');
    expect(ok).toBe(false);
    expect(modeStore.pendingSwitchTarget).toBe('design');

    modeStore.confirmPendingSwitch();
    expect(modeStore.current).toBe('design');
  });
});
