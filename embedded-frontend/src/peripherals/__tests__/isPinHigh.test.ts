import { describe, expect, it } from 'vitest';
import { isPinHigh } from '../types';

describe('isPinHigh', () => {
  it('handles boolean', () => {
    expect(isPinHigh(true)).toBe(true);
    expect(isPinHigh(false)).toBe(false);
  });

  it('coerces C/Worker 0/1 numbers (regression: level became undefined)', () => {
    expect(isPinHigh(0)).toBe(false);
    expect(isPinHigh(1)).toBe(true);
    expect(isPinHigh(2)).toBe(true);
  });

  it('reads PinSignalState.level', () => {
    expect(
      isPinHigh({ level: true, mode: 'output', pull: 'none' }),
    ).toBe(true);
    expect(
      isPinHigh({ level: false, mode: 'input', pull: 'up' }),
    ).toBe(false);
  });

  it('treats null/undefined as low', () => {
    expect(isPinHigh(undefined)).toBe(false);
    expect(isPinHigh(null)).toBe(false);
  });
});
