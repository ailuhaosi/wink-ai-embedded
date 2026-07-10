import { OLED_WIDTH, OLED_HEIGHT } from '@/constants/oled';
import type { PeripheralDefinition } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';

export const oledDefinition: PeripheralDefinition = {
  type: 'oled',
  displayName: 'SSD1306 OLED',
  category: 'display',
  catalog: {
    id: 'oled_stub',
    description: 'SSD1306 OLED',
    pins: [
      { name: 'DATA', type: 'i2c' },
      { name: 'CLK', type: 'i2c' },
    ],
    worldCoupling: 'optional',
  },
  size: { width: OLED_WIDTH, height: OLED_HEIGHT },
  wireColor: '#a855f7',
  pins: [
    { name: 'DATA', description: 'I2C SDA', required: true, signalType: 'i2c', defaultConnection: 21, relX: 40, relY: 75 },
    { name: 'CLK', description: 'I2C SCL', required: true, signalType: 'i2c', defaultConnection: 22, relX: 50, relY: 75 },
    { name: 'DC', description: 'Data/Command', required: false, signalType: 'digital', defaultConnection: null, relX: 60, relY: 75 },
    { name: 'RST', description: 'Reset', required: false, signalType: 'digital', defaultConnection: null, relX: 70, relY: 75 },
    { name: 'CS', description: 'Chip Select', required: false, signalType: 'digital', defaultConnection: null, relX: 80, relY: 75 },
    { name: '3V3', description: 'Power 3.3V', required: true, signalType: 'power', defaultConnection: '3V3', relX: 90, relY: 75 },
    { name: 'VIN', description: 'Power Input', required: false, signalType: 'power', defaultConnection: null, relX: 100, relY: 75 },
    { name: 'GND', description: 'Ground', required: true, signalType: 'power', defaultConnection: 'GND', relX: 110, relY: 75 },
  ],
  props: {},
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  simulation: {
    worldCoupling: 'optional',
    observe(comp, builder) {
      const sda = comp.pinConnections.DATA;
      const scl = comp.pinConnections.CLK;
      builder.watchI2C(
        typeof sda === 'number' ? sda : null,
        typeof scl === 'number' ? scl : null,
      );
    },
  },
};
