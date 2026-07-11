import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { PinConnectionValue } from '@/types/peripheral-pins';
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
    getCanvasX: () => 100,
    getCanvasY: () => 100,
    getComponentSize: () => ({ width: 50, height: 60 }),
    getComponentObstacle: () => ({ x: 100, y: 100, width: 50, height: 60 }),
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

describe('useWireRendering wire selection visuals', () => {
  it('applies breathing highlight to the selected wire', () => {
    const comp = makeComponent('led', 'led1', { A: 13, C: 'GND' });
    const ctx = createMockContext([comp]);
    const { getWireVisual } = useWireRendering(ctx, createMockLayout());

    ctx.selectedWireId.value = 'led1-primary';
    const visual = getWireVisual({ id: 'led1-primary' } as Parameters<typeof getWireVisual>[0]);

    expect(visual.breathing).toBe(true);
    expect(visual.highlighted).toBe(true);
    expect(visual.dimmed).toBe(false);
  });
});
