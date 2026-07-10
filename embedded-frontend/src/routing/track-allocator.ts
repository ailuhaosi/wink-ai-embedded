import { I2C_BUNDLE_GAP, STUB_BASE, STUB_LANE_STEP, TRACK_SPACING } from './constants';
import { snapTrackCoord } from './geometry';
import type {
  RoutingChannel,
  RoutingChannels,
  TrackAssignment,
  WireRouteRequest,
  WireTopology,
} from './types';

const CHANNEL_ORDER: Record<RoutingChannel, number> = { left: 0, cross: 1, right: 2 };

function classifyChannel(startX: number, endX: number, boardCenterX: number): RoutingChannel {
  const startLeft = startX <= boardCenterX;
  const endLeft = endX <= boardCenterX;
  if (startLeft && endLeft) return 'left';
  if (!startLeft && !endLeft) return 'right';
  return 'cross';
}

function classifyWireTopology(
  request: WireRouteRequest,
  boardCenterX: number,
): WireTopology {
  if (request.signalType === 'power') {
    return 'power-tap';
  }
  const startLeft = request.start.x <= boardCenterX;
  const endLeft = request.end.x <= boardCenterX;
  if (startLeft === endLeft) {
    return 'same-side';
  }
  return 'cross-side';
}

interface BucketEntry extends WireRouteRequest {
  channel: RoutingChannel;
  topology: WireTopology;
  bundleOrder: number;
}

export function buildTrackAssignments(
  requests: WireRouteRequest[],
  channels: RoutingChannels,
  boardCenterX: number,
  boardCenterY: number,
): Map<string, TrackAssignment> {
  const entries: BucketEntry[] = requests.map((request, index) => ({
    ...request,
    channel: request.channel ?? classifyChannel(request.start.x, request.end.x, boardCenterX),
    topology: classifyWireTopology(request, boardCenterX),
    bundleOrder: index,
  }));

  entries.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    if (a.channel !== b.channel) return CHANNEL_ORDER[a.channel] - CHANNEL_ORDER[b.channel];
    const sortYA = (a.start.y + a.end.y) / 2;
    const sortYB = (b.start.y + b.end.y) / 2;
    if (sortYA !== sortYB) return sortYA - sortYB;
    return a.bundleOrder - b.bundleOrder;
  });

  const laneCounters = new Map<RoutingChannel, number>();
  const bundleLaneConsumed = new Set<string>();
  const assignments = new Map<string, TrackAssignment>();

  for (const entry of entries) {
    if (entry.bundleId && bundleLaneConsumed.has(entry.bundleId)) {
      continue;
    }

    const lane = laneCounters.get(entry.channel) ?? 0;
    if (entry.bundleId) {
      bundleLaneConsumed.add(entry.bundleId);
    }
    else {
      laneCounters.set(entry.channel, lane + 1);
    }

    const stubLengthStart = STUB_BASE + lane * STUB_LANE_STEP;
    const stubLengthEnd = STUB_BASE + lane * STUB_LANE_STEP;

    if (entry.bundleId && entry.signalType === 'i2c') {
      const bundlePeers = entries.filter(e => e.bundleId === entry.bundleId);
      bundlePeers.forEach((peer, bundleOffset) => {
        const assignment = createAssignment(
          peer,
          lane,
          channels,
          boardCenterX,
          boardCenterY,
          stubLengthStart,
          stubLengthEnd,
          bundleOffset,
          entry.bundleId,
        );
        assignments.set(peer.wireId, assignment);
      });
      laneCounters.set(entry.channel, lane + 1);
      continue;
    }

    assignments.set(
      entry.wireId,
      createAssignment(
        entry,
        lane,
        channels,
        boardCenterX,
        boardCenterY,
        stubLengthStart,
        stubLengthEnd,
      ),
    );
  }

  return assignments;
}

function createAssignment(
  entry: BucketEntry,
  lane: number,
  channels: RoutingChannels,
  boardCenterX: number,
  boardCenterY: number,
  stubLengthStart: number,
  stubLengthEnd: number,
  bundleOffset = 0,
  bundleId?: string,
): TrackAssignment {
  const gap = bundleOffset * I2C_BUNDLE_GAP;
  const assignment: TrackAssignment = {
    wireId: entry.wireId,
    topology: entry.topology,
    priority: entry.priority,
    bundleId,
    bundleOffset: bundleOffset || undefined,
    stubLengthStart,
    stubLengthEnd,
  };

  if (entry.channel === 'left') {
    assignment.verticalTrackX = snapTrackCoord(channels.leftBus - lane * TRACK_SPACING - gap);
  }
  else if (entry.channel === 'right') {
    assignment.verticalTrackX = snapTrackCoord(channels.rightBus + lane * TRACK_SPACING + gap);
  }
  else {
    const startAbove = entry.start.y < boardCenterY;
    const bypassBase = startAbove
      ? channels.topBus - lane * TRACK_SPACING
      : channels.bottomBus + lane * TRACK_SPACING;

    const startLeft = entry.start.x <= boardCenterX;
    assignment.verticalTrackX = snapTrackCoord(
      (startLeft ? channels.leftBus : channels.rightBus) - lane * TRACK_SPACING - gap,
    );
    assignment.exitTrackX = snapTrackCoord(
      (startLeft ? channels.rightBus : channels.leftBus) + lane * TRACK_SPACING + gap,
    );
    assignment.horizontalTrackY = snapTrackCoord(bypassBase + gap);
    assignment.bypassSide = startAbove ? 'top' : 'bottom';
  }

  return assignment;
}
