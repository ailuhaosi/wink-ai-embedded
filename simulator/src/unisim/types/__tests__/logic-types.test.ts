import { DriveStrength, LogicState } from '../logic-types';

describe('LogicTypes', () => {
  test('DriveStrength enum matches spec values exactly', () => {
    expect(DriveStrength.SUPPLY).toBe(3);
    expect(DriveStrength.PULL).toBe(2);
    expect(DriveStrength.WEAK).toBe(1);
  });

  test('LogicState type includes all four values', () => {
    // Compile-time test: these assignments should not error
    const s0: LogicState = 0;
    const s1: LogicState = 1;
    const sZ: LogicState = 'Z';
    const sX: LogicState = 'X';
    expect([s0, s1, sZ, sX]).toHaveLength(4);
  });
});
