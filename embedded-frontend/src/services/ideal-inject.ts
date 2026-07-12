import { registry } from '@/peripherals/registry';
import type { InjectContext } from '@/peripherals/types';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { clockUs } from '@/services/simulation-runtime';
import {
  setPinIdeal,
  setUltrasonicDistance,
  type SetPinIdealOptions,
  type SetUltrasonicDistanceOptions,
} from './simulation-pin-api';

function getSimTimeUs(): string {
  return clockUs.value;
}

type PendingPinWrite = {
  level: boolean;
  drive: 'strong' | 'weak';
  timestampUs?: string;
};

function createArbitratedPinApis(
  timestampUs?: string,
): InjectContext['apis'] & { flushPinWrites: () => void } {
  const pending = new Map<number, PendingPinWrite>();

  const queuePinIdeal = (
    pin: number,
    level: boolean,
    options?: SetPinIdealOptions,
  ): void => {
    const drive = options?.drive ?? 'strong';
    const existing = pending.get(pin);
    if (existing && drive === 'weak' && existing.drive === 'strong') {
      return;
    }
    pending.set(pin, {
      level,
      drive,
      timestampUs: options?.timestampUs ?? timestampUs,
    });
  };

  return {
    setPinIdeal: queuePinIdeal,
    setUltrasonicDistance: (
      trig: number,
      echo: number,
      cm: number,
      options?: SetUltrasonicDistanceOptions,
    ) => {
      setUltrasonicDistance(trig, echo, cm, {
        ...options,
        timestampUs: options?.timestampUs ?? timestampUs,
      });
    },
    getCurrentSimTimeUs: getSimTimeUs,
    flushPinWrites: () => {
      for (const [pin, write] of pending) {
        setPinIdeal(pin, write.level, {
          timestampUs: write.timestampUs,
          drive: write.drive,
        });
      }
      pending.clear();
    },
  };
}

function createDirectPinApis(timestampUs?: string): InjectContext['apis'] {
  return {
    setPinIdeal: (pin, level, options) =>
      setPinIdeal(pin, level, { ...options, timestampUs: options?.timestampUs ?? timestampUs }),
    setUltrasonicDistance: (trig, echo, cm, options) =>
      setUltrasonicDistance(trig, echo, cm, {
        ...options,
        timestampUs: options?.timestampUs ?? timestampUs,
      }),
    getCurrentSimTimeUs: getSimTimeUs,
  };
}

export function syncIdealInputs(components: CircuitComponentInstance[]): void {
  const apis = createArbitratedPinApis();
  for (const comp of components) {
    const inject = registry.get(comp.type)?.simulation?.inject;
    inject?.apply(comp, { event: 'props', apis });
  }
  apis.flushPinWrites();
}

export function runInject(
  comp: CircuitComponentInstance,
  partial: Pick<InjectContext, 'event' | 'timestampUs'>,
): void {
  const inject = registry.get(comp.type)?.simulation?.inject;
  const apis = createDirectPinApis(partial.timestampUs);
  inject?.apply(comp, { ...partial, apis });
}

export function runInjectIdle(components: CircuitComponentInstance[]): void {
  const apis = createArbitratedPinApis();
  for (const comp of components) {
    const inject = registry.get(comp.type)?.simulation?.inject;
    inject?.idle?.(comp, { event: 'idle', apis });
  }
  apis.flushPinWrites();
}
