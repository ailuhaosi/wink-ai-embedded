import type { CircuitComponentInstance } from '@/types/circuit-component';

/** Simulation data surface needed to bind canvas-glyph props. */
export interface CanvasPropsContext {
  pinStates: Record<number, boolean>;
}

/**
 * Map a circuit component instance + sim context to CanvasGlyph props.
 * Returns null for unknown types (safe degrade — caller skips render).
 * Props shapes match CircuitCanvas.vue canvas bindings / CanvasGlyph.vue.
 */
export function bindCanvasProps(
  comp: CircuitComponentInstance,
  ctx: CanvasPropsContext,
): Record<string, unknown> | null {
  switch (comp.type) {
    case 'led':
      return {
        pinConnections: comp.pinConnections,
        color: comp.props.color,
        brightness: comp.props.brightness,
        label: comp.props.label,
        flip: comp.props.flip,
        pinStates: ctx.pinStates,
      };
    case 'button':
      return {
        color: comp.props.color,
        label: comp.props.label,
        xray: comp.props.xray,
      };
    case 'oled':
      return {};
    case 'ultrasonic':
      return {};
    default:
      return null;
  }
}
