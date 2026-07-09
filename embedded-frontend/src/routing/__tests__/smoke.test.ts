import { describe, expect, it } from 'vitest';

describe('vitest smoke', () => {
  it('runs in node environment', () => {
    expect(1 + 1).toBe(2);
  });
});
