import { PinArbiter } from '../pin-arbiter';
import { LogicStates, LogicState, DriveStrength } from '../../types/logic-types';

describe('PinArbiter - Core Algorithm', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('single SUPPLY driver resolves to its state', () => {
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(5)).toBe(LogicStates.HIGH);
  });

  test('no drivers on pin resolves to Z (high-impedance)', () => {
    expect(arbiter.readPin(99)).toBe(LogicStates.HI_Z);
  });

  test('driver with state Z is ignored (high-impedance does not drive)', () => {
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HI_Z, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(5)).toBe(LogicStates.HI_Z);
  });

  test('two SUPPLY drivers with same state resolve to that state', () => {
    arbiter.setDriver(3, { id: 'mcu:gpio3', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(3, { id: 'led:anode', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(3)).toBe(LogicStates.HIGH);
  });

  test('two SUPPLY drivers with conflicting states resolve to X (contention)', () => {
    arbiter.setDriver(3, { id: 'mcu:gpio3', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(3, { id: 'led:anode', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(3)).toBe(LogicStates.CONFLICT);
  });

  test('SUPPLY driver overrides WEAK driver (strength wins)', () => {
    arbiter.setDriver(7, { id: 'mcu:weak-pullup', state: LogicStates.HIGH, strength: DriveStrength.WEAK });
    arbiter.setDriver(7, { id: 'sensor:output', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(7)).toBe(LogicStates.LOW); // SUPPLY (3) > WEAK (1)
  });

  test('PULL resistor overrides WEAK pull-up', () => {
    arbiter.setDriver(2, { id: 'internal:pullup', state: LogicStates.HIGH, strength: DriveStrength.WEAK });
    arbiter.setDriver(2, { id: 'external:pulldown', state: LogicStates.LOW, strength: DriveStrength.PULL });
    expect(arbiter.readPin(2)).toBe(LogicStates.LOW); // PULL (2) > WEAK (1)
  });

  test('open-drain I2C wire-AND: pull-up high + MCU low = 0', () => {
    // I2C bus: external PULL resistor keeps high, MCU pulls low via open-drain
    arbiter.setDriver(6, { id: 'i2c:pullup', state: LogicStates.HIGH, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu:sda', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(6)).toBe(LogicStates.LOW); // Wire-AND: MCU low wins
  });

  test('open-drain I2C wire-AND: pull-up high + MCU Z = 1', () => {
    arbiter.setDriver(6, { id: 'i2c:pullup', state: LogicStates.HIGH, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu:sda', state: LogicStates.HI_Z, strength: DriveStrength.SUPPLY });
    expect(arbiter.readPin(6)).toBe(LogicStates.HIGH); // Pull-up wins
  });

  test('removeDriver removes specific driver, others remain', () => {
    arbiter.setDriver(4, { id: 'mcu:gpio4', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(4, { id: 'periph:pin', state: LogicStates.LOW, strength: DriveStrength.WEAK });
    expect(arbiter.readPin(4)).toBe(LogicStates.HIGH); // SUPPLY wins

    arbiter.removeDriver(4, 'mcu:gpio4');
    expect(arbiter.readPin(4)).toBe(LogicStates.LOW); // Only WEAK remains
  });

  test('removeDriver on non-existent driver does nothing', () => {
    arbiter.setDriver(5, { id: 'real:driver', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(() => arbiter.removeDriver(5, 'nonexistent:driver')).not.toThrow();
    expect(arbiter.readPin(5)).toBe(LogicStates.HIGH);
  });

  test('getDrivers returns all registered drivers for pin', () => {
    arbiter.setDriver(8, { id: 'd1', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(8, { id: 'd2', state: LogicStates.LOW, strength: DriveStrength.PULL });
    const drivers = arbiter.getDrivers(8);
    expect(drivers).toHaveLength(2);
    expect(drivers.map(d => d.id).sort()).toEqual(['d1', 'd2']);
  });

  test('getDrivers on empty pin returns empty array', () => {
    expect(arbiter.getDrivers(999)).toEqual([]);
  });
});

describe('PinArbiter - Change Notifications', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('onPinChange callback fires when pin state changes', () => {
    const callback = jest.fn();
    arbiter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledWith(5, 1);
  });

  test('callback does NOT fire when state does not change', () => {
    const callback = jest.fn();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    arbiter.onPinChange(5, callback);

    // Update driver with same state - no resolution change
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(callback).not.toHaveBeenCalled();
  });

  test('unsubscribe stops further notifications', () => {
    const callback = jest.fn();
    const unsubscribe = arbiter.onPinChange(5, callback);

    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    arbiter.setDriver(5, { id: 'mcu:gpio5', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(callback).toHaveBeenCalledTimes(1); // No additional call
  });

  test('multiple independent listeners for same pin', () => {
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    arbiter.onPinChange(3, cb1);
    arbiter.onPinChange(3, cb2);

    arbiter.setDriver(3, { id: 'mcu:gpio3', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(cb1).toHaveBeenCalledWith(3, 0);
    expect(cb2).toHaveBeenCalledWith(3, 0);
  });

  test('listener exception does not break other listeners or simulation', () => {
    const badCb = jest.fn(() => { throw new Error('Bad listener!'); });
    const goodCb = jest.fn();
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    arbiter.onPinChange(7, badCb);
    arbiter.onPinChange(7, goodCb);

    expect(() => {
      arbiter.setDriver(7, { id: 'mcu:gpio7', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    }).not.toThrow();

    expect(goodCb).toHaveBeenCalled(); // Good listener still called
    expect(consoleSpy).toHaveBeenCalled(); // Warning logged
    consoleSpy.mockRestore();
  });

  test('infinite loop callback recursion is caught and terminated', () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Pin A updates Pin B, Pin B updates Pin A -> infinite recursion loop
    arbiter.onPinChange(1, (pin, state) => {
      arbiter.setDriver(2, { id: 'loop:b', state: state, strength: DriveStrength.SUPPLY });
    });
    arbiter.onPinChange(2, (pin, state) => {
      arbiter.setDriver(1, { id: 'loop:a', state: state === 1 ? 0 : 1, strength: DriveStrength.SUPPLY });
    });

    expect(() => {
      arbiter.setDriver(1, { id: 'loop:start', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    }).not.toThrow();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('maxRecursionDepth')
    );
    consoleSpy.mockRestore();
  });
});

describe('PinArbiter - Voltage Estimation', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('logic high returns 3.3V', () => {
    arbiter.setDriver(1, { id: 'd1', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(1)).toBe(3.3);
  });

  test('logic low returns 0.0V', () => {
    arbiter.setDriver(1, { id: 'd1', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(1)).toBe(0.0);
  });

  test('contention (X) returns 1.65V midpoint', () => {
    arbiter.setDriver(2, { id: 'd1', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(2, { id: 'd2', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });
    expect(arbiter.getResolvedVoltage(2)).toBe(1.65);
  });

  test('high-impedance (Z) returns 0.0V', () => {
    expect(arbiter.getResolvedVoltage(99)).toBe(0.0);
  });
});

describe('PinArbiter - Complex Multi-Driver Scenarios', () => {
  let arbiter: PinArbiter;

  beforeEach(() => {
    arbiter = new PinArbiter();
  });

  test('I2C multi-master arbitration: two MCUs, one pulls low', () => {
    // Two MCU masters + one pull-up resistor
    arbiter.setDriver(6, { id: 'i2c:pullup', state: LogicStates.HIGH, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu1:sda', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'mcu2:sda', state: LogicStates.HI_Z, strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(6)).toBe(LogicStates.LOW); // MCU1 low wins wire-AND
  });

  test('I2C multi-master contention: both MCUs drive opposite', () => {
    arbiter.setDriver(6, { id: 'i2c:pullup', state: LogicStates.HIGH, strength: DriveStrength.PULL });
    arbiter.setDriver(6, { id: 'mcu1:sda', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(6, { id: 'mcu2:sda', state: LogicStates.HIGH, strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(6)).toBe(LogicStates.CONFLICT); // Two SUPPLY drivers conflict → X
  });

  test('three strength levels: WEAK < PULL < SUPPLY', () => {
    arbiter.setDriver(4, { id: 'weak', state: LogicStates.LOW, strength: DriveStrength.WEAK });
    arbiter.setDriver(4, { id: 'pull', state: LogicStates.HIGH, strength: DriveStrength.PULL });
    arbiter.setDriver(4, { id: 'supply', state: LogicStates.LOW, strength: DriveStrength.SUPPLY });

    expect(arbiter.readPin(4)).toBe(LogicStates.LOW); // SUPPLY wins
  });

  test('all Z drivers resolve to Z', () => {
    arbiter.setDriver(5, { id: 'd1', state: LogicStates.HI_Z, strength: DriveStrength.SUPPLY });
    arbiter.setDriver(5, { id: 'd2', state: LogicStates.HI_Z, strength: DriveStrength.PULL });
    expect(arbiter.readPin(5)).toBe(LogicStates.HI_Z);
  });
});
