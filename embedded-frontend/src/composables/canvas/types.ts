import type { Ref } from 'vue';
import type { CircuitComponentInstance } from '@/types/circuit-component';

export interface LayoutPosition {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface WireRenderItem {
  id: string;
  path: string;
  color: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  width: number;
  segments: Array<{ d: string; layer: number }>;
  vias: Array<{ x: number; y: number }>;
  teardrops: Array<string>;
  signalType: 'digital' | 'i2c' | 'power';
  compId?: string;
  pathPoints?: Array<{ x: number; y: number }>;
}

export interface WireVisualState {
  opacity: number;
  widthBoost: number;
  highlighted: boolean;
  dimmed: boolean;
  breathing: boolean;
}

export interface NetRequest {
  compId: string;
  comp: CircuitComponentInstance;
  mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
  color: string;
  signalType: 'digital' | 'i2c' | 'power';
}

export interface UseCircuitCanvasOptions {
  components: Ref<CircuitComponentInstance[]>;
  selectedComponentId: Ref<string>;
  pinStates: Ref<Record<number, boolean>>;
  readonly: Ref<boolean>;
  onLayoutChange?: () => void;
}

export interface CanvasContext {
  components: Ref<CircuitComponentInstance[]>;
  selectedComponentId: Ref<string>;
  selectedWireId: Ref<string | null>;
  pinStates: Ref<Record<number, boolean>>;
  readonly: Ref<boolean>;
  onLayoutChange?: () => void;
  layoutState: Ref<Record<string, LayoutPosition>>;
  nextPositionOffset: Ref<Record<string, number>>;
  canvasContainerRef: Ref<HTMLElement | null>;
  circuitSvgRef: Ref<SVGSVGElement | null>;
  CANVAS_WIDTH: number;
  CANVAS_HEIGHT: number;
  viewWidth: Ref<number>;
  viewHeight: Ref<number>;
  peripheralScaleX: Ref<number>;
  peripheralScaleY: Ref<number>;
  boardPosition: Ref<{ x: number; y: number }>;
  isDraggingBoard: Ref<boolean>;
  boardDragOffset: Ref<{ x: number; y: number }>;
  boardPinOffsets: Record<number, { x: number; y: number }>;
  boardPowerPinOffsets: Record<string, { x: number; y: number }>;
  commonPowerNodes: Ref<Record<string, { x: number; y: number; id: string; label: string; color: string }>>;
  draggedPowerNodeId: Ref<string | null>;
  draggedCompId: Ref<string | null>;
  dragOffset: Ref<{ x: number; y: number }>;
  componentDragOrigin: Ref<{ x: number; y: number }>;
  isComponentDragging: Ref<boolean>;
  frozenTrackAssignments: Ref<Map<string, import('@/routing/types').TrackAssignment> | null>;
  dragThreshold: number;
}
