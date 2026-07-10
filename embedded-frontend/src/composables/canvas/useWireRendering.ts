import { computed } from 'vue';
import '@/peripherals';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  Obstacle,
  WirePathResult,
  NetDefinition,
  PinConnectionValue,
} from '@/types/peripheral-pins';
import { peripheralConfigsAdapter } from '@/peripherals';
import {
  getNetDefinitions,
  boardDescriptor,
  generatePowerBusTapPath,
  generatePowerBusTrunkPath,
  getRoutingChannels,
  rotatePinOffset,
} from '@/types/peripheral-pins';
import { resolveBoardBounds, resolveBoardPinEndDir, resolvePeripheralPinStartDir } from '@/routing/geometry';
import { resolveNetConnection, resolveNetPin } from '@/routing/net-pin-resolver';
import { SegmentOccupancyRegistry } from '@/routing/segment-occupancy';
import { buildTrackAssignments } from '@/routing/track-allocator';
import { generateWirePath } from '@/routing/wire-routing';
import type { RoutingChannel, TrackAssignment, WireRouteRequest } from '@/routing/types';
import { isPowerConnection } from '@/constants/power-rail';
import { DEFAULT_WIRE_VISUAL } from './constants';
import type { CanvasContext, NetRequest, Point, WireRenderItem, WireVisualState } from './types';
import type { CanvasLayout } from './useCanvasLayout';

