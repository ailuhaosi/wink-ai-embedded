import { registry } from '../registry';
import { servoDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

registry.register(servoDefinition);

// Register the converter for sg90_from_duty
actuatorConverterRegistry.register('sg90_from_duty', (duty, ctx) => {
  // 90° -> duty 7.5%, 180° -> duty 12.5% (default pulse 0.5/2.5 ms @ 50Hz, period 20ms)
  // pulse_us = duty * 200.0
  // angle = (pulse_us - 500) * 180 / 2000
  // So: value = (duty * 200 - 500) * 180 / 2000
  // Let's simplify: value = (duty - 2.5) * 180 / 10 = (duty - 2.5) * 18
  // Clamp value to 0..180
  const rawAngle = (duty - 2.5) * 18;
  const value = Math.max(0, Math.min(180, rawAngle));
  return {
    quantity: 'angular_position',
    value,
    unit: 'deg',
    role: 'command',
  };
});
