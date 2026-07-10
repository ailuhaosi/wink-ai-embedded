import { describe, expect, it } from 'vitest';
import { cloneFaultsConfig } from '@/services/simulation-client';
import type { SimFaultsConfig } from '@/services/simulation-client';

describe('cloneFaultsConfig', () => {
  it('returns a plain object cloneable via structuredClone', () => {
    const reactiveLike = new Proxy(
      {
        bounce_us: 1000,
        warmup_us: 0,
        sample_interval_us: 1000,
        adc_noise_v: 0,
        rc_tau_s: 0,
        i2c_drop_permil: 200,
        prng_seed: 1,
      } satisfies SimFaultsConfig,
      {},
    );

    const plain = cloneFaultsConfig(reactiveLike);
    expect(() => structuredClone(plain)).not.toThrow();
    expect(plain.bounce_us).toBe(1000);
    expect(plain.i2c_drop_permil).toBe(200);
  });
});
