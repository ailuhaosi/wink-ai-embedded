import { OLED_WIDTH, OLED_HEIGHT } from '@/constants/oled';
import type { PeripheralDefinition } from '../types';
import WorldWidget from './WorldWidget.vue';

export const oledDefinition: PeripheralDefinition = {
  type: 'oled',
  displayName: 'SSD1306 OLED',
  category: 'display',
  size: { width: OLED_WIDTH, height: OLED_HEIGHT },
  wireColor: '#a855f7',
  pins: [
    { name: 'DATA', description: 'I2C SDA', required: true, signalType: 'i2c', defaultConnection: 21 },
    { name: 'CLK', description: 'I2C SCL', required: true, signalType: 'i2c', defaultConnection: 22 },
    { name: 'DC', description: 'Data/Command', required: false, signalType: 'digital', defaultConnection: null },
    { name: 'RST', description: 'Reset', required: false, signalType: 'digital', defaultConnection: null },
    { name: 'CS', description: 'Chip Select', required: false, signalType: 'digital', defaultConnection: null },
    { name: '3V3', description: 'Power 3.3V', required: true, signalType: 'power', defaultConnection: '3V3' },
    { name: 'VIN', description: 'Power Input', required: false, signalType: 'power', defaultConnection: null },
    { name: 'GND', description: 'Ground', required: true, signalType: 'power', defaultConnection: 'GND' },
  ],
  props: {},
  world: { component: WorldWidget },
};
