import type { CanvasContext, WireRenderItem } from './types';

export function useWireSelection(ctx: CanvasContext) {
  function selectWire(wireId: string | null) {
    ctx.selectedWireId.value = wireId;
    if (wireId) {
      ctx.selectedComponentId.value = '';
    }
  }

  function handleWireClick(event: MouseEvent, wire: WireRenderItem) {
    event.stopPropagation();
    selectWire(ctx.selectedWireId.value === wire.id ? null : wire.id);
  }

  function handleCanvasBackgroundClick(event: MouseEvent) {
    const target = event.target as Element | null;
    if (!target) return;

    const isBackground =
      target.classList.contains('canvas-container')
      || target.classList.contains('circuit-svg')
      || target.classList.contains('canvas-background');

    if (!isBackground) return;

    ctx.selectedWireId.value = null;
    ctx.selectedComponentId.value = '';
  }

  return {
    selectedWireId: ctx.selectedWireId,
    selectWire,
    handleWireClick,
    handleCanvasBackgroundClick,
  };
}
