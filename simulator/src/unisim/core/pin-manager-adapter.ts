import { PinArbiter } from './pin-arbiter';
import { LogicState, DriveStrength } from '../types/logic-types';

/**
 * Legacy PinManager interface adapter
 * Maintains 100% backward compatibility with existing boolean-based PinManager API
 * Conversion rules:
 * - LogicState HIGH (1) → true
 * - LogicState LOW (0), HI_Z ('Z'), CONFLICT ('X') → false (conservative: uncertain states read as low)
 *
 * This adapter allows all existing peripheral drivers to work without modification
 * while new drivers can use the full PinArbiter 4-value logic interface directly.
 */
export class PinManagerAdapter {
  private analogVoltages = new Map<number, number>();
  private pwmListeners = new Map<number, Set<(duty: number) => void>>();

  constructor(private arbiter: PinArbiter) {}

  /**
   * Read pin state as boolean (legacy interface)
   * Returns true only for definite logic high (state === HIGH)
   */
  readPin(pinNumber: number): boolean {
    return this.arbiter.readPin(pinNumber) === 1;
  }

  /**
   * Set pin input state as boolean (legacy interface)
   * Simulates legacy drivers driving a pin (e.g. pushbutton pulling low or high)
   */
  setPinInput(pinNumber: number, value: boolean): void {
    const state = value ? 1 : 0;
    this.arbiter.setDriver(pinNumber, {
      id: `legacy:input:${pinNumber}`,
      state: state as LogicState,
      strength: DriveStrength.SUPPLY
    });
  }

  /**
   * Update analog voltage on a pin (legacy interface)
   */
  updateAnalogVoltage(pinNumber: number, voltage: number): void {
    this.analogVoltages.set(pinNumber, voltage);
    // Drive the digital representation: voltage > 1.65V -> high, else low
    const digitalState = voltage > 1.65 ? 1 : 0;
    this.arbiter.setDriver(pinNumber, {
      id: `legacy:analog:${pinNumber}`,
      state: digitalState as LogicState,
      strength: DriveStrength.SUPPLY
    });
  }

  /**
   * Get analog voltage on a pin (legacy interface helper)
   */
  getAnalogVoltage(pinNumber: number): number {
    return this.analogVoltages.get(pinNumber) ?? this.arbiter.getResolvedVoltage(pinNumber);
  }

  /**
   * Subscribe to pin changes with boolean state (legacy interface)
   */
  onPinChange(pinNumber: number, callback: (pin: number, state: boolean) => void): () => void {
    return this.arbiter.onPinChange(pinNumber, (pin, state) => {
      callback(pin, state === 1);
    });
  }

  /**
   * Register legacy PWM callback
   */
  onPwmChange(channel: number, callback: (duty: number) => void): () => void {
    if (!this.pwmListeners.has(channel)) {
      this.pwmListeners.set(channel, new Set());
    }
    const listeners = this.pwmListeners.get(channel)!;
    listeners.add(callback);
    return () => listeners.delete(callback);
  }

  /**
   * Trigger PWM change (simulator runtime helper)
   */
  triggerPwmChange(channel: number, dutyCycle: number): void {
    const listeners = this.pwmListeners.get(channel);
    if (listeners) {
      listeners.forEach(cb => {
        try {
          cb(dutyCycle);
        } catch (e) {
          console.warn(`[PinManagerAdapter] Error in PWM listener for channel ${channel}:`, e);
        }
      });
    }
  }

  /**
   * Access the underlying PinArbiter for advanced 4-value logic operations
   * New drivers should use this directly
   */
  getArbiter(): PinArbiter {
    return this.arbiter;
  }
}
