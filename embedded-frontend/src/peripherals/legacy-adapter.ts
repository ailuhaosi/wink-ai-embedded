import './led';
import './button';
import './oled';
import './ultrasonic';
import { registry } from './registry';
import type { PeripheralPropDef, PeripheralPropsSchema } from './types';
import type { PeripheralConfig, PeripheralProps, PinConnectionValue } from '@/types/peripheral-pins';

function coercePropType(type: PeripheralPropDef['type']): PeripheralProps[string]['type'] {
  if (type === 'enum' || type === 'color') return 'string';
  return type;
}

function coerceProps(schema: PeripheralPropsSchema): PeripheralProps {
  const props: PeripheralProps = {};
  for (const [key, def] of Object.entries(schema)) {
    props[key] = {
      type: coercePropType(def.type),
      default: def.default,
      description: def.description,
      ...(def.options ? { options: [...def.options] } : {}),
    };
  }
  return props;
}

/**
 * Transition adapter: read registry → legacy PeripheralConfig shape.
 * Call sites migrate in P2.3; do not delete peripheralConfigs yet (P2.4).
 */
export const peripheralConfigsAdapter: Record<string, PeripheralConfig> = new Proxy(
  {} as Record<string, PeripheralConfig>,
  {
    get(_target, type: string | symbol) {
      if (typeof type !== 'string') return undefined;
      const def = registry.get(type);
      if (!def) return undefined;
      return {
        size: def.size,
        pins: def.pins.map((p) => ({
          name: p.name,
          description: p.description ?? '',
          required: p.required ?? false,
          signalType: (p.signalType === 'custom' ? 'digital' : p.signalType) as
            | 'digital'
            | 'i2c'
            | 'power',
          default: p.defaultConnection,
          relX: p.relX ?? 0,
          relY: p.relY ?? 0,
        })),
        props: coerceProps(def.props),
      } satisfies PeripheralConfig;
    },
    has(_target, type: string | symbol) {
      return typeof type === 'string' && registry.get(type) !== undefined;
    },
    ownKeys() {
      return registry.list().map((d) => d.type);
    },
    getOwnPropertyDescriptor(_target, type: string | symbol) {
      if (typeof type !== 'string' || !registry.get(type)) return undefined;
      return { enumerable: true, configurable: true };
    },
  },
);

export function getDefaultProps(type: string): Record<string, unknown> {
  return registry.getDefaultProps(type);
}

export function getDefaultPinConnections(type: string): Record<string, PinConnectionValue> {
  return registry.getDefaultPinConnections(type);
}

export function getComponentSize(type: string): { width: number; height: number } {
  return registry.getSize(type);
}
