import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ActuatorObservation } from '@/types/actuator-observation';
import { registry } from '@/peripherals/registry';
import type { SimViewContext } from '@/peripherals/types';

/**
 * Simulation data surface needed to bind world-widget props.
 * Aligned with `SimViewContext`; `displayFb`/`actuatorObservations` stay
 * optional so pre-M2 call sites (only passing `pinStates`/`oledFb`) still
 * typecheck until they are wired in Task 2.4/2.5.
 */
export interface WorldPropsContext {
  readonly pinStates: SimViewContext['pinStates'];
  readonly oledFb: Uint8Array | null;
  readonly displayFb?: Uint8Array | null;
  readonly actuatorObservations?: readonly ActuatorObservation[];
}

/** Lazy getters — see bindCanvasProps.toSimViewContext for why. */
function toSimViewContext(ctx: WorldPropsContext): SimViewContext {
  return {
    get pinStates() {
      return ctx.pinStates;
    },
    get displayFb() {
      return ctx.displayFb ?? ctx.oledFb ?? null;
    },
    get oledFb() {
      return ctx.oledFb ?? ctx.displayFb ?? null;
    },
    get actuatorObservations() {
      return ctx.actuatorObservations ?? [];
    },
  };
}

/**
 * Map a circuit component instance + sim context to WorldWidget props via
 * registry dispatch — the definition's `ui.worldProps` binder owns the shape.
 * Returns null when the type is unregistered or has no `world.component`
 * (safe degrade — caller skips render). Returns `{}` when a registered
 * definition has no `ui.worldProps` binder yet.
 */
export function bindWorldProps(
  comp: CircuitComponentInstance,
  ctx: WorldPropsContext,
): Record<string, unknown> | null {
  const def = registry.get(comp.type);
  if (!def?.world?.component) return null;
  const props = def.ui?.worldProps?.(comp, toSimViewContext(ctx)) ?? {};
  return props;
}
