import { getPowerNodeSlots } from '@/types/peripheral-pins';
import { POWER_RAIL_VALUES } from '@/constants/power-rail';
import type { CanvasContext } from './types';
import type { CanvasViewport } from './useCanvasViewport';

export function usePowerBus(
  ctx: CanvasContext,
  viewport: Pick<CanvasViewport, 'clientToCanvas'>,
) {
  function syncPowerBusLayout(resetPositions = false) {
    const slots = getPowerNodeSlots(ctx.boardPosition.value.x, ctx.boardPosition.value.y);
    const powerKeys = POWER_RAIL_VALUES;
    for (const key of powerKeys) {
      const node = ctx.commonPowerNodes.value[key];
      const pos = slots.positions[key];
      if (!node || !pos) continue;
      node.y = slots.railY;
      if (resetPositions) {
        node.x = pos.x;
      }
    }
  }

  function handlePowerNodeClick(event: MouseEvent, powerType: string) {
    event.preventDefault();
    event.stopPropagation();
    const { x, y } = viewport.clientToCanvas(event.clientX, event.clientY);
    ctx.draggedPowerNodeId.value = powerType;

    window.addEventListener('mousemove', handlePowerNodeMouseMove);
    window.addEventListener('mouseup', handlePowerNodeMouseUp);
  }

  function handlePowerNodeMouseMove(event: MouseEvent) {
    if (!ctx.draggedPowerNodeId.value) return;

    const { x } = viewport.clientToCanvas(event.clientX, event.clientY);
    const node = ctx.commonPowerNodes.value[ctx.draggedPowerNodeId.value];
    const slots = getPowerNodeSlots(ctx.boardPosition.value.x, ctx.boardPosition.value.y);
    if (node) {
      node.x = Math.max(80, Math.min(ctx.viewWidth.value - 80, x));
      node.y = slots.railY;
    }
  }

  function handlePowerNodeMouseUp() {
    if (ctx.draggedPowerNodeId.value) {
      const slots = getPowerNodeSlots(ctx.boardPosition.value.x, ctx.boardPosition.value.y);
      const node = ctx.commonPowerNodes.value[ctx.draggedPowerNodeId.value];
      if (node) node.y = slots.railY;
    }
    ctx.draggedPowerNodeId.value = null;
    window.removeEventListener('mousemove', handlePowerNodeMouseMove);
    window.removeEventListener('mouseup', handlePowerNodeMouseUp);
  }

  return {
    commonPowerNodes: ctx.commonPowerNodes,
    draggedPowerNodeId: ctx.draggedPowerNodeId,
    syncPowerBusLayout,
    handlePowerNodeClick,
  };
}
