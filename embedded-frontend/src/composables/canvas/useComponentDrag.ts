import type { CircuitComponentInstance } from '@/types/circuit-component';
import { getNetDefinitions } from '@/types/peripheral-pins';
import { resolveNetConnection } from '@/routing/net-pin-resolver';
import type { CanvasContext } from './types';
import type { CanvasLayout } from './useCanvasLayout';
import type { CanvasViewport } from './useCanvasViewport';

export function useComponentDrag(
  ctx: CanvasContext,
  layout: Pick<
    CanvasLayout,
    'selectComponent' | 'getCanvasX' | 'getCanvasY' | 'getComponentWidth' | 'getComponentHeight'
  >,
  viewport: Pick<CanvasViewport, 'clientToCanvas'>,
  buildTrackAssignmentMap: (
    requests: Array<{
      compId: string;
      comp: CircuitComponentInstance;
      mode: 'primary' | 'secondary' | 'vcc' | 'gnd';
      signalType: 'digital' | 'i2c' | 'power';
    }>,
  ) => Map<string, import('@/routing/types').TrackAssignment>,
) {
  function onPeripheralMouseDown(event: MouseEvent, comp: CircuitComponentInstance) {
    if (event.button !== 0) return;

    layout.selectComponent(comp);
    if (ctx.readonly.value) return;

    const { x: mouseX, y: mouseY } = viewport.clientToCanvas(event.clientX, event.clientY);
    ctx.componentDragOrigin.value = { x: mouseX, y: mouseY };
    ctx.isComponentDragging.value = false;
    ctx.draggedCompId.value = comp.id;
    ctx.frozenTrackAssignments.value = buildTrackAssignmentMap(
      ctx.components.value.flatMap(c =>
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

    ctx.dragOffset.value = {
      x: mouseX - layout.getCanvasX(comp),
      y: mouseY - layout.getCanvasY(comp),
    };

    window.addEventListener('mousemove', handleComponentMouseMove);
    window.addEventListener('mouseup', handleComponentMouseUp);
  }

  function handleComponentMouseMove(event: MouseEvent) {
    if (!ctx.draggedCompId.value) return;

    const { x: mouseX, y: mouseY } = viewport.clientToCanvas(event.clientX, event.clientY);

    if (!ctx.isComponentDragging.value) {
      const dx = mouseX - ctx.componentDragOrigin.value.x;
      const dy = mouseY - ctx.componentDragOrigin.value.y;
      if (Math.sqrt(dx * dx + dy * dy) < ctx.dragThreshold) return;
      ctx.isComponentDragging.value = true;
    }

    let x = Math.round(mouseX - ctx.dragOffset.value.x);
    let y = Math.round(mouseY - ctx.dragOffset.value.y);

    const draggedComp = ctx.components.value.find(c => c.id === ctx.draggedCompId.value);
    const maxX = ctx.viewWidth.value - (draggedComp ? layout.getComponentWidth(draggedComp) : 100) - 10;
    const maxY = ctx.viewHeight.value - (draggedComp ? layout.getComponentHeight(draggedComp) : 80) - 10;
    x = Math.max(10, Math.min(maxX, x));
    y = Math.max(10, Math.min(maxY, y));

    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;

    if (!ctx.layoutState.value[ctx.draggedCompId.value]) {
      ctx.layoutState.value[ctx.draggedCompId.value] = { x: 0, y: 0 };
    }
    ctx.layoutState.value[ctx.draggedCompId.value] = { x, y };
  }

  function handleComponentMouseUp() {
    const didDrag = ctx.isComponentDragging.value;
    ctx.draggedCompId.value = null;
    ctx.isComponentDragging.value = false;
    ctx.frozenTrackAssignments.value = null;
    ctx.inactiveWireCache.value = {};
    window.removeEventListener('mousemove', handleComponentMouseMove);
    window.removeEventListener('mouseup', handleComponentMouseUp);
    if (didDrag) {
      ctx.onLayoutChange?.();
    }
  }

  return {
    draggedCompId: ctx.draggedCompId,
    isComponentDragging: ctx.isComponentDragging,
    onPeripheralMouseDown,
  };
}
