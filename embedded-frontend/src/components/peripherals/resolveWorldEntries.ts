import type { Component } from 'vue';
import { registry } from '@/peripherals';
import type { CircuitComponentInstance } from '@/types/circuit-component';
import { bindWorldProps, type WorldPropsContext } from './bindWorldProps';

export interface WorldEntry {
  id: string;
  name: string;
  component: Component;
  boundProps: Record<string, unknown>;
}

/**
 * Resolve canvas components to world-pane entries via registry + props mapper.
 * Skips unknown types and definitions without `world.component` (safe degrade).
 */
export function resolveWorldEntries(
  components: CircuitComponentInstance[],
  ctx: WorldPropsContext,
): WorldEntry[] {
  const result: WorldEntry[] = [];

  for (const comp of components) {
    const def = registry.get(comp.type);
    const component = def?.world?.component;
    if (!component) continue;

    const boundProps = bindWorldProps(comp, ctx);
    if (!boundProps) continue;

    result.push({
      id: comp.id,
      name: comp.name,
      component,
      boundProps,
    });
  }

  return result;
}
