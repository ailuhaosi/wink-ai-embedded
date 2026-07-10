import { ref, watch } from 'vue';
import { boardDescriptor } from '@/types/peripheral-pins';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  boardPinOffsets,
  boardPowerPinOffsets,
  INITIAL_COMMON_POWER_NODES,
} from './constants';
import type { CanvasContext, LayoutPosition, Point, UseCircuitCanvasOptions, WireRenderItem } from './types';

export function buildCanvasContext(options: UseCircuitCanvasOptions): CanvasContext {
  const { components, selectedComponentId, pinStates, routingMode, readonly, onLayoutChange } = options;

  const layoutState = ref<Record<string, LayoutPosition>>({});
  const nextPositionOffset = ref<Record<string, number>>({});

  const canvasContainerRef = ref<HTMLElement | null>(null);
  const circuitSvgRef = ref<SVGSVGElement | null>(null);
  const canvasOledRef = ref<any>(null);

  const viewWidth = ref(CANVAS_WIDTH);
  const viewHeight = ref(CANVAS_HEIGHT);
  const peripheralScaleX = ref(1);
  const peripheralScaleY = ref(1);

  const wireWaypoints = ref<Record<string, Point[]>>({});
  const draggedWireId = ref<string | null>(null);
  const draggingWaypoint = ref<{ wireId: string; index: number } | null>(null);
  const selectedWireId = ref<string | null>(null);
  const dragThreshold = 8;
  const wireDragStart = ref({ x: 0, y: 0 });
  const pendingWaypoint = ref<{ wireId: string; x: number; y: number } | null>(null);
  const draggingSegment = ref<{ wireId: string; startIndex: number; endIndex: number; startOffset: number } | null>(null);
  const inactiveWireCache = ref<Record<string, WireRenderItem>>({});

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

  watch(routingMode, () => {
    inactiveWireCache.value = {};
  });

  return {
    components,
    selectedComponentId,
    pinStates,
    routingMode,
    readonly,
    onLayoutChange,
    layoutState,
    nextPositionOffset,
    canvasContainerRef,
    circuitSvgRef,
    canvasOledRef,
    CANVAS_WIDTH,
    CANVAS_HEIGHT,
    viewWidth,
    viewHeight,
    peripheralScaleX,
    peripheralScaleY,
    wireWaypoints,
    draggedWireId,
    draggingWaypoint,
    selectedWireId,
    dragThreshold,
    wireDragStart,
    pendingWaypoint,
    draggingSegment,
    inactiveWireCache,
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
  };
}
