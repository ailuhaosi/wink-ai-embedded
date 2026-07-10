import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';
import type { CanvasContext } from '../types';
import { useCanvasViewport } from '../useCanvasViewport';

function createMockContext(overrides: Partial<CanvasContext> = {}): CanvasContext {
  const circuitSvgRef = ref<SVGSVGElement | null>({
    getBoundingClientRect: () => ({
      left: 10,
      top: 20,
      width: 400,
      height: 290,
      right: 410,
      bottom: 310,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }),
  } as unknown as SVGSVGElement);

  const viewWidth = ref(800);
  const viewHeight = ref(580);

  return {
    components: ref([]),
    selectedComponentId: ref(''),
    pinStates: ref({}),
    readonly: ref(false),
    layoutState: ref({}),
    nextPositionOffset: ref({}),
    canvasContainerRef: ref(null),
    circuitSvgRef,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    viewWidth,
    viewHeight,
    peripheralScaleX: ref(1),
    peripheralScaleY: ref(1),
    boardPosition: ref({ x: 0, y: 0 }),
    isDraggingBoard: ref(false),
    boardDragOffset: ref({ x: 0, y: 0 }),
    boardPinOffsets: {},
    boardPowerPinOffsets: {},
    commonPowerNodes: ref({}),
    draggedPowerNodeId: ref(null),
    draggedCompId: ref(null),
    dragOffset: ref({ x: 0, y: 0 }),
    componentDragOrigin: ref({ x: 0, y: 0 }),
    isComponentDragging: ref(false),
    frozenTrackAssignments: ref(null),
    dragThreshold: 8,
    ...overrides,
  };
}

describe('useCanvasViewport clientToCanvas', () => {
  it('maps top-left of SVG bounding rect to canvas origin', () => {
    const ctx = createMockContext();
    const { clientToCanvas } = useCanvasViewport(ctx);

    expect(clientToCanvas(10, 20)).toEqual({ x: 0, y: 0 });
  });

  it('maps center of SVG bounding rect to canvas center', () => {
    const ctx = createMockContext();
    const { clientToCanvas } = useCanvasViewport(ctx);

    const result = clientToCanvas(210, 165);
    expect(result.x).toBeCloseTo(400, 5);
    expect(result.y).toBeCloseTo(290, 5);
  });

  it('falls back to client coordinates when circuitSvgRef is null', () => {
    const ctx = createMockContext({ circuitSvgRef: ref(null) });
    const { clientToCanvas } = useCanvasViewport(ctx);

    expect(clientToCanvas(100, 200)).toEqual({ x: 100, y: 200 });
  });
});
