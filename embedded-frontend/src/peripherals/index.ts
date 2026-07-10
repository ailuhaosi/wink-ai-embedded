/**
 * Peripheral plugin entry — explicit side-effect registration (no import.meta.glob).
 * Import this module (or individual packages) to ensure builtins are registered.
 */
export { registry } from './registry';
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
} from './types';
export {
  peripheralConfigsAdapter,
  getDefaultProps,
  getDefaultPinConnections,
  getComponentSize,
} from './legacy-adapter';

import './led';
import './button';
import './oled';
import './ultrasonic';
