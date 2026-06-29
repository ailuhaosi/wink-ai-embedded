/**
 * UniSim - Unified Simulation Engine
 * Virtual Peripheral Subsystem (Phase 1)
 *
 * Public API Surface:
 * - PinArbiter: 4-value logic with strength-based arbitration
 * - PinManagerAdapter: Backward-compatible boolean interface
 * - PeripheralRegistry: Peripheral type registration and lifecycle management
 * - Peripheral types: Full type definitions for peripherals and drivers
 */

// Core classes
export { PinArbiter } from './core/pin-arbiter';
export { PinManagerAdapter } from './core/pin-manager-adapter';
export { PeripheralRegistry } from './core/peripheral-registry';

// Constants
export { LogicStates } from './types/logic-types';

// Type definitions
export type {
  LogicState,
  DriveStrength,
  PinDriver,
  PinState,
  PinChangeCallback,
  IPinArbiter,
} from './types/logic-types';

export type {
  PowerDomain,
  PinDirection,
  PeripheralPinMapping,
  PeripheralInstance,
  PeripheralDriver,
  PeripheralDriverFactory,
  PeripheralTypeDefinition,
  PeripheralRegistryEvent,
  RegistryEventHandler,
} from './types/peripheral-types';