export function useWireRendering(
  ctx: CanvasContext,
  layout: Pick<CanvasLayout, 'getCanvasX' | 'getCanvasY' | 'getComponentSize' | 'getComponentObstacle'>,
) {
  function getWireColor(comp: CircuitComponentInstance): string {
    return registry.getWireColor(comp.type);
  }

  function getPinPosition(pin: number): { x: number; y: number } {
    const offset = ctx.boardPinOffsets[pin];
    if (offset) {
      return { x: ctx.boardPosition.value.x + offset.x, y: ctx.boardPosition.value.y + offset.y };
    }
    return { x: ctx.boardPosition.value.x + 7, y: ctx.boardPosition.value.y + 122 };
  }

  function getPowerPinPosition(powerType: string): { x: number; y: number } {
    const offset = ctx.boardPowerPinOffsets[powerType];
    if (offset) {
      return { x: ctx.boardPosition.value.x + offset.x, y: ctx.boardPosition.value.y + offset.y };
    }
    return { x: ctx.boardPosition.value.x + 7, y: ctx.boardPosition.value.y + 122 };
  }

  function getComponentBounds(comp: CircuitComponentInstance) {
    const obs = layout.getComponentObstacle(comp);
    return resolveBoardBounds({ x: obs.x, y: obs.y }, obs.width, obs.height);
  }

  function getPeripheralPinPosition(comp: CircuitComponentInstance, pinName: string): { x: number; y: number } {
    const baseX = layout.getCanvasX(comp);
    const baseY = layout.getCanvasY(comp);
    const config = peripheralConfigsAdapter[comp.type];
    const pinDef = config?.pins.find(p => p.name === pinName);
    const offsetX = pinDef ? pinDef.relX : 0;
    const offsetY = pinDef ? pinDef.relY : 0;

    const rotation = comp.rotation || 0;
    if (rotation === 0) {
      return { x: baseX + offsetX, y: baseY + offsetY };
    }
    const W = layout.getComponentSize(comp.type).width;
    const H = layout.getComponentSize(comp.type).height;
    const rotated = rotatePinOffset(offsetX, offsetY, W, H, rotation);
    return { x: baseX + rotated.x, y: baseY + rotated.y };
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
      { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y },
      boardDescriptor.width,
      boardDescriptor.height,
    );
    return resolveBoardPinEndDir(end, bounds);
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
    if (isPowerConnection(connection)) {
      const commonNode = ctx.commonPowerNodes.value[connection];
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

  function buildWireRouteRequests(
    requests: Array<{
      compId: string;
      comp: CircuitComponentInstance;
      mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
      signalType: 'digital' | 'i2c' | 'power';
    }>,
  ): WireRouteRequest[] {
    const priorityOrder: Record<string, number> = { power: 0, i2c: 1, digital: 2 };
    const boardCenterX = ctx.boardPosition.value.x + boardDescriptor.width / 2;
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
    const boardOrigin = { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y };
    const channels = getRoutingChannels(boardOrigin.x, boardOrigin.y);
    const boardCenterX = boardOrigin.x + boardDescriptor.width / 2;
    const boardCenterY = boardOrigin.y + boardDescriptor.height / 2;
    const routeRequests = buildWireRouteRequests(requests);
    return buildTrackAssignments(routeRequests, channels, boardCenterX, boardCenterY);
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
      const comp = ctx.components.value.find(c => c.id === sel);
      if (!comp) return false;
      return Object.values(comp.pinConnections).includes(powerType as PinConnectionValue);
    }

    return false;
  }

  function buildActiveNetRequests(): NetRequest[] {
    const requests: NetRequest[] = [];

    ctx.components.value.forEach((comp) => {
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

  function buildWireVisual(wire: WireRenderItem, sel: string | null): WireVisualState {
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
    const boardOrigin = { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y };
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
        && isPowerConnection(connection)
        && !(waypoints && waypoints.length > 0);

    if (isPowerToBus) {
      return generatePowerBusTapPath(
        pts.start,
        pts.end,
        channels.powerRailY,
        startDir,
        layout.getComponentObstacle(comp),
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
      { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y, width: boardDescriptor.width, height: boardDescriptor.height },
    ];
    ctx.components.value.forEach((comp) => {
      obstacles.push(layout.getComponentObstacle(comp));
    });

    const requests = buildActiveNetRequests();

    for (const [, node] of Object.entries(ctx.commonPowerNodes.value)) {
      obstacles.push({
        x: node.x - 20,
        y: node.y - 20,
        width: 40,
        height: 40,
      });
    }

    const priorityOrder = { power: 0, i2c: 1, digital: 2 };
    const gpioFanoutMap = buildGpioFanoutMap(requests);
    const boardOrigin = { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y };
    const channels = getRoutingChannels(boardOrigin.x, boardOrigin.y);

    let trackAssignments: Map<string, TrackAssignment>;
    if (ctx.isComponentDragging.value) {
      if (!ctx.frozenTrackAssignments.value) {
        ctx.frozenTrackAssignments.value = buildTrackAssignmentMap(requests);
      }
      trackAssignments = ctx.frozenTrackAssignments.value;
    }
    else {
      trackAssignments = buildTrackAssignmentMap(requests);
    }

    requests.sort((a, b) =>
      priorityOrder[a.signalType] - priorityOrder[b.signalType],
    );

    const list: WireRenderItem[] = [];

    const segmentOccupancy = new SegmentOccupancyRegistry();

    for (const [powerType, node] of Object.entries(ctx.commonPowerNodes.value)) {
      const wireId = `common-${powerType}`;
      const boardPowerPos = getPowerPinPosition(powerType);

      const result = generatePowerBusTrunkPath(
        { x: node.x, y: node.y },
        boardPowerPos,
        channels.powerRailY,
        { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y },
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
      });
    }

    requests.forEach((req) => {
      const wireId = `${req.compId}-${req.mode}`;
      const fanout = gpioFanoutMap.get(wireId);
      const pts = getWirePoints(req.comp, req.mode, fanout);
      if (!pts) return;

      const assignment = trackAssignments.get(wireId) ?? {
        wireId,
        topology: 'cross-side',
        priority: priorityOrder[req.signalType],
        stubLengthStart: 18,
        stubLengthEnd: 18,
      };

      const pcbResult = getWirePCBPath(req.comp, req.mode, assignment, obstacles, segmentOccupancy, undefined, fanout);
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
      });
    });

    return list;
  });

  const routingChannels = computed(() =>
    getRoutingChannels(ctx.boardPosition.value.x, ctx.boardPosition.value.y),
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
      { x: ctx.boardPosition.value.x, y: ctx.boardPosition.value.y, width: boardDescriptor.width, height: boardDescriptor.height },
    ];
    ctx.components.value.forEach(comp => obstacles.push(layout.getComponentObstacle(comp)));

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
    const nodes = Object.values(ctx.commonPowerNodes.value);
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
    const sel = ctx.selectedComponentId.value;
    const map = new Map<string, WireVisualState>();
    for (const wire of wiresToRender.value) {
      map.set(wire.id, buildWireVisual(wire, sel));
    }
    return map;
  });

  function getWireVisual(wire: WireRenderItem): WireVisualState {
    return wireVisualMap.value.get(wire.id) ?? DEFAULT_WIRE_VISUAL;
  }

  return {
    wiresToRender,
    routingChannels,
    routingDebugOverlay,
    powerBusVisual,
    getWireVisual,
    buildTrackAssignmentMap,
  };
}
