import type { PeripheralDefinition, PeripheralPropsSchema } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';
import WorldWidget from './WorldWidget.vue';
import InspectorExtra from './InspectorExtra.vue';

const ultrasonicProps: PeripheralPropsSchema = {
  distance: {
    type: 'number',
    default: 25,
    description: 'Distance in cm',
    range: { min: 2, max: 400, step: 1 },
  },
};

export const ultrasonicDefinition: PeripheralDefinition = {
  type: 'ultrasonic',
  displayName: 'HC-SR04 Ultrasonic',
  category: 'sensor',
  catalog: {
    id: 'hc-sr04',
    description: 'HC-SR04 Ultrasonic',
    pins: [
      { name: 'TRIG', type: 'gpio', description: 'Trigger input' },
      { name: 'ECHO', type: 'digital_in', description: 'Echo output' },
      { name: 'VCC', type: 'power' },
      { name: 'GND', type: 'power' },
    ],
    worldCoupling: 'required',
    allowedSensorMappings: ['raycast_range_cm'],
  },
  size: { width: 180, height: 100 },
  wireColor: '#eab308',
  pins: [
    { name: 'VCC', description: 'Power 5V', required: true, signalType: 'power', defaultConnection: 'VCC', relX: 72, relY: 95 },
    { name: 'TRIG', description: 'Trigger input', required: true, signalType: 'digital', defaultConnection: 12, relX: 82, relY: 95 },
    { name: 'ECHO', description: 'Echo output', required: true, signalType: 'digital', defaultConnection: 13, relX: 92, relY: 95 },
    { name: 'GND', description: 'Ground', required: true, signalType: 'power', defaultConnection: 'GND', relX: 102, relY: 95 },
  ],
  props: ultrasonicProps,
  canvas: { component: CanvasGlyph },
  world: { component: WorldWidget },
  inspectorExtra: InspectorExtra,
  simulation: {
    worldCoupling: 'required',
    observe(comp, builder) {
      const trig = comp.pinConnections.TRIG;
      const echo = comp.pinConnections.ECHO;
      builder.watchUltrasonic(
        typeof trig === 'number' ? trig : null,
        typeof echo === 'number' ? echo : null,
      );
    },
  },
};
