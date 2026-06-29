import { LogicState, DriveStrength, PinDriver, PinState, PinChangeCallback, IPinArbiter } from '../types/logic-types';

export class PinArbiter implements IPinArbiter {
  private pinStates = new Map<number, PinState>();
  private changeListeners = new Map<number, Set<PinChangeCallback>>();
  private notifyingPins = new Set<number>();
  private recursionCounters = new Map<number, number>();

  setDriver(pinNumber: number, driver: PinDriver): void {
    let pinState = this.pinStates.get(pinNumber);
    if (!pinState) {
      pinState = {
        resolvedState: LogicState.HI_Z,
        drivers: new Map(),
      };
      this.pinStates.set(pinNumber, pinState);
    }

    const oldResolved = pinState.resolvedState;
    pinState.drivers.set(driver.id, driver);
    pinState.resolvedState = this.resolvePinState(pinState.drivers);

    if (oldResolved !== pinState.resolvedState) {
      this.notifyPinChange(pinNumber, pinState.resolvedState);
    }
  }

  removeDriver(pinNumber: number, driverId: string): void {
    const pinState = this.pinStates.get(pinNumber);
    if (!pinState) return;

    const oldResolved = pinState.resolvedState;
    pinState.drivers.delete(driverId);
    pinState.resolvedState = this.resolvePinState(pinState.drivers);

    if (oldResolved !== pinState.resolvedState) {
      this.notifyPinChange(pinNumber, pinState.resolvedState);
    }
  }

  readPin(pinNumber: number): LogicState {
    const pinState = this.pinStates.get(pinNumber);
    return pinState ? pinState.resolvedState : LogicState.HI_Z;
  }

  getResolvedVoltage(pinNumber: number): number {
    const state = this.readPin(pinNumber);
    switch (state) {
      case LogicState.HIGH: return 3.3;
      case LogicState.LOW: return 0.0;
      case LogicState.CONFLICT: return 1.65; // Contention mid-point (for LED brightness calculation)
      case LogicState.HI_Z: default: return 0.0; // Floating defaults to 0V (component-specific handling can override)
    }
  }

  onPinChange(pinNumber: number, callback: PinChangeCallback): () => void {
    if (!this.changeListeners.has(pinNumber)) {
      this.changeListeners.set(pinNumber, new Set());
    }
    const listeners = this.changeListeners.get(pinNumber)!;
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  getDrivers(pinNumber: number): PinDriver[] {
    const pinState = this.pinStates.get(pinNumber);
    return pinState ? Array.from(pinState.drivers.values()) : [];
  }

  /**
   * Strength-based arbitration algorithm
   * Algorithm rules (in priority order):
   * 1. Ignore all drivers with state HI_Z (high-impedance doesn't drive)
   * 2. Find max strength among remaining active drivers
   * 3. If all max-strength drivers agree on state → that state wins
   * 4. If max-strength drivers disagree → CONFLICT (contention/unknown)
   * 5. If no active drivers → HI_Z (floating)
   */
  private resolvePinState(drivers: Map<string, PinDriver>): LogicState {
    if (drivers.size === 0) return LogicState.HI_Z;

    let maxStrength = -1;
    let activeDrivers: PinDriver[] = [];

    // Collect non-HI_Z drivers and find max strength
    for (const [, drv] of drivers) {
      if (drv.state === LogicState.HI_Z) continue; // Hi-Z drivers don't contribute
      activeDrivers.push(drv);
      if (drv.strength > maxStrength) {
        maxStrength = drv.strength;
      }
    }

    if (activeDrivers.length === 0) return LogicState.HI_Z; // All drivers are Hi-Z

    // Filter to only max-strength drivers
    const maxStrengthDrivers = activeDrivers.filter(d => d.strength === maxStrength);

    // Check for contention among max-strength drivers
    const firstState = maxStrengthDrivers[0].state;
    const allAgree = maxStrengthDrivers.every(d => d.state === firstState);

    if (!allAgree) return LogicState.CONFLICT; // Contention: strongest drivers disagree

    return firstState;
  }

  private notifyPinChange(pinNumber: number, newState: LogicState): void {
    const listeners = this.changeListeners.get(pinNumber);
    if (!listeners) return;

    // Prevent infinite recursion loops from mutual pin state updates
    if (this.notifyingPins.has(pinNumber)) {
      const depth = (this.recursionCounters.get(pinNumber) ?? 0) + 1;
      this.recursionCounters.set(pinNumber, depth);
      if (depth > 10) {
        console.warn(`[PinArbiter] Infinite event loop detected on pin ${pinNumber}. Aborting recursion cascade.`);
        return;
      }
    } else {
      this.notifyingPins.add(pinNumber);
      this.recursionCounters.set(pinNumber, 0);
    }

    try {
      listeners.forEach(cb => {
        try {
          cb(pinNumber, newState);
        } catch (e) {
          // Swallow listener errors to prevent one bad listener from breaking simulation
          console.warn(`[PinArbiter] Error in pin change listener for pin ${pinNumber}:`, e);
        }
      });
    } finally {
      this.notifyingPins.delete(pinNumber);
      this.recursionCounters.delete(pinNumber);
    }
  }
}
