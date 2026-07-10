import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  isOnboardingCompleted,
  markOnboardingCompleted,
  resetOnboarding,
} from '../useOnboarding';

const store = new Map<string, string>();

const localStorageMock = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => store.clear(),
};

describe('useOnboarding (A18)', () => {
  beforeEach(() => {
    store.clear();
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });
  });

  afterEach(() => {
    store.clear();
  });

  it('defaults to not completed', () => {
    expect(isOnboardingCompleted()).toBe(false);
  });

  it('writes wink_onboarding_completed on mark', () => {
    markOnboardingCompleted();
    expect(localStorage.getItem('wink_onboarding_completed')).toBe('true');
    expect(isOnboardingCompleted()).toBe(true);
  });

  it('clears flag on reset (replay guide)', () => {
    markOnboardingCompleted();
    resetOnboarding();
    expect(isOnboardingCompleted()).toBe(false);
    expect(localStorage.getItem('wink_onboarding_completed')).toBeNull();
  });
});
