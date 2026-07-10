import type { Point } from './types';
import type { CanvasContext } from './types';
import type { CanvasViewport } from './useCanvasViewport';

export function useWireEdit(
  ctx: CanvasContext,
  viewport: Pick<CanvasViewport, 'clientToCanvas'>,
  getWirePointsById: (wireId: string) => Point[] | null,
) {
  let clickTimer: ReturnType<typeof setTimeout> | null = null;
  let clickCount = 0;

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
    ctx.draggingWaypoint.value = { wireId, index };
    ctx.draggedWireId.value = wireId;

    window.addEventListener('mousemove', handleWaypointMouseMove);
    window.addEventListener('mouseup', handleWaypointMouseUp);
  }

  function handleWireClick(event: MouseEvent, wireId: string) {
    event.preventDefault();
    event.stopPropagation();

    ctx.draggedWireId.value = wireId;

    clickCount++;

    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }

    if (clickCount === 2) {
      clickCount = 0;
      ctx.selectedWireId.value = ctx.selectedWireId.value === wireId ? null : wireId;
      ctx.draggedWireId.value = null;
      return;
    }

    clickTimer = setTimeout(() => {
      clickCount = 0;

      const { x: clickX, y: clickY } = viewport.clientToCanvas(event.clientX, event.clientY);

      const existingWaypoints = ctx.wireWaypoints.value[wireId] || [];
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
          ctx.wireDragStart.value = { x: clickX, y: clickY };

          let { startIndex, endIndex } = nearestSegment;
          const waypoints = ctx.wireWaypoints.value[wireId] || [];

          if (startIndex === 0 && endIndex === 1 && waypoints.length === 0) {
            const wirePts = getWirePointsById(wireId);
            if (wirePts && wirePts.length >= 2) {
              const p1 = wirePts[0];
              const p2 = wirePts[1];
              waypoints.push({ x: p1.x, y: clickY });
              waypoints.push({ x: clickX, y: p2.y });
              ctx.wireWaypoints.value[wireId] = waypoints;
              startIndex = 1;
              endIndex = 2;
            }
          }
          else if (startIndex === 0 && endIndex === 1) {
            startIndex = 1;
            endIndex = 2;
          }

          ctx.draggingSegment.value = {
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

      ctx.wireDragStart.value = { x: clickX, y: clickY };
      ctx.pendingWaypoint.value = { wireId, x: clickX, y: clickY };

      window.addEventListener('mousemove', handleWaypointMouseMove);
      window.addEventListener('mouseup', handleWaypointMouseUp);
    }, 250);
  }

  function handleWaypointMouseMove(event: MouseEvent) {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickCount = 0;
    }

    const { x: currentX, y: currentY } = viewport.clientToCanvas(event.clientX, event.clientY);

    const dx = Math.abs(currentX - ctx.wireDragStart.value.x);
    const dy = Math.abs(currentY - ctx.wireDragStart.value.y);
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (ctx.pendingWaypoint.value && distance > ctx.dragThreshold) {
      const { wireId, x, y } = ctx.pendingWaypoint.value;

      if (!ctx.wireWaypoints.value[wireId]) {
        ctx.wireWaypoints.value[wireId] = [];
      }

      const index = ctx.wireWaypoints.value[wireId].length;
      ctx.wireWaypoints.value[wireId].push({ x, y });

      startDragWaypoint(wireId, index);
      ctx.pendingWaypoint.value = null;
    }

    if (ctx.draggingWaypoint.value) {
      const { wireId, index } = ctx.draggingWaypoint.value;

      let x = currentX;
      let y = currentY;

      x = Math.max(10, Math.min(ctx.viewWidth.value - 10, x));
      y = Math.max(10, Math.min(ctx.viewHeight.value - 10, y));

      x = Math.round(x / 10) * 10;
      y = Math.round(y / 10) * 10;

      if (ctx.wireWaypoints.value[wireId] && ctx.wireWaypoints.value[wireId][index]) {
        ctx.wireWaypoints.value[wireId][index] = { x, y };
      }
    }

    if (ctx.draggingSegment.value) {
      const { wireId, startIndex, endIndex } = ctx.draggingSegment.value;

      const deltaX = currentX - ctx.wireDragStart.value.x;
      const deltaY = currentY - ctx.wireDragStart.value.y;

      const waypoints = ctx.wireWaypoints.value[wireId] || [];

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

      ctx.wireWaypoints.value[wireId] = waypoints;
      ctx.wireDragStart.value = { x: currentX, y: currentY };
    }
  }

  function handleWaypointMouseUp() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      clickCount = 0;
    }

    if (ctx.pendingWaypoint.value && !ctx.draggingWaypoint.value) {
      const { wireId } = ctx.pendingWaypoint.value;
      if (ctx.wireWaypoints.value[wireId] && ctx.wireWaypoints.value[wireId].length > 0) {
        ctx.wireWaypoints.value[wireId].pop();
      }
      ctx.pendingWaypoint.value = null;
    }

    ctx.draggingWaypoint.value = null;
    ctx.draggingSegment.value = null;
    ctx.draggedWireId.value = null;
    ctx.inactiveWireCache.value = {};

    window.removeEventListener('mousemove', handleWaypointMouseMove);
    window.removeEventListener('mouseup', handleWaypointMouseUp);
  }

  function handleCanvasClick(event: MouseEvent) {
    const target = event.target as Element;
    if (target.tagName === 'svg' || target.classList.contains('circuit-svg')) {
      ctx.selectedWireId.value = null;
    }
  }

  function removeWaypoint(wireId: string, index: number) {
    if (ctx.wireWaypoints.value[wireId]) {
      ctx.wireWaypoints.value[wireId].splice(index, 1);
    }
  }

  return {
    wireWaypoints: ctx.wireWaypoints,
    selectedWireId: ctx.selectedWireId,
    handleWireClick,
    handleCanvasClick,
    removeWaypoint,
    startDragWaypoint,
  };
}
