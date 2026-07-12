import type { CircuitComponentInstance } from '@/types/circuit-component';
import type { ActuatorObservation } from '@/types/actuator-observation';
import { registry } from '@/peripherals/registry';
import type { SimViewContext } from '@/peripherals/types';

/**
 * Simulation data surface needed to bind canvas-glyph props.
 * Aligned with `SimViewContext`; `displayFb`/`oledFb`/`actuatorObservations` stay
 * optional so pre-M2 call sites (only passing `pinStates`) still typecheck until
 * they are wired in Task 2.4/2.5.
 */
export interface CanvasPropsContext {
  readonly pinStates: SimViewContext['pinStates'];
  readonly displayFb?: Uint8Array | null;
  readonly oledFb?: Uint8Array | null;
  readonly actuatorObservations?: readonly ActuatorObservation[];
}

/**
 * Lazy SimViewContext: getters only touch surfaces the binder actually reads.
 * Eager copies would force every CanvasPeripheralsHost `entry` computed to
 * depend on oledFb/actuatorObservations and rebind all glyphs each OLED frame,
 * which interrupts wokwi-pushbutton press/release gestures.
 */
function toSimViewContext(ctx: CanvasPropsContext): SimViewContext {
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
 * Map a circuit component instance + sim context to CanvasGlyph props via
 * registry dispatch — the definition's `ui.canvasProps` binder owns the shape.
 * Returns null when the type is unregistered or has no `canvas.component`
 * (safe degrade — caller skips render). Returns `{}` when a registered
 * definition has no `ui.canvasProps` binder yet.
 */
export function bindCanvasProps(
  comp: CircuitComponentInstance,
  ctx: CanvasPropsContext,
): Record<string, unknown> | null {
  const def = registry.get(comp.type);
  if (!def?.canvas?.component) return null;
  const props = def.ui?.canvasProps?.(comp, toSimViewContext(ctx)) ?? {};
  return props;
}
