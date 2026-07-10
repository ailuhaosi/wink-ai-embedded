import { describe, expect, it } from 'vitest';
import { registry } from '@/peripherals/registry';
import { templateDefinition } from '../_template/definition';
import type { PeripheralDefinition } from '../types';

describe('template contract', () => {
  it('satisfies PeripheralDefinition type', () => {
    const _: PeripheralDefinition = templateDefinition;
    expect(_).toBeDefined();
  });

  it('has all required fields', () => {
    expect(templateDefinition.type).toBeDefined();
    expect(templateDefinition.displayName).toBeDefined();
    expect(templateDefinition.category).toBeDefined();
    expect(templateDefinition.size).toBeDefined();
    expect(templateDefinition.pins).toBeDefined();
    expect(templateDefinition.props).toBeDefined();
  });

  it('is not registered in the production registry', () => {
    expect(registry.get(templateDefinition.type)).toBeUndefined();
  });
});
