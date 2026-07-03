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
export type { WasmImports } from './types/wasm/imports';
export type { WasmInterruptQueue, PendingInterrupt } from './types/wasm/interrupt-queue';
export { VirtualClock, VirtualClockResetError } from './core/VirtualClock';

// Runtime object contracts (Phase B B1)
export type {
  I2CDevice,
  I2CTransferResult,
  I2CBusApi,
} from './types/runtime/i2c';
export type {
  FaultAuditLogEvent,
  FaultDomainControl,
  FaultEventTypeCode,
} from './types/runtime/fault';

// Phase B B2 bridge exports
export { I2CBus } from './bridge/I2CBus';
export { InterruptQueue, INTERRUPT_QUEUE_CAPACITY } from './bridge/InterruptQueue';
export { createUnisimImports } from './bridge/createUnisimImports';
export type { UnisimBridgeDeps } from './bridge/createUnisimImports';
export { installUnisimBridge } from './bridge/installUnisimBridge';
export type { EmscriptenModuleLike } from './bridge/installUnisimBridge';
