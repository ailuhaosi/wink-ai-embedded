import { describe, expect, it } from 'vitest';
import {
  boardDescriptor,

} from '../../types/peripheral-pins';
import type { Obstacle } from '../../types/peripheral-pins';
import { generateSmartPCBPathLegacy } from '../wire-routing-legacy';

const BOARD_X = boardDescriptor.x;
const BOARD_Y = boardDescriptor.y;
const BOARD_ORIGIN = { x: BOARD_X, y: BOARD_Y };

function defaultObstacles(): Obstacle[] {
  return [
    {
      x: BOARD_X,
      y: BOARD_Y,
      width: boardDescriptor.width,
      height: boardDescriptor.height,
    },
  ];
}

function snapshotResult(result: ReturnType<typeof generateSmartPCBPathLegacy>) {
  return {
    path: result.path,
    width: result.width,
    segmentCount: result.segments.length,
    viaCount: result.vias.length,
    teardropCount: result.teardrops.length,
  };
}

describe('legacy golden baseline', () => {
  it('lED primary digital wire (default layout)', () => {
    const result = generateSmartPCBPathLegacy(
      { x: 130, y: 150 },
      { x: 317, y: 192 },
      'down',
      'left',
      2,
      defaultObstacles(),
      new Map(),
      'digital',
      undefined,
      BOARD_ORIGIN,
    );
    expect(snapshotResult(result)).toMatchSnapshot();
  });

  it('oLED I2C SDA wire (default layout)', () => {
    const result = generateSmartPCBPathLegacy(
      { x: 570, y: 195 },
      { x: 487, y: 162 },
      'down',
      'right',
      1,
      defaultObstacles(),
      new Map(),
      'i2c',
      undefined,
      BOARD_ORIGIN,
    );
    expect(snapshotResult(result)).toMatchSnapshot();
  });

  it('oLED I2C SCL wire (default layout)', () => {
    const result = generateSmartPCBPathLegacy(
      { x: 580, y: 195 },
      { x: 487, y: 192 },
      'down',
      'right',
      2,
      defaultObstacles(),
      new Map(),
      'i2c',
      undefined,
      BOARD_ORIGIN,
    );
    expect(snapshotResult(result)).toMatchSnapshot();
  });
});
