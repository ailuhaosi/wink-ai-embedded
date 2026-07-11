import '@/peripherals';
import { ref } from 'vue';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PinConnectionValue } from '@/types/peripheral-pins';
import { registry } from '@/peripherals';
import { boardPinOffsets, boardPowerPinOffsets, CANVAS_HEIGHT, CANVAS_WIDTH } from '../constants';
import type { CanvasContext } from '../types';
import { useWireRendering } from '../useWireRendering';

function createMockContext(components: CircuitComponentInstance[]): CanvasContext {
  return {
    components: ref(components),
    selectedComponentId: ref(''),
    selectedWireId: ref(null),
    pinStates: ref({}),
    readonly: ref(false),
    layoutState: ref({}),
    nextPositionOffset: ref({}),
    canvasContainerRef: ref(null),
    circuitSvgRef: ref(null),
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    viewWidth: ref(800),
    viewHeight: ref(580),
    peripheralScaleX: ref(1),
    peripheralScaleY: ref(1),
    boardPosition: ref({ x: 280, y: 60 }),
    isDraggingBoard: ref(false),
    boardDragOffset: ref({ x: 0, y: 0 }),
    boardPinOffsets,
    boardPowerPinOffsets,
    commonPowerNodes: ref({}),
    draggedPowerNodeId: ref(null),
    draggedCompId: ref(null),
    dragOffset: ref({ x: 0, y: 0 }),
    componentDragOrigin: ref({ x: 0, y: 0 }),
    isComponentDragging: ref(false),
    frozenTrackAssignments: ref(null),
    dragThreshold: 8,
  };
}

function createMockLayout() {
  return {
    getCanvasX: (comp: CircuitComponentInstance) => 100,
    getCanvasY: (comp: CircuitComponentInstance) => 100,
    getComponentSize: (type: string) => ({ width: 50, height: 60 }),
    getComponentObstacle: (comp: CircuitComponentInstance) => ({
      x: 100,
      y: 100,
      width: 50,
      height: 60,
    }),
  };
}

function makeComponent(
  type: string,
  id: string,
  pinConnections: Record<string, PinConnectionValue>,
): CircuitComponentInstance {
  return {
    id,
    type,
    name: id,
    pinConnections,
    props: {},
    rotation: 0,
  };
}

describe('useWireRendering wire colors', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('resolves primary wire color via registry.getWireColor', () => {
    vi.spyOn(registry, 'getWireColor').mockReturnValue('#deadbeef');

    const comp = makeComponent('led', 'led1', { A: 13, C: 'GND' });
    const { wiresToRender } = useWireRendering(createMockContext([comp]), createMockLayout());

    const primaryWire = wiresToRender.value.find(w => w.id === 'led1-primary');
    expect(primaryWire).toBeDefined();
    expect(primaryWire!.color).toBe('#deadbeef');
    expect(registry.getWireColor).toHaveBeenCalledWith('led');
  });

  it('uses registry wireColor for built-in peripheral types', () => {
    const cases = [
      { type: 'led', id: 'led1', pins: { A: 13, C: 'GND' } },
      { type: 'button', id: 'btn1', pins: { '1.l': 14, '2.l': 'GND' } },
      { type: 'ultrasonic', id: 'us1', pins: { ECHO: 12, TRIG: 14, VCC: 'VCC', GND: 'GND' } },
    ] as const;

    for (const { type, id, pins } of cases) {
      const comp = makeComponent(type, id, pins);
      const { wiresToRender } = useWireRendering(createMockContext([comp]), createMockLayout());
      const primaryWire = wiresToRender.value.find(w => w.id === `${id}-primary`);
      expect(primaryWire?.color).toBe(registry.getWireColor(type));
    }
  });

  it('does not change I2C secondary wire color for oled', () => {
    const comp = makeComponent('oled', 'oled1', {
      DATA: 21,
      CLK: 22,
      '3V3': '3V3',
      GND: 'GND',
    });
    const { wiresToRender } = useWireRendering(createMockContext([comp]), createMockLayout());

    const secondaryWire = wiresToRender.value.find(w => w.id === 'oled1-secondary');
    expect(secondaryWire?.color).toBe('#a78bfa');
  });
});
