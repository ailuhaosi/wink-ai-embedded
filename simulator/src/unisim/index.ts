/**
 * UniSim - Unified Simulation Engine
 * Pin Arbitration Subsystem (Phase 0)
 *
 * Public API Surface:
 * - PinArbiter: 4-value logic with strength-based arbitration (new API)
 * - PinManagerAdapter: backward-compatible boolean interface (existing code)
 * - Types: LogicState, DriveStrength, PinDriver, IPinArbiter
 */

// Core classes
export { PinArbiter } from './core/pin-arbiter';
export { PinManagerAdapter } from './core/pin-manager-adapter';

// Type definitions
export type {
  LogicState,
  DriveStrength,
  PinDriver,
  PinState,
  PinChangeCallback,
  IPinArbiter,
} from './types/logic-types';
