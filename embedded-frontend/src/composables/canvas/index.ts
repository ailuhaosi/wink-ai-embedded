import { buildCanvasContext } from './context';
import { useCanvasLayout } from './useCanvasLayout';
import { useCanvasViewport } from './useCanvasViewport';
import { useBoardDrag } from './useBoardDrag';
import { usePowerBus } from './usePowerBus';
import { useComponentDrag } from './useComponentDrag';
import { useWireRendering } from './useWireRendering';
import type { UseCircuitCanvasOptions } from './types';

export type { UseCircuitCanvasOptions } from './types';

export function useCircuitCanvas(options: UseCircuitCanvasOptions) {
  const ctx = buildCanvasContext(options);

  const layout = useCanvasLayout(ctx);
  const viewport = useCanvasViewport(ctx);
  const wireRendering = useWireRendering(ctx, layout);
  const powerBus = usePowerBus(ctx, viewport);
  const boardDrag = useBoardDrag(ctx, viewport, powerBus.syncPowerBusLayout);
  const componentDrag = useComponentDrag(ctx, layout, viewport, wireRendering.buildTrackAssignmentMap);

  return {
    canvasContainerRef: viewport.canvasContainerRef,
    circuitSvgRef: viewport.circuitSvgRef,
    viewWidth: viewport.viewWidth,
    viewHeight: viewport.viewHeight,
    peripheralScaleX: viewport.peripheralScaleX,
    peripheralScaleY: viewport.peripheralScaleY,
    boardPosition: boardDrag.boardPosition,
    isDraggingBoard: boardDrag.isDraggingBoard,
    commonPowerNodes: powerBus.commonPowerNodes,
    draggedPowerNodeId: powerBus.draggedPowerNodeId,
    draggedCompId: componentDrag.draggedCompId,
    isComponentDragging: componentDrag.isComponentDragging,
    wiresToRender: wireRendering.wiresToRender,
    routingChannels: wireRendering.routingChannels,
    routingDebugOverlay: wireRendering.routingDebugOverlay,
    powerBusVisual: wireRendering.powerBusVisual,
    syncPowerBusLayout: powerBus.syncPowerBusLayout,
    updateCanvasScale: viewport.updateCanvasScale,
    assignLayoutForNewComponent: layout.assignLayoutForNewComponent,
    removeLayoutForComponent: layout.removeLayoutForComponent,
    getLayoutPositions: layout.getLayoutPositions,
    setLayoutPositions: layout.setLayoutPositions,
    selectComponent: layout.selectComponent,
    setRotation: layout.setRotation,
    rotateComponent: layout.rotateComponent,
    handlePowerNodeClick: powerBus.handlePowerNodeClick,
    startDragBoard: boardDrag.startDragBoard,
    onPeripheralMouseDown: componentDrag.onPeripheralMouseDown,
    getCanvasX: layout.getCanvasX,
    getCanvasY: layout.getCanvasY,
    getComponentSize: layout.getComponentSize,
    getWireVisual: wireRendering.getWireVisual,
  };
}
