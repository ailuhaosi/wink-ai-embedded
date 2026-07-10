import { ref } from 'vue';
import { boardDescriptor } from '@/types/peripheral-pins';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  boardPinOffsets,
  boardPowerPinOffsets,
  INITIAL_COMMON_POWER_NODES,
} from './constants';
import type { CanvasContext, LayoutPosition, UseCircuitCanvasOptions } from './types';

export function buildCanvasContext(options: UseCircuitCanvasOptions): CanvasContext {
  const { components, selectedComponentId, pinStates, readonly, onLayoutChange } = options;

  const layoutState = ref<Record<string, LayoutPosition>>({});
  const nextPositionOffset = ref<Record<string, number>>({});

  const canvasContainerRef = ref<HTMLElement | null>(null);
  const circuitSvgRef = ref<SVGSVGElement | null>(null);

  const viewWidth = ref(CANVAS_WIDTH);
  const viewHeight = ref(CANVAS_HEIGHT);
  const peripheralScaleX = ref(1);
  const peripheralScaleY = ref(1);

  const boardPosition = ref({ x: boardDescriptor.x, y: boardDescriptor.y });
  const isDraggingBoard = ref(false);
  const boardDragOffset = ref({ x: 0, y: 0 });

  const commonPowerNodes = ref({ ...INITIAL_COMMON_POWER_NODES });

  const draggedPowerNodeId = ref<string | null>(null);
  const draggedCompId = ref<string | null>(null);
  const dragOffset = ref({ x: 0, y: 0 });
  const componentDragOrigin = ref({ x: 0, y: 0 });
  const isComponentDragging = ref(false);
  const frozenTrackAssignments = ref<Map<string, import('@/routing/types').TrackAssignment> | null>(null);
  const dragThreshold = 8;

  return {
    components,
    selectedComponentId,
    pinStates,
    readonly,
    onLayoutChange,
    layoutState,
    nextPositionOffset,
    canvasContainerRef,
    circuitSvgRef,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    viewWidth,
    viewHeight,
    peripheralScaleX,
    peripheralScaleY,
    boardPosition,
    isDraggingBoard,
    boardDragOffset,
    boardPinOffsets,
    boardPowerPinOffsets,
    commonPowerNodes,
    draggedPowerNodeId,
    draggedCompId,
    dragOffset,
    componentDragOrigin,
    isComponentDragging,
    frozenTrackAssignments,
    dragThreshold,
  };
}
