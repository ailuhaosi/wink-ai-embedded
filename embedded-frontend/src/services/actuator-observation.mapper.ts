import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  ActuatorObservation,
  ActuatorOutputBatch,
  ActuatorObserveSource,
  ActuatorObserveProfile,
} from '@/types/actuator-observation';
import { registry } from '@/peripherals';
import { actuatorConverterRegistry } from './actuator-converter-registry';

export function mapActuatorOutputs(
  batch: ActuatorOutputBatch,
  actuatorSources: ActuatorObserveSource[],
  components: CircuitComponentInstance[],
): ActuatorObservation[] {
  const observations: ActuatorObservation[] = [];
  const simTimeUs = batch.simTimeUs;

  for (const src of actuatorSources) {
    const { deviceComponentId, transport, transportKey } = src;

    // Find the component instance
    const comp = components.find((c) => c.id === deviceComponentId);
    if (!comp) continue;

    // Find peripheral definition and profile
    const def = registry.get(comp.type);
    const profile = def?.actuatorObserve?.profile;
    if (!profile) continue;

    // Get the raw value from the batch
    let rawValue = 0;
    if (transport === 'pwm_channel' && typeof transportKey === 'number') {
      rawValue = batch.pwm[transportKey] ?? 0;
    } else if (transport === 'gpio_pin' && typeof transportKey === 'number') {
      rawValue = batch.gpio[transportKey] ? 1 : 0;
    } else {
      // Other transports not supported in Phase 1
      continue;
    }

    // Convert raw value
    const converter = actuatorConverterRegistry.get(profile.convert);
    if (!converter) continue;

    try {
      const converted = converter(rawValue, {
        simTimeUs,
        profile,
        props: comp.props,
      });

      observations.push({
        deviceComponentId,
        simTimeUs,
        ...converted,
      });
    } catch (e) {
      console.error(`[actuator-observation.mapper] converter error for ${deviceComponentId}:`, e);
    }
  }

  return observations;
}
