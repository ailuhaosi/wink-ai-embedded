/**
 * 4-value logic state constants (SystemVerilog inspired)
 * Use these constants instead of literal values for type safety and IDE autocomplete
 */
export const LogicStates = {
  /** Logic low level (0V) */
  LOW: 0 as const,
  /** Logic high level (3.3V) */
  HIGH: 1 as const,
  /** High-impedance / floating state */
  HI_Z: 'Z' as const,
  /** Bus conflict / unknown state */
  CONFLICT: 'X' as const,
} as const;

/**
 * 4-value logic state type (derived from constants)
 * 0 = low, 1 = high, 'Z' = high-impedance floating, 'X' = unknown/contention
 */
export type LogicState = typeof LogicStates[keyof typeof LogicStates];

/**
 * Drive strength levels for pin arbitration (from strongest to weakest)
 * SUPPLY: Direct power connection (VCC/GND) or push-pull GPIO output
 * PULL: Resistor pull-up/pull-down (e.g., I2C bus external 4.7kΩ resistors)
 * WEAK: Weak internal pull-up, open-drain release state, or floating input
 */
export enum DriveStrength {
  SUPPLY = 3,
  PULL = 2,
  WEAK = 1,
}

/**
 * A single driver contributing to a pin's state
 * Multiple drivers can be registered to the same pin (wire-AND topology)
 */
export interface PinDriver {
  /** Unique driver ID (format: `${componentType}:${componentId}:${pinName}` or `mcu:gpio${pin}`) */
  id: string;
  /** Current logic state driven by this source */
  state: LogicState;
  /** Drive strength of this source */
  strength: DriveStrength;
}

/**
 * Resolved pin state after arbitration across all drivers
 */
export interface PinState {
  /** Final resolved logic state after applying strength-based arbitration */
  resolvedState: LogicState;
  /** All registered drivers contributing to this pin */
  drivers: Map<string, PinDriver>;
}

/**
 * Pin change callback signature
 */
export type PinChangeCallback = (pinNumber: number, newState: LogicState) => void;

/**
 * PinArbiter public interface
 */
export interface IPinArbiter {
  /** Register or update a driver for a specific pin */
  setDriver(pinNumber: number, driver: PinDriver): void;
  /** Remove a driver from a pin (e.g., peripheral detached, Hi-Z state) */
  removeDriver(pinNumber: number, driverId: string): void;
  /** Read the resolved logic state of a pin */
  readPin(pinNumber: number): LogicState;
  /** Read estimated voltage (0V-3.3V) for analog components (LED brightness, etc.) */
  getResolvedVoltage(pinNumber: number): number;
  /** Subscribe to pin state changes */
  onPinChange(pinNumber: number, callback: PinChangeCallback): () => void;
  /** Get all drivers for a pin (diagnostic/debug use only) */
  getDrivers(pinNumber: number): PinDriver[];
}
