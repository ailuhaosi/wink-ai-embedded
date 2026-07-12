import type { ActuatorObservation, ActuatorObserveProfile } from '@/types/actuator-observation';

export interface ActuatorConverterContext {
  simTimeUs: string;
  profile: ActuatorObserveProfile;
  props?: Record<string, unknown>;
  stateStore?: Record<string, unknown>;
  subAddress?: number;
  lastObservation?: ActuatorObservation;
}

export type ActuatorConverter = (
  rawValue: number,
  context: ActuatorConverterContext,
) => Omit<ActuatorObservation, 'deviceComponentId' | 'simTimeUs'>;

const converters = new Map<string, ActuatorConverter>();

export const actuatorConverterRegistry = {
  register(id: string, converter: ActuatorConverter): void {
    converters.set(id, converter);
  },
  get(id: string): ActuatorConverter | undefined {
    return converters.get(id);
  },
};
