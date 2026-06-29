import { PinManagerAdapter } from '../pin-manager-adapter';
import { PinArbiter } from '../pin-arbiter';
import { DriveStrength } from '../../types/logic-types';

describe('PinManagerAdapter - Backward Compatibility', () => {
  let arbiter: PinArbiter;
  let adapter: PinManagerAdapter;

  beforeEach(() => {
    arbiter = new PinArbiter();
    adapter = new PinManagerAdapter(arbiter);
  });

  test('readPin returns boolean (true for HIGH, false for LOW/HI_Z/CONFLICT)', () => {
    // Logic HIGH -> true
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(5)).toBe(true);

    // Logic LOW -> false
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(5)).toBe(false);

    // HI_Z (high-impedance) -> false
    arbiter.removeDriver(5, 'mcu:gpio5');
    expect(adapter.readPin(5)).toBe(false);

    // CONFLICT (X state) -> false
    arbiter.setDriver(6, { id: 'd1', state: 0, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'd2', state: 1, strength: DriveStrength.SUPPLY });
    expect(adapter.readPin(6)).toBe(false);
  });

  test('setPinInput drives pin as Supply strength low/high', () => {
    adapter.setPinInput(7, true); // Drive HIGH
    expect(arbiter.readPin(7)).toBe(1);

    adapter.setPinInput(7, false); // Drive LOW
    expect(arbiter.readPin(7)).toBe(0);
  });

  test('updateAnalogVoltage and getAnalogVoltage function correctly', () => {
    adapter.updateAnalogVoltage(8, 2.5);
    expect(adapter.getAnalogVoltage(8)).toBe(2.5);
    // Should also drive digital state (voltage > 1.65 is high)
    expect(arbiter.readPin(8)).toBe(1);

    adapter.updateAnalogVoltage(8, 1.2);
    expect(adapter.getAnalogVoltage(8)).toBe(1.2);
    expect(arbiter.readPin(8)).toBe(0);
  });

  test('onPwmChange registers and triggers PWM callbacks', () => {
    const pwmCallback = jest.fn();
    adapter.onPwmChange(1, pwmCallback);

    adapter.triggerPwmChange(1, 50);
    expect(pwmCallback).toHaveBeenCalledWith(50);
  });

  test('onPinChange callback receives boolean state', () => {
    const callback = jest.fn();
    adapter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, true);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, false);
  });

  test('unsubscribe stops further notifications', () => {
    const callback = jest.fn();
    const unsubscribe = adapter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 1, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: 0, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1); // No additional call
  });

  test('adapter passes through to underlying arbiter', () => {
    // LED driver scenario matches existing spec code
    const ledCallback = jest.fn();
    adapter.onPinChange(3, ledCallback);

    arbiter.setDriver(3, { id: 'mcu:gpio3', state: 1, strength: DriveStrength.SUPPLY });
    expect(ledCallback).toHaveBeenCalledWith(3, true);

    arbiter.setDriver(3, { id: 'led:cathode', state: 0, strength: DriveStrength.SUPPLY });
    // Two SUPPLY drivers in conflict -> X -> false
    expect(ledCallback).toHaveBeenLastCalledWith(3, false);
  });

  test('existing LED driver pattern works without modification', () => {
    // Simulate the exact LED driver pattern from spec:
    // const anodeLevel = gpioPin !== null ? pinManager.readPin(gpioPin) : false;
    let ledValue = false;

    adapter.onPinChange(13, (pin, state) => {
      ledValue = state; // boolean assignment, exactly like existing code
    });

    // GPIO high -> LED on
    arbiter.setDriver(13, { id: 'mcu:gpio13', state: 1, strength: DriveStrength.SUPPLY });
    expect(ledValue).toBe(true);

    // GPIO low -> LED off
    arbiter.setDriver(13, { id: 'mcu:gpio13', state: 0, strength: DriveStrength.SUPPLY });
    expect(ledValue).toBe(false);
  });

  test('getArbiter returns the underlying PinArbiter instance', () => {
    expect(adapter.getArbiter()).toBe(arbiter);
  });

  test('PWM callback error does not crash other callbacks', () => {
    const badCb = jest.fn(() => { throw new Error('Bad callback!'); });
    const goodCb = jest.fn();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    adapter.onPwmChange(2, badCb);
    adapter.onPwmChange(2, goodCb);

    expect(() => {
      adapter.triggerPwmChange(2, 75);
    }).not.toThrow();

    expect(goodCb).toHaveBeenCalledWith(75);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
