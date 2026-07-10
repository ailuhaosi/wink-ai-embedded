import type { Component } from 'vue';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { bindCanvasProps, type CanvasPropsContext } from './bindCanvasProps';

export interface CanvasEntry {
  component: Component;
  boundProps: Record<string, unknown>;
}

/**
 * Resolve a single circuit component to a canvas glyph entry via registry + props mapper.
 * Returns null for unknown types and definitions without `canvas.component` (safe degrade).
 */
export function resolveCanvasEntry(
  comp: CircuitComponentInstance,
  ctx: CanvasPropsContext,
): CanvasEntry | null {
  const def = registry.get(comp.type);
  const component = def?.canvas?.component;
  if (!component) return null;

  const boundProps = bindCanvasProps(comp, ctx);
  if (!boundProps) return null;

  return { component, boundProps };
}
