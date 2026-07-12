import type { CircuitComponentInstance } from '@/types/circuit-component';
import type {
  ActuatorObservation,
  ActuatorOutputBatch,
  ActuatorObserveSource,
  ActuatorObserveProfile,
} from '@/types/actuator-observation';
import { registry } from '@/peripherals';
import { actuatorConverterRegistry } from './actuator-converter-registry';

interface ConverterSessionState {
  stateStore: Record<string, unknown>;
  lastObservation?: ActuatorObservation;
}

const converterSessionStates = new Map<string, ConverterSessionState>();

export function clearActuatorConverterSessionStates(): void {
  converterSessionStates.clear();
}

function getConverterSessionState(
  deviceComponentId: string,
  subAddress: number | undefined,
): ConverterSessionState {
  const key = `${deviceComponentId}:${subAddress ?? 'default'}`;
  let state = converterSessionStates.get(key);
  if (!state) {
    state = { stateStore: {} };
    converterSessionStates.set(key, state);
  }
  return state;
}

export function mapActuatorOutputs(
  batch: ActuatorOutputBatch,
  actuatorSources: ActuatorObserveSource[],
  components: CircuitComponentInstance[],
): ActuatorObservation[] {
  const observations: ActuatorObservation[] = [];
  const simTimeUs = batch.simTimeUs;

  for (const src of actuatorSources) {
    const { deviceComponentId, transport, transportKey, subAddress } = src;

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
      const sessionState = getConverterSessionState(deviceComponentId, subAddress);
      const converted = converter(rawValue, {
        simTimeUs,
        profile,
        props: comp.props,
        stateStore: sessionState.stateStore,
        subAddress,
        lastObservation: sessionState.lastObservation,
      });

      const observation: ActuatorObservation = {
        deviceComponentId,
        ...converted,
        subAddress,
        simTimeUs,
      };
      observations.push(observation);
      sessionState.lastObservation = observation;
    } catch (e) {
      console.error(`[actuator-observation.mapper] converter error for ${deviceComponentId}:`, e);
    }
  }

  return observations;
}
