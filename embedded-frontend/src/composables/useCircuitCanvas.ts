import { ref, computed, watch } from 'vue';
import type { Ref } from 'vue';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  Obstacle,
  WirePathResult,
  NetDefinition,
  PinConnectionValue,
} from '@/types/peripheral-pins';
import {
  peripheralConfigs,
  getNetDefinitions,
  boardDescriptor,
  generatePowerBusTapPath,
  generatePowerBusTrunkPath,
  getRoutingChannels,
  getPowerNodeSlots,
  rotatePinOffset,
} from '@/types/peripheral-pins';
import { resolveBoardBounds, resolveBoardPinEndDir, resolvePeripheralPinStartDir } from '@/routing/geometry';
import { resolveNetConnection, resolveNetPin } from '@/routing/net-pin-resolver';
import { SegmentOccupancyRegistry } from '@/routing/segment-occupancy';
import { buildTrackAssignments } from '@/routing/track-allocator';
import { generateWirePath } from '@/routing/wire-routing';
import type { RoutingChannel, TrackAssignment, WireRouteRequest } from '@/routing/types';

interface LayoutPosition {
  x: number;
  y: number;
}

interface Point {
  x: number;
  y: number;
}

interface WireRenderItem {
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
  isActive?: boolean;
  isDragged?: boolean;
}

interface WireVisualState {
  opacity: number;
  widthBoost: number;
  highlighted: boolean;
  dimmed: boolean;
}

interface NetRequest {
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
  routingMode: Ref<'auto' | 'manual'>;
  readonly: Ref<boolean>;
  onLayoutChange?: () => void;
}

const defaultPositions: Record<string, { x: number; y: number }> = {
  led: { x: 100, y: 100 },
  button: { x: 80, y: 240 },
  oled: { x: 530, y: 120 },
  ultrasonic: { x: 90, y: 360 },
};

const DEFAULT_WIRE_VISUAL: WireVisualState = {
  opacity: 1,
  widthBoost: 0,
  highlighted: false,
  dimmed: false,
};

