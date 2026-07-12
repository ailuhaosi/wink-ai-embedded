import { registry } from '../registry';
import { ledDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

registry.register(ledDefinition);

actuatorConverterRegistry.register('gpio_to_state', (raw) => ({
  quantity: 'state',
  value: raw ? 'on' : 'off',
  unit: 'bool',
  role: 'command',
}));
