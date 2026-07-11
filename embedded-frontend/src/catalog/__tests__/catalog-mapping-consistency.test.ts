import { describe, expect, it } from 'vitest';
import { deviceCatalog } from '@/catalog/device-catalog';
import type { ActuatorMapping, SensorMapping } from '@/types/mapping-registry';

const KNOWN_ACTUATOR_MAPPINGS = new Set<ActuatorMapping['type']>([
  'pwm_to_angular_velocity',
  'pwm_to_linear_position',
  'gpio_to_binary_state',
  'pwm_to_brightness',
  'gpio_to_emissive',
]);

const KNOWN_SENSOR_MAPPINGS = new Set<SensorMapping['type']>([
  'raycast_range_cm',
  'temperature_field_sample',
  'collision_contact_bool',
  'light_intensity_sample',
  'angular_position_to_encoder',
]);

describe('catalog-mapping-consistency', () => {
  it('allowedActuatorMappings reference known mapping types', () => {
    for (const device of deviceCatalog.listDevices()) {
      for (const mapping of device.simulation?.allowedActuatorMappings ?? []) {
        expect(
          KNOWN_ACTUATOR_MAPPINGS.has(mapping),
          `${device.id} has unknown actuator mapping ${mapping}`,
        ).toBe(true);
      }
    }
  });

  it('allowedSensorMappings reference known mapping types', () => {
    for (const device of deviceCatalog.listDevices()) {
      for (const mapping of device.simulation?.allowedSensorMappings ?? []) {
        expect(
          KNOWN_SENSOR_MAPPINGS.has(mapping),
          `${device.id} has unknown sensor mapping ${mapping}`,
        ).toBe(true);
      }
    }
  });
});
