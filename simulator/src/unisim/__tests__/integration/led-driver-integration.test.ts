/**
 * Integration test: Corrected LED driver pattern from architecture review
 * Verifies:
 * - Peripheral pin registration pattern
 * - getResolvedVoltage() for analog brightness calculation
 * - Fault injection transparency (PinManager level)
 */
import { PinArbiter } from '../../core/pin-arbiter';
import { LogicStates, LogicState, DriveStrength } from '../../types/logic-types';

describe('LED Driver Integration - Corrected Pattern (per architecture review)', () => {
  let arbiter: PinArbiter;
  let mockLedElement: { value: boolean; brightness: number };

  beforeEach(() => {
    arbiter = new PinArbiter();
    mockLedElement = { value: false, brightness: 0 };
  });

  test('LED with anode + cathode voltage calculation', () => {
    const componentId = 'led-status';
    const anodePin = 13;
    const cathodePin = 14;

    // Register MCU GPIO drivers (as set up by simulator runtime)
    arbiter.setDriver(anodePin, {
      id: `mcu:gpio${anodePin}`,
      state: LogicStates.LOW,
      strength: DriveStrength.SUPPLY
    });
    arbiter.setDriver(cathodePin, {
      id: `mcu:gpio${cathodePin}`,
      state: LogicStates.LOW,
      strength: DriveStrength.SUPPLY
    });

    // The corrected LED driver pattern from architecture review:
    // Peripheral registers its pins with appropriate sink/source classification
    // Note: In real implementation, these would be registered by the board/pin mapper
    // Here we just use the arbiter to demonstrate the voltage calculation

    let cleanupCalled = false;

    const attachEvents = (element: typeof mockLedElement) => {
      const updateLed = () => {
        // Use getResolvedVoltage for accurate analog brightness
        const anodeVoltage = arbiter.getResolvedVoltage(anodePin);
        const cathodeVoltage = arbiter.getResolvedVoltage(cathodePin);

        // Consider LED forward voltage drop (~1.8V) and calculate brightness
        const voltageAcrossLed = Math.max(0, anodeVoltage - cathodeVoltage - 1.8);
        const brightness = Math.min(1, voltageAcrossLed / 1.5); // Non-linear curve

        element.value = brightness > 0.1;
        element.brightness = brightness;
      };

      const unsubAnode = arbiter.onPinChange(anodePin, updateLed);
      const unsubCathode = arbiter.onPinChange(cathodePin, updateLed);

      // Initial update
      updateLed();

      return () => {
        unsubAnode();
        unsubCathode();
        cleanupCalled = true;
      };
    };

    // Attach LED driver
    const cleanup = attachEvents(mockLedElement);

    // Initial state: both low → LED off
    expect(mockLedElement.value).toBe(false);
    expect(mockLedElement.brightness).toBe(0);

    // Anode high, cathode low → LED on
    arbiter.setDriver(anodePin, {
      id: `mcu:gpio${anodePin}`,
      state: LogicStates.HIGH,
      strength: DriveStrength.SUPPLY
    });
    expect(mockLedElement.value).toBe(true);
    expect(mockLedElement.brightness).toBeGreaterThan(0);

    // Both high → no voltage difference → LED off
    arbiter.setDriver(cathodePin, {
      id: `mcu:gpio${cathodePin}`,
      state: LogicStates.HIGH,
      strength: DriveStrength.SUPPLY
    });
    expect(mockLedElement.value).toBe(false);

    // Cleanup
    cleanup();
    expect(cleanupCalled).toBe(true);
  });

  test('fault injection transparency: disconnect simulates wire break', () => {
    const anodePin = 5;
    let brightness = 0;

    const updateBrightness = () => {
      const voltage = arbiter.getResolvedVoltage(anodePin);
      brightness = Math.min(1, Math.max(0, (voltage - 1.8) / 1.5));
    };

    // Normal operation: MCU drives high
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: LogicStates.HIGH,
      strength: DriveStrength.SUPPLY
    });

    const unsub = arbiter.onPinChange(anodePin, updateBrightness);
    updateBrightness(); // Initial update

    // Initial brightness
    expect(brightness).toBeGreaterThan(0);

    // Fault injection: "disconnect" wire (simulated at PinManager level)
    // This is done by replacing the MCU driver with Hi-Z (peripheral sees Z)
    // In real fault framework, this is handled by the fault injection middleware
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: LogicStates.HI_Z, // Disconnected = high-impedance
      strength: DriveStrength.SUPPLY
    });

    // LED sees floating pin → brightness drops to 0
    expect(brightness).toBe(0);

    // Restore connection
    arbiter.setDriver(anodePin, {
      id: 'mcu:gpio5',
      state: LogicStates.HIGH,
      strength: DriveStrength.SUPPLY
    });
    expect(brightness).toBeGreaterThan(0);

    unsub();
  });
});
