import type { CircuitComponentInstance } from '@/types/circuit-component';

/** Simulation data surface needed to bind world-widget props. */
export interface WorldPropsContext {
  pinStates: Record<number, boolean>;
  oledFb: Uint8Array | null;
}

/**
 * Map a circuit component instance + sim context to WorldWidget props.
 * Returns null for unknown types (safe degrade — caller skips render).
 * Props shapes match EmbeddedWorkbench.vue world-pane bindings.
 */
export function bindWorldProps(
  comp: CircuitComponentInstance,
  ctx: WorldPropsContext,
): Record<string, unknown> | null {
  switch (comp.type) {
    case 'led':
      return {
        pinConnections: comp.pinConnections,
        color: comp.props.color,
        level:
          typeof comp.pinConnections.A === 'number'
            ? ctx.pinStates[comp.pinConnections.A] || false
            : false,
        brightness: comp.props.brightness,
        label: comp.props.label,
        flip: comp.props.flip,
      };
    case 'button':
      return {
        pinConnections: comp.pinConnections,
        color: comp.props.color,
        label: comp.props.label,
        xray: comp.props.xray,
        activeLow: comp.props.activeLow,
      };
    case 'oled':
      return {
        pinConnections: comp.pinConnections,
        framebuffer: ctx.oledFb,
      };
    case 'ultrasonic':
      return {
        pinConnections: comp.pinConnections,
        distance: comp.props.distance,
      };
    default:
      return null;
  }
}
