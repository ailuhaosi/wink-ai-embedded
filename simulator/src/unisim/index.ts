/**
 * UniSim - Unified Simulation Engine
 * Virtual Peripheral Subsystem (Phase 1)
 *
 * Public API Surface:
 * - PinArbiter: 4-value logic with strength-based arbitration (native API)
 * - PeripheralRegistry: Peripheral type registration and lifecycle management
 * - Peripheral types: Full type definitions for peripherals and drivers
 *
 * Architecture principle: No backward compatibility layers - pure best practice design
 */

// Core classes
export { PinArbiter } from './core/pin-arbiter';
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

// Wasm boundary contracts (Phase B B1)
export type { WasmExports, PalI2cTransferMarshalled } from './types/wasm/exports';
export { VirtualClock, VirtualClockResetError } from './core/VirtualClock';
