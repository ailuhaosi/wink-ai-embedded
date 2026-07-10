import type { PinConnectionValue, PeripheralDefinition } from './types';

const defs = new Map<string, PeripheralDefinition>();

export const registry = {
  register(def: PeripheralDefinition): void {
    defs.set(def.type, def);
  },

  get(type: string): PeripheralDefinition | undefined {
    return defs.get(type);
  },

  list(): PeripheralDefinition[] {
    return Array.from(defs.values());
  },

  listByCategory(): Array<{ category: string; items: PeripheralDefinition[] }> {
    const groups = new Map<string, PeripheralDefinition[]>();
    for (const def of defs.values()) {
      const bucket = groups.get(def.category);
      if (bucket) {
        bucket.push(def);
      }
      else {
        groups.set(def.category, [def]);
      }
    }
    return Array.from(groups.entries()).map(([category, items]) => ({ category, items }));
  },

  getWireColor(type: string): string {
    return defs.get(type)?.wireColor ?? '#ffffff';
  },

  getSize(type: string): { width: number; height: number } {
    return defs.get(type)?.size ?? { width: 0, height: 0 };
  },

  getDefaultProps(type: string): Record<string, unknown> {
    const def = defs.get(type);
    if (!def) return {};
    const props: Record<string, unknown> = {};
    for (const [key, schema] of Object.entries(def.props)) {
      props[key] = schema.default;
    }
    return props;
  },

  getDefaultPinConnections(type: string): Record<string, PinConnectionValue> {
    const def = defs.get(type);
    if (!def) return {};
    const connections: Record<string, PinConnectionValue> = {};
    for (const pin of def.pins) {
      if (pin.defaultConnection !== null && pin.defaultConnection !== undefined) {
        connections[pin.name] = pin.defaultConnection;
      }
    }
    return connections;
  },
};
