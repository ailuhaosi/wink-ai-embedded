/**
 * Peripheral plugin entry — explicit side-effect registration (no import.meta.glob).
 * Import this module (or individual packages) to ensure builtins are registered.
 */
import { registry } from './registry';

import './led';
import './button';
import './oled';
import './ultrasonic';
import './motor_driver_stub';
import './dht22_stub';
import './buzzer_stub';
import './servo';

export { registry };
export { ObserveBuilderImpl } from './observe-builder';
export type {
  ObserveBuilder,
  ObserveFn,
  ObserveResult,
} from './observe-builder';
export type {
  PeripheralDefinition,
  PeripheralPinDef,
  PeripheralPropDef,
  PeripheralPropsSchema,
  PinConnectionValue,
  UnifiedPinDef,
} from './types';

export function getDefaultProps(type: string): Record<string, unknown> {
  return registry.getDefaultProps(type);
}

export function getDefaultPinConnections(type: string) {
  return registry.getDefaultPinConnections(type);
}

export function getComponentSize(type: string): { width: number; height: number } {
  return registry.getSize(type);
}
