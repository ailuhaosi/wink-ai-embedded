import type { BoardDefinition } from '../types';

export const esp32DevkitV1Definition: BoardDefinition = {
  id: 'esp32-devkit-v1',
  displayName: 'ESP32 DevKit V1',
  gpioPins: [0, 1, 2, 3, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  canvas: {
    x: 310,
    y: 130,
    width: 180,
    height: 200,
    pins: {
      2: { x: 317, y: 132 },
      10: { x: 317, y: 282 },
      12: { x: 317, y: 162 },
      13: { x: 317, y: 192 },
      14: { x: 317, y: 222 },
      21: { x: 487, y: 162 },
      22: { x: 487, y: 192 },
    },
    powerPins: {
      VCC: { x: 487, y: 222 },
      '3V3': { x: 487, y: 222 },
      GND: { x: 317, y: 252 },
    },
  },
};
