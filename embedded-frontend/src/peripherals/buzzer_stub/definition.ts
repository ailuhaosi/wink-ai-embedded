import type { PeripheralDefinition } from '../types';
import CanvasGlyph from './CanvasGlyph.vue';

export const buzzerStubDefinition: PeripheralDefinition = {
  type: 'buzzer_stub',
  displayName: 'Buzzer (stub)',
  category: 'actuator',
  catalog: {
    id: 'buzzer_stub',
    description: 'Buzzer placeholder',
    worldCoupling: 'optional',
    allowedActuatorMappings: ['gpio_to_binary_state'],
  },
  size: { width: 60, height: 50 },
  wireColor: '#a78bfa',
  pins: [
    {
      name: 'SIG',
      catalogType: 'gpio',
      description: 'Signal pin',
      required: true,
      signalType: 'digital',
      defaultConnection: 25,
      relX: 30,
      relY: 42,
    },
  ],
  props: {},
  canvas: { component: CanvasGlyph },
  ui: {
    canvasProps: () => ({}),
  },
};
