import type { CanvasContext } from './types';

export function useCanvasViewport(ctx: CanvasContext) {
  function updateCanvasScale() {
    const container = ctx.canvasContainerRef.value;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const containerRatio = rect.width / rect.height;
    const baseRatio = ctx.CANVAS_WIDTH / ctx.CANVAS_HEIGHT;

    if (containerRatio > baseRatio) {
      ctx.viewHeight.value = ctx.CANVAS_HEIGHT;
      ctx.viewWidth.value = Math.round(ctx.CANVAS_HEIGHT * containerRatio);
    }
    else {
      ctx.viewWidth.value = ctx.CANVAS_WIDTH;
      ctx.viewHeight.value = Math.round(ctx.CANVAS_WIDTH / containerRatio);
    }

    ctx.peripheralScaleX.value = rect.width / ctx.viewWidth.value;
    ctx.peripheralScaleY.value = rect.height / ctx.viewHeight.value;
  }

  function clientToCanvas(clientX: number, clientY: number) {
    const svg = ctx.circuitSvgRef.value;
    if (!svg) return { x: clientX, y: clientY };
    const rect = svg.getBoundingClientRect();
    const x = (clientX - rect.left) * (ctx.viewWidth.value / rect.width);
    const y = (clientY - rect.top) * (ctx.viewHeight.value / rect.height);
    return { x, y };
  }

  return {
    canvasContainerRef: ctx.canvasContainerRef,
    circuitSvgRef: ctx.circuitSvgRef,
    viewWidth: ctx.viewWidth,
    viewHeight: ctx.viewHeight,
    peripheralScaleX: ctx.peripheralScaleX,
    peripheralScaleY: ctx.peripheralScaleY,
    updateCanvasScale,
    clientToCanvas,
  };
}

export type CanvasViewport = ReturnType<typeof useCanvasViewport>;