export function useCircuitCanvas(options: UseCircuitCanvasOptions) {
  const { components, selectedComponentId, routingMode, readonly, onLayoutChange } = options;

  const layoutState = ref<Record<string, LayoutPosition>>({});

  const nextPositionOffset = ref<Record<string, number>>({});

  const canvasContainerRef = ref<HTMLElement | null>(null);
  const canvasOledRef = ref<any>(null);

  const CANVAS_WIDTH = 800;
  const CANVAS_HEIGHT = 580;
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
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let clickCount = 0;

  const boardPosition = ref({ x: boardDescriptor.x, y: boardDescriptor.y });
  const isDraggingBoard = ref(false);
  const boardDragOffset = ref({ x: 0, y: 0 });

  const boardPinOffsets: Record<number, { x: number; y: number }> = {
    12: { x: boardDescriptor.pins[12].x - boardDescriptor.x, y: boardDescriptor.pins[12].y - boardDescriptor.y },
    13: { x: boardDescriptor.pins[13].x - boardDescriptor.x, y: boardDescriptor.pins[13].y - boardDescriptor.y },
    14: { x: boardDescriptor.pins[14].x - boardDescriptor.x, y: boardDescriptor.pins[14].y - boardDescriptor.y },
    21: { x: boardDescriptor.pins[21].x - boardDescriptor.x, y: boardDescriptor.pins[21].y - boardDescriptor.y },
    22: { x: boardDescriptor.pins[22].x - boardDescriptor.x, y: boardDescriptor.pins[22].y - boardDescriptor.y },
  };
  const boardPowerPinOffsets: Record<string, { x: number; y: number }> = {
    'VCC': { x: boardDescriptor.powerPins.VCC.x - boardDescriptor.x, y: boardDescriptor.powerPins.VCC.y - boardDescriptor.y },
    '3V3': { x: boardDescriptor.powerPins['3V3'].x - boardDescriptor.x, y: boardDescriptor.powerPins['3V3'].y - boardDescriptor.y },
    'GND': { x: boardDescriptor.powerPins.GND.x - boardDescriptor.x, y: boardDescriptor.powerPins.GND.y - boardDescriptor.y },
  };

  const commonPowerNodes = ref<Record<string, { x: number; y: number; id: string; label: string; color: string }>>({
    'VCC': { x: 328, y: 80, id: 'common-vcc', label: 'VCC', color: '#ef4444' },
    '3V3': { x: 400, y: 80, id: 'common-3v3', label: '3V3', color: '#22c55e' },
    'GND': { x: 472, y: 80, id: 'common-gnd', label: 'GND', color: '#64748b' },
  });

  const draggedPowerNodeId = ref<string | null>(null);
  const draggedCompId = ref<string | null>(null);
  const dragOffset = ref({ x: 0, y: 0 });
  const componentDragOrigin = ref({ x: 0, y: 0 });
  const isComponentDragging = ref(false);
  const frozenTrackAssignments = ref<Map<string, TrackAssignment> | null>(null);

  watch(routingMode, () => {
    inactiveWireCache.value = {};
  });

  function syncPowerBusLayout(resetPositions = false) {
    const slots = getPowerNodeSlots(boardPosition.value.x, boardPosition.value.y);
    const powerKeys = ['VCC', '3V3', 'GND'] as const;
    for (const key of powerKeys) {
      const node = commonPowerNodes.value[key];
      const pos = slots.positions[key];
      if (!node || !pos) continue;
      node.y = slots.railY;
      if (resetPositions) {
        node.x = pos.x;
      }
    }
  }

  function tidyRouting() {
    wireWaypoints.value = {};
    inactiveWireCache.value = {};
    selectedWireId.value = null;
    syncPowerBusLayout(true);
  }

  function updateCanvasScale() {
    const container = canvasContainerRef.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const containerRatio = rect.width / rect.height;
    const baseRatio = CANVAS_WIDTH / CANVAS_HEIGHT;

    if (containerRatio > baseRatio) {
      viewHeight.value = CANVAS_HEIGHT;
      viewWidth.value = Math.round(CANVAS_HEIGHT * containerRatio);
    }
    else {
      viewWidth.value = CANVAS_WIDTH;
      viewHeight.value = Math.round(CANVAS_WIDTH / containerRatio);
    }

    peripheralScaleX.value = rect.width / viewWidth.value;
    peripheralScaleY.value = rect.height / viewHeight.value;
  }

  function clientToCanvas(clientX: number, clientY: number) {
    const svg = document.querySelector('.circuit-svg');
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) * (viewWidth.value / rect.width);
    const y = (clientY - rect.top) * (viewHeight.value / rect.height);
    return { x, y };
  }

  function assignLayoutForNewComponent(id: string, type: string) {
    if (layoutState.value[id]) return;
    const offset = nextPositionOffset.value[type] || 0;
    const basePos = defaultPositions[type];
    layoutState.value[id] = {
      x: basePos.x + offset * 80,
      y: basePos.y + (offset % 3) * 20,
    };
    nextPositionOffset.value[type] = offset + 1;
  }

  function getLayoutPositions(): Record<string, LayoutPosition> {
    return { ...layoutState.value };
  }

  function setLayoutPositions(positions: Record<string, LayoutPosition>) {
    layoutState.value = { ...positions };
    inactiveWireCache.value = {};
  }

  function removeLayoutForComponent(id: string) {
    delete layoutState.value[id];
  }

  function selectComponent(comp: CircuitComponentInstance) {
    selectedComponentId.value = comp.id;
    selectedWireId.value = null;
  }

  function setRotation(comp: CircuitComponentInstance, deg: number) {
    comp.rotation = deg;
    inactiveWireCache.value = {};
  }

  function rotateComponent(comp: CircuitComponentInstance, delta: number) {
    comp.rotation = (((comp.rotation || 0) + delta) % 360 + 360) % 360;
    inactiveWireCache.value = {};
  }

  function handlePowerNodeClick(event: MouseEvent, powerType: string) {
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = clientToCanvas(event.clientX, event.clientY);
    draggedPowerNodeId.value = powerType;
    wireDragStart.value = { x, y };

    window.addEventListener('mousemove', handlePowerNodeMouseMove);
    window.addEventListener('mouseup', handlePowerNodeMouseUp);
  }

  function handlePowerNodeMouseMove(event: MouseEvent) {
    if (!draggedPowerNodeId.value) return;

    const { x } = clientToCanvas(event.clientX, event.clientY);
    const node = commonPowerNodes.value[draggedPowerNodeId.value];
    const slots = getPowerNodeSlots(boardPosition.value.x, boardPosition.value.y);
    if (node) {
      node.x = Math.max(80, Math.min(viewWidth.value - 80, x));
      node.y = slots.railY;
    }
  }

  function handlePowerNodeMouseUp() {
    if (draggedPowerNodeId.value) {
      const slots = getPowerNodeSlots(boardPosition.value.x, boardPosition.value.y);
      const node = commonPowerNodes.value[draggedPowerNodeId.value];
      if (node) node.y = slots.railY;
    }
    draggedPowerNodeId.value = null;
    window.removeEventListener('mousemove', handlePowerNodeMouseMove);
    window.removeEventListener('mouseup', handlePowerNodeMouseUp);
  }

  function handleWireClick(event: MouseEvent, wireId: string) {
    event.preventDefault();
    event.stopPropagation();

    draggedWireId.value = wireId;

    clickCount++;

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }

    if (clickCount === 2) {
      clickCount = 0;
      selectedWireId.value = selectedWireId.value === wireId ? null : wireId;
      draggedWireId.value = null;
      return;
    }

    clickTimer = setTimeout(() => {
      clickCount = 0;

      const { x: clickX, y: clickY } = clientToCanvas(event.clientX, event.clientY);

      const existingWaypoints = wireWaypoints.value[wireId] || [];
      const waypointThreshold = 12;

      let nearestWaypointIndex = -1;
      let minDistance = waypointThreshold;

      for (let i = 0; i < existingWaypoints.length; i++) {
        const wp = existingWaypoints[i];
        const dx = clickX - wp.x;
        const dy = clickY - wp.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < minDistance) {
          minDistance = dist;
          nearestWaypointIndex = i;
        }
      }

      if (nearestWaypointIndex !== -1) {
        startDragWaypoint(wireId, nearestWaypointIndex);
        return;
      }

      const pts = getWirePointsById(wireId);
      if (pts) {
        const segmentThreshold = 12;
        const nearestSegment = findNearestSegment(clickX, clickY, pts);

        if (nearestSegment && nearestSegment.distance < segmentThreshold) {
          wireDragStart.value = { x: clickX, y: clickY };

          let { startIndex, endIndex } = nearestSegment;
          const waypoints = wireWaypoints.value[wireId] || [];

          if (startIndex === 0 && endIndex === 1 && waypoints.length === 0) {
            const wirePts = getWirePointsById(wireId);
            if (wirePts && wirePts.length >= 2) {
              const p1 = wirePts[0];
              const p2 = wirePts[1];
              waypoints.push({ x: p1.x, y: clickY });
              waypoints.push({ x: clickX, y: p2.y });
              wireWaypoints.value[wireId] = waypoints;
              startIndex = 1;
              endIndex = 2;
            }
          }
          else if (startIndex === 0 && endIndex === 1) {
            startIndex = 1;
            endIndex = 2;
          }

          draggingSegment.value = {
            wireId,
            startIndex,
            endIndex,
            startOffset: nearestSegment.offset,
          };
          window.addEventListener('mousemove', handleWaypointMouseMove);
          window.addEventListener('mouseup', handleWaypointMouseUp);
          return;
        }
      }

      wireDragStart.value = { x: clickX, y: clickY };
      pendingWaypoint.value = { wireId, x: clickX, y: clickY };

      window.addEventListener('mousemove', handleWaypointMouseMove);
      window.addEventListener('mouseup', handleWaypointMouseUp);
    }, 250);
  }

  function getWirePointsById(wireId: string): Point[] | null {
    const [compId, mode] = wireId.split('-');
    const comp = components.value.find(c => c.id === compId);
    if (!comp) return null;

    const pts = getWirePoints(comp, mode as 'primary' | 'secondary' | 'vcc' | 'gnd');
    if (!pts) return null;

    const waypoints = wireWaypoints.value[wireId] || [];
    return [pts.start, ...waypoints, pts.end];
  }

  function findNearestSegment(x: number, y: number, points: Point[]): { startIndex: number; endIndex: number; distance: number; offset: number } | null {
    if (points.length < 2) return null;

    let nearest = null;
    let minDistance = Infinity;

    for (let i = 0; i < points.length - 1; i++) {
      const p1 = points[i];
      const p2 = points[i + 1];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.sqrt(dx * dx + dy * dy);

      if (len === 0) continue;

      const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / (len * len)));
      const projX = p1.x + t * dx;
      const projY = p1.y + t * dy;

      const dist = Math.sqrt((x - projX) ** 2 + (y - projY) ** 2);

      if (dist < minDistance) {
        minDistance = dist;
        nearest = {
          startIndex: i,
          endIndex: i + 1,
          distance: dist,
          offset: t,
        };
      }
    }

    return nearest;
  }

  function startDragWaypoint(wireId: string, index: number) {
    draggingWaypoint.value = { wireId, index };
    draggedWireId.value = wireId;

    window.addEventListener('mousemove', handleWaypointMouseMove);
    window.addEventListener('mouseup', handleWaypointMouseUp);
  }

  function handleWaypointMouseMove(event: MouseEvent) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickCount = 0;
    }

    const { x: currentX, y: currentY } = clientToCanvas(event.clientX, event.clientY);

    const dx = Math.abs(currentX - wireDragStart.value.x);
    const dy = Math.abs(currentY - wireDragStart.value.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (pendingWaypoint.value && distance > dragThreshold) {
      const { wireId, x, y } = pendingWaypoint.value;

      if (!wireWaypoints.value[wireId]) {
        wireWaypoints.value[wireId] = [];
      }

      const index = wireWaypoints.value[wireId].length;
      wireWaypoints.value[wireId].push({ x, y });

      startDragWaypoint(wireId, index);
      pendingWaypoint.value = null;
    }

    if (draggingWaypoint.value) {
      const { wireId, index } = draggingWaypoint.value;

      let x = currentX;
      let y = currentY;

      x = Math.max(10, Math.min(viewWidth.value - 10, x));
      y = Math.max(10, Math.min(viewHeight.value - 10, y));

      x = Math.round(x / 10) * 10;
      y = Math.round(y / 10) * 10;

      if (wireWaypoints.value[wireId] && wireWaypoints.value[wireId][index]) {
        wireWaypoints.value[wireId][index] = { x, y };
      }
    }

    if (draggingSegment.value) {
      const { wireId, startIndex, endIndex } = draggingSegment.value;

      const deltaX = currentX - wireDragStart.value.x;
      const deltaY = currentY - wireDragStart.value.y;

      const waypoints = wireWaypoints.value[wireId] || [];

      if (startIndex > 0 && startIndex <= waypoints.length) {
        waypoints[startIndex - 1] = {
          x: Math.round((waypoints[startIndex - 1].x + deltaX) / 10) * 10,
          y: Math.round((waypoints[startIndex - 1].y + deltaY) / 10) * 10,
        };
      }

      if (endIndex >= 2 && endIndex <= waypoints.length + 1) {
        waypoints[endIndex - 2] = {
          x: Math.round((waypoints[endIndex - 2].x + deltaX) / 10) * 10,
          y: Math.round((waypoints[endIndex - 2].y + deltaY) / 10) * 10,
        };
      }

      wireWaypoints.value[wireId] = waypoints;
      wireDragStart.value = { x: currentX, y: currentY };
    }
  }

  function handleWaypointMouseUp() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickCount = 0;
    }

    if (pendingWaypoint.value && !draggingWaypoint.value) {
      const { wireId } = pendingWaypoint.value;
      if (wireWaypoints.value[wireId] && wireWaypoints.value[wireId].length > 0) {
        wireWaypoints.value[wireId].pop();
      }
      pendingWaypoint.value = null;
    }

    draggingWaypoint.value = null;
    draggingSegment.value = null;
    draggedWireId.value = null;
    inactiveWireCache.value = {};

    window.removeEventListener('mousemove', handleWaypointMouseMove);
    window.removeEventListener('mouseup', handleWaypointMouseUp);
  }

  function handleCanvasClick(event: MouseEvent) {
    const target = event.target as Element;
    if (target.tagName === 'svg' || target.classList.contains('circuit-svg')) {
      selectedWireId.value = null;
    }
  }

  function removeWaypoint(wireId: string, index: number) {
    if (wireWaypoints.value[wireId]) {
      wireWaypoints.value[wireId].splice(index, 1);
    }
  }

  function startDragBoard(event: MouseEvent) {
    if (event.button !== 0) return;
    if (readonly.value) return;
    event.preventDefault();
    event.stopPropagation();

    const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);
    boardDragOffset.value = {
      x: mouseX - boardPosition.value.x,
      y: mouseY - boardPosition.value.y,
    };
    isDraggingBoard.value = true;
    window.addEventListener('mousemove', handleBoardMouseMove);
    window.addEventListener('mouseup', handleBoardMouseUp);
  }

  function handleBoardMouseMove(event: MouseEvent) {
    if (!isDraggingBoard.value) return;

    const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);

    let x = Math.round(mouseX - boardDragOffset.value.x);
    let y = Math.round(mouseY - boardDragOffset.value.y);

    const maxX = viewWidth.value - boardDescriptor.width - 10;
    const maxY = viewHeight.value - boardDescriptor.height - 10;
    x = Math.max(10, Math.min(maxX, x));
    y = Math.max(10, Math.min(maxY, y));

    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;

    boardPosition.value = { x, y };
  }

  function handleBoardMouseUp() {
    isDraggingBoard.value = false;
    syncPowerBusLayout(true);
    window.removeEventListener('mousemove', handleBoardMouseMove);
    window.removeEventListener('mouseup', handleBoardMouseUp);
  }

  function onPeripheralMouseDown(event: MouseEvent, comp: CircuitComponentInstance) {
    if (event.button !== 0) return;

    selectComponent(comp);
    if (readonly.value) return;

    const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);
    componentDragOrigin.value = { x: mouseX, y: mouseY };
    isComponentDragging.value = false;
    draggedCompId.value = comp.id;
    frozenTrackAssignments.value = buildTrackAssignmentMap(
      components.value.flatMap(c =>
        getNetDefinitions(c.type)
          .filter(net => resolveNetConnection(net, c.pinConnections) !== null)
          .map(net => ({
            compId: c.id,
            comp: c,
            mode: net.mode,
            signalType: (net.signalType || 'digital') as 'digital' | 'i2c' | 'power',
          })),
      ),
    );

    dragOffset.value = {
      x: mouseX - getCanvasX(comp),
      y: mouseY - getCanvasY(comp),
    };

    window.addEventListener('mousemove', handleComponentMouseMove);
    window.addEventListener('mouseup', handleComponentMouseUp);
  }

  function handleComponentMouseMove(event: MouseEvent) {
    if (!draggedCompId.value) return;

    const { x: mouseX, y: mouseY } = clientToCanvas(event.clientX, event.clientY);

    if (!isComponentDragging.value) {
      const dx = mouseX - componentDragOrigin.value.x;
      const dy = mouseY - componentDragOrigin.value.y;
      if (Math.sqrt(dx * dx + dy * dy) < dragThreshold) return;
      isComponentDragging.value = true;
    }

    let x = Math.round(mouseX - dragOffset.value.x);
    let y = Math.round(mouseY - dragOffset.value.y);

    const draggedComp = components.value.find(c => c.id === draggedCompId.value);
    const maxX = viewWidth.value - (draggedComp ? getComponentWidth(draggedComp) : 100) - 10;
    const maxY = viewHeight.value - (draggedComp ? getComponentHeight(draggedComp) : 80) - 10;
    x = Math.max(10, Math.min(maxX, x));
    y = Math.max(10, Math.min(maxY, y));

    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;

    if (!layoutState.value[draggedCompId.value]) {
      layoutState.value[draggedCompId.value] = { x: 0, y: 0 };
    }
    layoutState.value[draggedCompId.value] = { x, y };
  }

  function handleComponentMouseUp() {
    const didDrag = isComponentDragging.value;
    draggedCompId.value = null;
    isComponentDragging.value = false;
    frozenTrackAssignments.value = null;
    inactiveWireCache.value = {};
    window.removeEventListener('mousemove', handleComponentMouseMove);
    window.removeEventListener('mouseup', handleComponentMouseUp);
    if (didDrag) {
      onLayoutChange?.();
    }
  }

  function getCanvasX(comp: CircuitComponentInstance): number {
    if (layoutState.value[comp.id]) {
      return layoutState.value[comp.id].x;
    }
    return defaultPositions[comp.type]?.x ?? 50;
  }

  function getCanvasY(comp: CircuitComponentInstance): number {
    if (layoutState.value[comp.id]) {
      return layoutState.value[comp.id].y;
    }
    return defaultPositions[comp.type]?.y ?? 50;
  }

  function getComponentSize(type: string): { width: number; height: number } {
    return peripheralConfigs[type]?.size ?? { width: 80, height: 60 };
  }

  function getComponentWidth(comp: CircuitComponentInstance): number {
    const s = getComponentSize(comp.type);
    const r = comp.rotation || 0;
    return (r === 90 || r === 270) ? s.height : s.width;
  }

  function getComponentHeight(comp: CircuitComponentInstance): number {
    const s = getComponentSize(comp.type);
    const r = comp.rotation || 0;
    return (r === 90 || r === 270) ? s.width : s.height;
  }

  function getComponentObstacle(comp: CircuitComponentInstance): Obstacle {
    const s = getComponentSize(comp.type);
    let minX = 0;
    let minY = 0;
    let maxX = s.width;
    let maxY = s.height;
    const config = peripheralConfigs[comp.type];
    if (config) {
      for (const pin of config.pins) {
        minX = Math.min(minX, pin.relX - 12);
        minY = Math.min(minY, pin.relY - 12);
        maxX = Math.max(maxX, pin.relX + 12);
        maxY = Math.max(maxY, pin.relY + 12);
      }
    }
    const w = maxX - minX;
    const h = maxY - minY;
    const baseX = getCanvasX(comp);
    const baseY = getCanvasY(comp);
    const originX = baseX + minX;
    const originY = baseY + minY;
    const r = comp.rotation || 0;
    if (r === 90 || r === 270) {
      return {
        x: originX + (w - h) / 2,
        y: originY + (h - w) / 2,
        width: h,
        height: w,
      };
    }
    return { x: originX, y: originY, width: w, height: h };
  }

  function getWireColor(comp: CircuitComponentInstance): string {
    if (comp.type === 'led') return '#00ff88';
    if (comp.type === 'button') return '#38bdf8';
    if (comp.type === 'oled') return '#a855f7';
    if (comp.type === 'ultrasonic') return '#eab308';
    return '#ffffff';
  }

  function getPinPosition(pin: number): { x: number; y: number } {
    const offset = boardPinOffsets[pin];
    if (offset) {
      return { x: boardPosition.value.x + offset.x, y: boardPosition.value.y + offset.y };
    }
    return { x: boardPosition.value.x + 7, y: boardPosition.value.y + 122 };
  }

  function getPowerPinPosition(powerType: string): { x: number; y: number } {
    const offset = boardPowerPinOffsets[powerType];
    if (offset) {
      return { x: boardPosition.value.x + offset.x, y: boardPosition.value.y + offset.y };
    }
    return { x: boardPosition.value.x + 7, y: boardPosition.value.y + 122 };
  }

  function getComponentBounds(comp: CircuitComponentInstance) {
    const obs = getComponentObstacle(comp);
    return resolveBoardBounds({ x: obs.x, y: obs.y }, obs.width, obs.height);
  }

  function resolveWireStartDir(
    comp: CircuitComponentInstance,
    pinName: string,
  ): 'left' | 'right' | 'up' | 'down' {
    const pin = getPeripheralPinPosition(comp, pinName);
    return resolvePeripheralPinStartDir(pin, getComponentBounds(comp));
  }

  function resolveWireEndDir(end: { x: number; y: number }): 'left' | 'right' | 'up' | 'down' {
    const bounds = resolveBoardBounds(
      { x: boardPosition.value.x, y: boardPosition.value.y },
      boardDescriptor.width,
      boardDescriptor.height,
    );
    return resolveBoardPinEndDir(end, bounds);
  }

  function buildWireRouteRequests(
    requests: Array<{
      compId: string;
      comp: CircuitComponentInstance;
      mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
      signalType: 'digital' | 'i2c' | 'power';
    }>,
  ): WireRouteRequest[] {
    const priorityOrder: Record<string, number> = { power: 0, i2c: 1, digital: 2 };
    const boardCenterX = boardPosition.value.x + boardDescriptor.width / 2;
    const routeRequests: WireRouteRequest[] = [];

    for (const req of requests) {
      const netDef = getNetDefinitions(req.comp.type).find(n => n.mode === req.mode);
      if (!netDef) continue;
      const pts = getWirePoints(req.comp, req.mode);
      if (!pts) continue;

      const startLeft = pts.start.x <= boardCenterX;
      const endLeft = pts.end.x <= boardCenterX;
      let channel: RoutingChannel;
      if (startLeft && endLeft) channel = 'left';
      else if (!startLeft && !endLeft) channel = 'right';
      else channel = 'cross';

      const wireId = `${req.compId}-${req.mode}`;
      const bundleId
        = req.signalType === 'i2c' && (req.mode === 'primary' || req.mode === 'secondary')
          ? `${req.compId}-i2c`
          : undefined;

      routeRequests.push({
        wireId,
        start: pts.start,
        end: pts.end,
        startDir: resolveWireStartDir(req.comp, pts.pinName),
        endDir: resolveWireEndDir(pts.end),
        priority: priorityOrder[req.signalType],
        channel,
        signalType: req.signalType,
        compId: req.compId,
        bundleId,
      });
    }

    return routeRequests;
  }

  function buildTrackAssignmentMap(
    requests: Array<{
      compId: string;
      comp: CircuitComponentInstance;
      mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
      signalType: 'digital' | 'i2c' | 'power';
    }>,
  ): Map<string, TrackAssignment> {
    const boardOrigin = { x: boardPosition.value.x, y: boardPosition.value.y };
    const channels = getRoutingChannels(boardOrigin.x, boardOrigin.y);
    const boardCenterX = boardOrigin.x + boardDescriptor.width / 2;
    const boardCenterY = boardOrigin.y + boardDescriptor.height / 2;
    const routeRequests = buildWireRouteRequests(requests);
    return buildTrackAssignments(routeRequests, channels, boardCenterX, boardCenterY);
  }

  function getPeripheralPinPosition(comp: CircuitComponentInstance, pinName: string): { x: number; y: number } {
    const baseX = getCanvasX(comp);
    const baseY = getCanvasY(comp);
    const config = peripheralConfigs[comp.type];
    const pinDef = config?.pins.find(p => p.name === pinName);
    const offsetX = pinDef ? pinDef.relX : 0;
    const offsetY = pinDef ? pinDef.relY : 0;

    const rotation = comp.rotation || 0;
    if (rotation === 0) {
      return { x: baseX + offsetX, y: baseY + offsetY };
    }
    const W = getComponentSize(comp.type).width;
    const H = getComponentSize(comp.type).height;
    const rotated = rotatePinOffset(offsetX, offsetY, W, H, rotation);
    return { x: baseX + rotated.x, y: baseY + rotated.y };
  }

  function applyGpioFanout(
    pos: { x: number; y: number },
    fanout?: { index: number; total: number },
  ): { x: number; y: number } {
    if (!fanout || fanout.total <= 1) return pos;
    const spread = 10;
    const offset = (fanout.index - (fanout.total - 1) / 2) * spread;
    return { x: pos.x, y: pos.y + offset };
  }

  function resolveWireEndForConnection(
    connection: PinConnectionValue,
    fanout?: { index: number; total: number },
  ): { x: number; y: number } | null {
    if (typeof connection === 'number') {
      return applyGpioFanout(getPinPosition(connection), fanout);
    }
    if (connection === 'VCC' || connection === '3V3' || connection === 'GND') {
      const commonNode = commonPowerNodes.value[connection];
      if (commonNode) {
        return { x: commonNode.x, y: commonNode.y };
      }
      return getPowerPinPosition(connection);
    }
    return null;
  }

  function resolveNetPinForComp(
    comp: CircuitComponentInstance,
    netDef: NetDefinition,
    fanout?: { index: number; total: number },
  ): { pinName: string; connection: PinConnectionValue } | null {
    const connection = resolveNetConnection(netDef, comp.pinConnections);
    if (connection === null || connection === undefined) return null;

    const end = resolveWireEndForConnection(connection, fanout);
    if (!end) return null;

    const pinName = resolveNetPin(netDef, {
      pinConnections: comp.pinConnections,
      getPinPosition: name => getPeripheralPinPosition(comp, name),
      targetPosition: end,
    });
    if (!pinName) return null;

    return { pinName, connection };
  }

  function getWirePoints(
    comp: CircuitComponentInstance,
    mode: 'primary' | 'secondary' | 'vcc' | 'gnd',
    fanout?: { index: number; total: number },
  ): { start: { x: number; y: number }; end: { x: number; y: number }; pinName: string } | null {
    const netDef = getNetDefinitions(comp.type).find(n => n.mode === mode);
    if (!netDef) return null;

    const resolved = resolveNetPinForComp(comp, netDef, fanout);
    if (!resolved) return null;

    const end = resolveWireEndForConnection(resolved.connection, fanout);
    if (!end) return null;

    return {
      start: getPeripheralPinPosition(comp, resolved.pinName),
      end,
      pinName: resolved.pinName,
    };
  }

  function buildGpioFanoutMap(requests: Array<{ compId: string; comp: CircuitComponentInstance; mode: 'primary' | 'secondary' | 'vcc' | 'gnd' }>): Map<string, { index: number; total: number }> {
    const groups = new Map<number, string[]>();

    for (const req of requests) {
      const netDef = getNetDefinitions(req.comp.type).find(n => n.mode === req.mode);
      if (!netDef) continue;
      const conn = resolveNetConnection(netDef, req.comp.pinConnections);
      if (typeof conn !== 'number') continue;
      const wireId = `${req.compId}-${req.mode}`;
      if (!groups.has(conn)) groups.set(conn, []);
      groups.get(conn)!.push(wireId);
    }

    const fanoutMap = new Map<string, { index: number; total: number }>();
    for (const ids of groups.values()) {
      ids.sort();
      ids.forEach((id, index) => fanoutMap.set(id, { index, total: ids.length }));
    }
    return fanoutMap;
  }

  function isWireRelatedToSelectedComp(wire: WireRenderItem, sel: string | null): boolean {
    if (!sel) return false;

    if (wire.compId === sel) return true;

    if (wire.id.startsWith('common-')) {
      const powerType = wire.id.slice('common-'.length);
      const comp = components.value.find(c => c.id === sel);
      if (!comp) return false;
      return Object.values(comp.pinConnections).includes(powerType as PinConnectionValue);
    }

    return false;
  }

  function buildActiveNetRequests(): NetRequest[] {
    const requests: NetRequest[] = [];

    components.value.forEach((comp) => {
      getNetDefinitions(comp.type).forEach((net) => {
        if (resolveNetConnection(net, comp.pinConnections) === null) {
          return;
        }

        let color = '#94a3b8';
        if (net.mode === 'vcc') {
          color = '#ef4444';
        }
        else if (net.mode === 'gnd') {
          color = '#64748b';
        }
        else if (net.mode === 'secondary') {
          color = comp.type === 'oled' ? '#a78bfa' : '#f59e0b';
        }
        else {
          color = getWireColor(comp);
        }

        requests.push({
          compId: comp.id,
          comp,
          mode: net.mode,
          color,
          signalType: net.signalType || 'digital',
        });
      });
    });

    return requests;
  }

  function buildWireVisual(wire: WireRenderItem, sel: string | null, activeWireId: string | null): WireVisualState {
    if (activeWireId === wire.id || wire.isDragged) {
      return DEFAULT_WIRE_VISUAL;
    }
    if (!sel) {
      return DEFAULT_WIRE_VISUAL;
    }
    if (isWireRelatedToSelectedComp(wire, sel)) {
      return { opacity: 1, widthBoost: 1.2, highlighted: true, dimmed: false };
    }
    return { opacity: 0.12, widthBoost: 0, highlighted: false, dimmed: true };
  }

  function getWirePCBPath(
    comp: CircuitComponentInstance,
    mode: 'primary' | 'secondary' | 'vcc' | 'gnd' = 'primary',
    assignment: TrackAssignment,
    obstacles?: Obstacle[],
    occupancy?: SegmentOccupancyRegistry,
    waypoints?: Point[],
    fanout?: { index: number; total: number },
  ): WirePathResult | null {
    const boardOrigin = { x: boardPosition.value.x, y: boardPosition.value.y };
    const channels = getRoutingChannels(boardOrigin.x, boardOrigin.y);
    const pts = getWirePoints(comp, mode, fanout);
    if (!pts) return null;

    const netDef = getNetDefinitions(comp.type).find(n => n.mode === mode);
    const resolved = netDef ? resolveNetPinForComp(comp, netDef, fanout) : null;
    const pinName = resolved?.pinName || pts.pinName;
    const connection = resolved?.connection ?? null;
    const signalType = netDef?.signalType || 'digital';
    const wireId = `${comp.id}-${mode}`;

    const startDir = resolveWireStartDir(comp, pinName);
    const endDir = resolveWireEndDir(pts.end);

    const isPowerToBus
      = (netDef?.mode === 'vcc' || netDef?.mode === 'gnd' || signalType === 'power')
        && typeof connection === 'string'
        && (connection === 'VCC' || connection === '3V3' || connection === 'GND')
        && !(waypoints && waypoints.length > 0);

    if (isPowerToBus) {
      return generatePowerBusTapPath(
        pts.start,
        pts.end,
        channels.powerRailY,
        startDir,
        getComponentObstacle(comp),
      );
    }

    return generateWirePath({
      start: pts.start,
      end: pts.end,
      startDir,
      endDir,
      wireId,
      signalType: signalType as 'digital' | 'i2c' | 'power',
      assignment,
      obstacles: obstacles ?? [],
      occupancy: occupancy ?? new SegmentOccupancyRegistry(),
      waypoints,
      boardOrigin,
      boardCenterX: boardOrigin.x + boardDescriptor.width / 2,
      lane: 0,
    });
  }

  const wiresToRender = computed(() => {
    const obstacles: Obstacle[] = [
      { x: boardPosition.value.x, y: boardPosition.value.y, width: boardDescriptor.width, height: boardDescriptor.height },
    ];
    components.value.forEach((comp) => {
      obstacles.push(getComponentObstacle(comp));
    });

    const requests = buildActiveNetRequests();

    for (const [, node] of Object.entries(commonPowerNodes.value)) {
      obstacles.push({
        x: node.x - 20,
        y: node.y - 20,
        width: 40,
        height: 40,
      });
    }

    const priorityOrder = { power: 0, i2c: 1, digital: 2 };
    const gpioFanoutMap = buildGpioFanoutMap(requests);
    const boardOrigin = { x: boardPosition.value.x, y: boardPosition.value.y };
    const channels = getRoutingChannels(boardOrigin.x, boardOrigin.y);

    let trackAssignments: Map<string, TrackAssignment>;
    if (isComponentDragging.value) {
      if (!frozenTrackAssignments.value) {
        frozenTrackAssignments.value = buildTrackAssignmentMap(requests);
      }
      trackAssignments = frozenTrackAssignments.value;
    }
    else {
      trackAssignments = buildTrackAssignmentMap(requests);
    }

    requests.sort((a, b) => {
      const aId = `${a.compId}-${a.mode}`;
      const bId = `${b.compId}-${b.mode}`;

      if (draggedWireId.value) {
        if (aId === draggedWireId.value) return -1;
        if (bId === draggedWireId.value) return 1;
      }

      return priorityOrder[a.signalType] - priorityOrder[b.signalType];
    });

    const list: WireRenderItem[] = [];

    const segmentOccupancy = new SegmentOccupancyRegistry();

    for (const [powerType, node] of Object.entries(commonPowerNodes.value)) {
      const wireId = `common-${powerType}`;
      const boardPowerPos = getPowerPinPosition(powerType);

      const result = generatePowerBusTrunkPath(
        { x: node.x, y: node.y },
        boardPowerPos,
        channels.powerRailY,
        { x: boardPosition.value.x, y: boardPosition.value.y },
        boardDescriptor.width,
      );

      list.push({
        id: wireId,
        path: result.path,
        color: node.color,
        start: { x: node.x, y: node.y },
        end: boardPowerPos,
        width: result.width,
        segments: result.segments,
        vias: result.vias,
        teardrops: result.teardrops,
        signalType: 'power',
        isActive: true,
        isDragged: false,
      });
    }

    requests.forEach((req) => {
      const wireId = `${req.compId}-${req.mode}`;
      const fanout = gpioFanoutMap.get(wireId);
      const pts = getWirePoints(req.comp, req.mode, fanout);
      if (!pts) return;

      const waypoints = wireWaypoints.value[wireId] || [];
      const assignment = trackAssignments.get(wireId) ?? {
        wireId,
        topology: 'cross-side',
        priority: priorityOrder[req.signalType],
        stubLengthStart: 18,
        stubLengthEnd: 18,
      };

      const isDragged = wireId === draggedWireId.value;
      const isActive = !(routingMode.value === 'manual' && draggedWireId.value && wireId !== draggedWireId.value);

      let pcbResult: WirePathResult | null = null;

      if (isDragged) {
        const cachedWire = inactiveWireCache.value[wireId];
        if (cachedWire) {
          list.push({ ...cachedWire, isActive: true, isDragged: true });
          return;
        }
      }

      if (isActive) {
        pcbResult = getWirePCBPath(req.comp, req.mode, assignment, obstacles, segmentOccupancy, waypoints, fanout);
        if (pcbResult) {
          inactiveWireCache.value[wireId] = {
            id: wireId,
            path: pcbResult.path,
            color: req.color,
            start: pts.start,
            end: pts.end,
            width: pcbResult.width,
            segments: pcbResult.segments,
            vias: pcbResult.vias,
            teardrops: pcbResult.teardrops,
            signalType: req.signalType,
            compId: req.compId,
            isActive: true,
            isDragged: false,
          };
        }
      }
      else {
        const cachedWire = inactiveWireCache.value[wireId];
        if (cachedWire) {
          list.push({ ...cachedWire, isActive: false, isDragged: false });
          return;
        }
        pcbResult = getWirePCBPath(req.comp, req.mode, assignment, obstacles, undefined, waypoints, fanout);
        if (pcbResult) {
          inactiveWireCache.value[wireId] = {
            id: wireId,
            path: pcbResult.path,
            color: req.color,
            start: pts.start,
            end: pts.end,
            width: pcbResult.width,
            segments: pcbResult.segments,
            vias: pcbResult.vias,
            teardrops: pcbResult.teardrops,
            signalType: req.signalType,
            compId: req.compId,
            isActive: false,
            isDragged: false,
          };
        }
      }

      if (!pcbResult) return;

      list.push({
        id: wireId,
        path: pcbResult.path,
        color: req.color,
        start: pts.start,
        end: pts.end,
        width: pcbResult.width,
        segments: pcbResult.segments,
        vias: pcbResult.vias,
        teardrops: pcbResult.teardrops,
        signalType: req.signalType,
        compId: req.compId,
        isActive,
        isDragged,
      });
    });

    return list;
  });

  const routingChannels = computed(() =>
    getRoutingChannels(boardPosition.value.x, boardPosition.value.y),
  );

  const routingDebugEnabled = computed(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('routing_debug') === 'true';
  });

  const routingDebugOverlay = computed(() => {
    if (!routingDebugEnabled.value) return null;

    const requests = buildActiveNetRequests();
    const assignments = buildTrackAssignmentMap(requests);
    const channels = routingChannels.value;
    const gpioFanoutMap = buildGpioFanoutMap(requests);
    const priorityOrder = { power: 0, i2c: 1, digital: 2 };

    const obstacles: Obstacle[] = [
      { x: boardPosition.value.x, y: boardPosition.value.y, width: boardDescriptor.width, height: boardDescriptor.height },
    ];
    components.value.forEach(comp => obstacles.push(getComponentObstacle(comp)));

    const verticalTracks: Array<{ x1: number; y1: number; x2: number; y2: number; stroke: string }> = [];
    const horizontalTracks: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
    const labels: Array<{ wireId: string; topology: string; x: number; y: number }> = [];
    const seenVertical = new Set<number>();
    const seenHorizontal = new Set<number>();

    for (const [wireId, assignment] of assignments) {
      if (assignment.verticalTrackX !== undefined && !seenVertical.has(assignment.verticalTrackX)) {
        seenVertical.add(assignment.verticalTrackX);
        verticalTracks.push({
          x1: assignment.verticalTrackX,
          y1: channels.topBus,
          x2: assignment.verticalTrackX,
          y2: channels.bottomBus,
          stroke: '#38bdf8',
        });
      }
      if (assignment.exitTrackX !== undefined && !seenVertical.has(assignment.exitTrackX)) {
        seenVertical.add(assignment.exitTrackX);
        verticalTracks.push({
          x1: assignment.exitTrackX,
          y1: channels.topBus,
          x2: assignment.exitTrackX,
          y2: channels.bottomBus,
          stroke: '#60a5fa',
        });
      }
      if (assignment.horizontalTrackY !== undefined && !seenHorizontal.has(assignment.horizontalTrackY)) {
        seenHorizontal.add(assignment.horizontalTrackY);
        horizontalTracks.push({
          x1: channels.leftBus - 40,
          y1: assignment.horizontalTrackY,
          x2: channels.rightBus + 40,
          y2: assignment.horizontalTrackY,
        });
      }

      const req = requests.find(r => `${r.compId}-${r.mode}` === wireId);
      const pts = req ? getWirePoints(req.comp, req.mode, gpioFanoutMap.get(wireId)) : null;
      labels.push({
        wireId,
        topology: assignment.topology,
        x: (pts?.start.x ?? assignment.verticalTrackX ?? channels.leftBus) + 4,
        y: (pts?.start.y ?? assignment.horizontalTrackY ?? channels.topBus) - 6,
      });
    }

    const segmentOccupancy = new SegmentOccupancyRegistry();
    const sortedRequests = [...requests].sort(
      (a, b) => priorityOrder[a.signalType] - priorityOrder[b.signalType],
    );
    for (const req of sortedRequests) {
      const wireId = `${req.compId}-${req.mode}`;
      const assignment = assignments.get(wireId);
      if (!assignment) continue;
      getWirePCBPath(
        req.comp,
        req.mode,
        assignment,
        obstacles,
        segmentOccupancy,
        undefined,
        gpioFanoutMap.get(wireId),
      );
    }

    const occupiedRects = segmentOccupancy.getSegments().map((seg) => {
      if (seg.orientation === 'v') {
        const lo = Math.min(seg.rangeStart, seg.rangeEnd);
        const hi = Math.max(seg.rangeStart, seg.rangeEnd);
        return { x: seg.fixed - 2, y: lo, width: 4, height: hi - lo, wireId: seg.wireId };
      }
      const lo = Math.min(seg.rangeStart, seg.rangeEnd);
      const hi = Math.max(seg.rangeStart, seg.rangeEnd);
      return { x: lo, y: seg.fixed - 2, width: hi - lo, height: 4, wireId: seg.wireId };
    });

    return { verticalTracks, horizontalTracks, labels, occupiedRects };
  });

  const powerBusVisual = computed(() => {
    const nodes = Object.values(commonPowerNodes.value);
    const railY = routingChannels.value.powerRailY;
    if (nodes.length === 0) {
      return { x1: 280, x2: 520, y: railY };
    }
    const xs = nodes.map(n => n.x);
    return {
      x1: Math.min(...xs) - 50,
      x2: Math.max(...xs) + 50,
      y: railY,
    };
  });

  const wireVisualMap = computed(() => {
    const sel = selectedComponentId.value;
    const activeWireId = selectedWireId.value;
    const map = new Map<string, WireVisualState>();
    for (const wire of wiresToRender.value) {
      map.set(wire.id, buildWireVisual(wire, sel, activeWireId));
    }
    return map;
  });

  function getWireVisual(wire: WireRenderItem): WireVisualState {
    return wireVisualMap.value.get(wire.id) ?? DEFAULT_WIRE_VISUAL;
  }

  function clearInactiveWireCache() {
    inactiveWireCache.value = {};
  }

  return {
    canvasContainerRef,
    canvasOledRef,
    viewWidth,
    viewHeight,
    peripheralScaleX,
    peripheralScaleY,
    boardPosition,
    isDraggingBoard,
    commonPowerNodes,
    draggedPowerNodeId,
    draggedCompId,
    isComponentDragging,
    wireWaypoints,
    selectedWireId,
    wiresToRender,
    routingChannels,
    routingDebugOverlay,
    powerBusVisual,
    syncPowerBusLayout,
    tidyRouting,
    updateCanvasScale,
    assignLayoutForNewComponent,
    removeLayoutForComponent,
    getLayoutPositions,
    setLayoutPositions,
    selectComponent,
    setRotation,
    rotateComponent,
    handlePowerNodeClick,
    handleWireClick,
    handleCanvasClick,
    startDragBoard,
    onPeripheralMouseDown,
    removeWaypoint,
    startDragWaypoint,
    getCanvasX,
    getCanvasY,
    getComponentSize,
    getWireVisual,
    clearInactiveWireCache,
  };
}
