import '@/peripherals';
import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { createOledDashboardCanvasComponents } from '@/services/templates/oled-dashboard-demo';
import { boardDescriptor } from '@/types/peripheral-pins';
import { segmentIntersectsObstacle } from '../geometry';
import { boardPinOffsets, boardPowerPinOffsets, CANVAS_HEIGHT, CANVAS_WIDTH, INITIAL_COMMON_POWER_NODES } from '@/composables/canvas/constants';
import type { CanvasContext } from '@/composables/canvas/types';
import { useWireRendering } from '@/composables/canvas/useWireRendering';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_OBSTACLE = {
  x: BOARD_X,
  y: BOARD_Y,
  width: boardDescriptor.width,
  height: boardDescriptor.height,
};

function interiorCrossesBoard(points: Array<{ x: number; y: number }>): boolean {
  for (let i = 1; i < points.length - 2; i++) {
    if (segmentIntersectsObstacle(points[i], points[i + 1], [BOARD_OBSTACLE], 0)) {
      return true;
    }
  }
  return false;
}

function createOledDashboardContext(): CanvasContext {
  return {
    components: ref(createOledDashboardCanvasComponents()),
    selectedComponentId: ref(''),
    selectedWireId: ref(null),
    pinStates: ref({}),
    readonly: ref(false),
    layoutState: ref({
      btn1: { x: 80, y: 240 },
      led1: { x: 100, y: 100 },
      oled1: { x: 530, y: 120 },
    }),
    nextPositionOffset: ref({}),
    canvasContainerRef: ref(null),
    circuitSvgRef: ref(null),
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    viewWidth: ref(CANVAS_WIDTH),
    viewHeight: ref(CANVAS_HEIGHT),
    peripheralScaleX: ref(1),
    peripheralScaleY: ref(1),
    boardPosition: ref({ x: BOARD_X, y: BOARD_Y }),
    isDraggingBoard: ref(false),
    boardDragOffset: ref({ x: 0, y: 0 }),
    boardPinOffsets,
    boardPowerPinOffsets,
    commonPowerNodes: ref({ ...INITIAL_COMMON_POWER_NODES }),
    draggedPowerNodeId: ref(null),
    draggedCompId: ref(null),
    dragOffset: ref({ x: 0, y: 0 }),
    componentDragOrigin: ref({ x: 0, y: 0 }),
    isComponentDragging: ref(false),
    frozenTrackAssignments: ref(null),
    dragThreshold: 8,
  };
}

function createLayout() {
  const positions = {
    btn1: { x: 80, y: 240 },
    led1: { x: 100, y: 100 },
    oled1: { x: 530, y: 120 },
  };
  return {
    getCanvasX: (comp: { id: string }) => positions[comp.id as keyof typeof positions]?.x ?? 50,
    getCanvasY: (comp: { id: string }) => positions[comp.id as keyof typeof positions]?.y ?? 50,
    getComponentSize: (type: string) => {
      const sizes: Record<string, { width: number; height: number }> = {
        led: { width: 50, height: 60 },
        button: { width: 104, height: 84 },
        oled: { width: 128, height: 64 },
      };
      return sizes[type] ?? { width: 80, height: 60 };
    },
    getComponentObstacle: (comp: { id: string; type: string }) => {
      const x = positions[comp.id as keyof typeof positions]?.x ?? 50;
      const y = positions[comp.id as keyof typeof positions]?.y ?? 50;
      const size = comp.type === 'oled'
        ? { width: 128, height: 64 }
        : comp.type === 'button'
          ? { width: 104, height: 84 }
          : { width: 50, height: 60 };
      return { x, y, width: size.width, height: size.height };
    },
  };
}

describe('OLED dashboard demo routing', () => {
  it('no wire pathPoints cross board interior', () => {
    const ctx = createOledDashboardContext();
    const layout = createLayout();
    const { wiresToRender } = useWireRendering(ctx, layout);

    const offenders: string[] = [];
    for (const wire of wiresToRender.value) {
      const points = wire.pathPoints;
      if (!points || points.length < 2) continue;
      if (interiorCrossesBoard(points)) {
        offenders.push(wire.id);
      }
    }

    expect(offenders, `wires crossing board: ${offenders.join(', ')}`).toEqual([]);
  });

  it('GPIO 2 and 10 use board-edge pin positions', () => {
    expect(boardDescriptor.pins[2]).toEqual({ x: 317, y: 132 });
    expect(boardDescriptor.pins[10]).toEqual({ x: 317, y: 282 });
    expect(boardPinOffsets[2]).toBeDefined();
    expect(boardPinOffsets[10]).toBeDefined();
  });
});
