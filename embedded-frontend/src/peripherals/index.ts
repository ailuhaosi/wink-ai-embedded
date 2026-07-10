/**
 * Peripheral plugin entry — explicit side-effect registration (no import.meta.glob).
 * Import this module (or individual packages) to ensure builtins are registered.
 */
export { registry } from './registry';
export type {
  PeripheralDefinition,
  PeripheralPinDef,
  PeripheralPropDef,
  PeripheralPropsSchema,
  PinConnectionValue,
} from './types';

import './led';
import './button';
import './oled';
import './ultrasonic';
