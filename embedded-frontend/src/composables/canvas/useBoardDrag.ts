import { boardDescriptor } from '@/types/peripheral-pins';
import type { CanvasContext } from './types';
import type { CanvasViewport } from './useCanvasViewport';

export function useBoardDrag(
  ctx: CanvasContext,
  viewport: Pick<CanvasViewport, 'clientToCanvas'>,
  syncPowerBusLayout: (resetPositions?: boolean) => void,
) {
  function startDragBoard(event: MouseEvent) {
    if (event.button !== 0) return;
    if (ctx.readonly.value) return;
    event.preventDefault();
    event.stopPropagation();

    const { x: mouseX, y: mouseY } = viewport.clientToCanvas(event.clientX, event.clientY);
    ctx.boardDragOffset.value = {
      x: mouseX - ctx.boardPosition.value.x,
      y: mouseY - ctx.boardPosition.value.y,
    };
    ctx.isDraggingBoard.value = true;
    window.addEventListener('mousemove', handleBoardMouseMove);
    window.addEventListener('mouseup', handleBoardMouseUp);
  }

  function handleBoardMouseMove(event: MouseEvent) {
    if (!ctx.isDraggingBoard.value) return;

    const { x: mouseX, y: mouseY } = viewport.clientToCanvas(event.clientX, event.clientY);

    let x = Math.round(mouseX - ctx.boardDragOffset.value.x);
    let y = Math.round(mouseY - ctx.boardDragOffset.value.y);

    const maxX = ctx.viewWidth.value - boardDescriptor.width - 10;
    const maxY = ctx.viewHeight.value - boardDescriptor.height - 10;
    x = Math.max(10, Math.min(maxX, x));
    y = Math.max(10, Math.min(maxY, y));

    x = Math.round(x / 10) * 10;
    y = Math.round(y / 10) * 10;

    ctx.boardPosition.value = { x, y };
  }

  function handleBoardMouseUp() {
    ctx.isDraggingBoard.value = false;
    syncPowerBusLayout(true);
    window.removeEventListener('mousemove', handleBoardMouseMove);
    window.removeEventListener('mouseup', handleBoardMouseUp);
  }

  return {
    boardPosition: ctx.boardPosition,
    isDraggingBoard: ctx.isDraggingBoard,
    startDragBoard,
  };
}
