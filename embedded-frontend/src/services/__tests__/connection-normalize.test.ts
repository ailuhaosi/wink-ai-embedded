import { describe, expect, it } from 'vitest';
import {
  formatPinRef,
  normalizeConnectionForCanvas,
  normalizeConnectionForPersist,
  parsePinRef,
} from '@/services/connection-normalize';
import type { ConnectionEntry } from '@/types/manifest-v2';

describe('connection-normalize', () => {
  const base: ConnectionEntry = {
    id: 'c1',
    from: { componentId: 'radar', pin: 'TRIG' },
    to: { componentId: '__board__esp32-devkit-v1', pin: 'GPIO4' },
    routing: { mode: 'orthogonal' },
  };

  it('formatPinRef and parsePinRef round-trip', () => {
    const s = formatPinRef({ componentId: 'a', pin: 'TRIG' });
    expect(s).toBe('a:TRIG');
    expect(parsePinRef(s)).toEqual({ componentId: 'a', pin: 'TRIG' });
  });

  it('normalizeConnectionForCanvas converts objects to strings', () => {
    const canvas = normalizeConnectionForCanvas(base);
    expect(canvas.from).toBe('radar:TRIG');
    expect(canvas.to).toBe('__board__esp32-devkit-v1:GPIO4');
  });

  it('normalizeConnectionForPersist converts strings to objects', () => {
    const canvas = normalizeConnectionForCanvas(base);
    const persisted = normalizeConnectionForPersist(canvas);
    expect(persisted.from).toEqual({ componentId: 'radar', pin: 'TRIG' });
    expect(persisted.to).toEqual({ componentId: '__board__esp32-devkit-v1', pin: 'GPIO4' });
  });
});
