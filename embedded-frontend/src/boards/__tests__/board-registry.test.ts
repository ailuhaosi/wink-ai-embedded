import { describe, expect, it } from 'vitest';
import { deviceCatalog } from '@/catalog/device-catalog';
import { boardRegistry, DEFAULT_BOARD_ID, getDefaultBoardCanvasDescriptor } from '@/boards';

describe('board registry SSOT', () => {
  it('registers esp32-devkit-v1 with gpio pins and canvas layout', () => {
    const board = boardRegistry.get(DEFAULT_BOARD_ID);
    expect(board).toMatchObject({
      id: 'esp32-devkit-v1',
      displayName: 'ESP32 DevKit V1',
    });
    expect(board?.gpioPins).toContain(12);
    expect(board?.gpioPins).toContain(21);
    expect(board?.canvas.pins[12]).toEqual({ x: 317, y: 162 });
  });

  it('deviceCatalog.getBoard reads from boardRegistry', () => {
    const entry = deviceCatalog.getBoard('esp32-devkit-v1');
    expect(entry?.gpioPins).toEqual(boardRegistry.get('esp32-devkit-v1')?.gpioPins);
  });

  it('deviceCatalog lists boards from registry only', () => {
    expect(deviceCatalog.listBoards().map(b => b.id)).toEqual(['esp32-devkit-v1']);
  });

  it('getDefaultBoardCanvasDescriptor matches legacy boardDescriptor consumers', () => {
    const canvas = getDefaultBoardCanvasDescriptor();
    expect(canvas).toMatchObject({
      x: 310,
      y: 130,
      width: 180,
      height: 200,
    });
    expect(canvas?.powerPins.GND).toEqual({ x: 317, y: 252 });
  });
});
