import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { Obstacle } from '@/types/peripheral-pins';
import { registry } from '@/peripherals';
import { defaultPositions } from './constants';
import type { CanvasContext, LayoutPosition } from './types';

export function useCanvasLayout(ctx: CanvasContext) {
  function assignLayoutForNewComponent(id: string, type: string) {
    if (ctx.layoutState.value[id]) return;
    const offset = ctx.nextPositionOffset.value[type] || 0;
    const basePos = defaultPositions[type];
    ctx.layoutState.value[id] = {
      x: basePos.x + offset * 80,
      y: basePos.y + (offset % 3) * 20,
    };
    ctx.nextPositionOffset.value[type] = offset + 1;
  }

  function getLayoutPositions(): Record<string, LayoutPosition> {
    return { ...ctx.layoutState.value };
  }

  function setLayoutPositions(positions: Record<string, LayoutPosition>) {
    ctx.layoutState.value = { ...positions };
  }

  function removeLayoutForComponent(id: string) {
    delete ctx.layoutState.value[id];
  }

  function selectComponent(comp: CircuitComponentInstance) {
    ctx.selectedComponentId.value = comp.id;
    ctx.selectedWireId.value = null;
  }

  function setRotation(comp: CircuitComponentInstance, deg: number) {
    comp.rotation = deg;
  }

  function rotateComponent(comp: CircuitComponentInstance, delta: number) {
    comp.rotation = (((comp.rotation || 0) + delta) % 360 + 360) % 360;
  }

  function getCanvasX(comp: CircuitComponentInstance): number {
    if (ctx.layoutState.value[comp.id]) {
      return ctx.layoutState.value[comp.id].x;
    }
    return defaultPositions[comp.type]?.x ?? 50;
  }

  function getCanvasY(comp: CircuitComponentInstance): number {
    if (ctx.layoutState.value[comp.id]) {
      return ctx.layoutState.value[comp.id].y;
    }
    return defaultPositions[comp.type]?.y ?? 50;
  }

  function getComponentSize(type: string): { width: number; height: number } {
    return registry.getSize(type);
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
    const config = registry.get(comp.type);
    if (config) {
      for (const pin of config.pins) {
        const relX = pin.relX ?? 0;
        const relY = pin.relY ?? 0;
        minX = Math.min(minX, relX - 12);
        minY = Math.min(minY, relY - 12);
        maxX = Math.max(maxX, relX + 12);
        maxY = Math.max(maxY, relY + 12);
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

  return {
    layoutState: ctx.layoutState,
    assignLayoutForNewComponent,
    getLayoutPositions,
    setLayoutPositions,
    removeLayoutForComponent,
    selectComponent,
    setRotation,
    rotateComponent,
    getCanvasX,
    getCanvasY,
    getComponentSize,
    getComponentWidth,
    getComponentHeight,
    getComponentObstacle,
  };
}

export type CanvasLayout = ReturnType<typeof useCanvasLayout>;
