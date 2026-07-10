import { describe, expect, it } from 'vitest';
import type {
  SimWorkerInbound,
  SimWorkerOutbound,
} from '../sim-worker-protocol';
import {
  SimWorkerInboundType,
  SimWorkerOutboundType,
} from '../sim-worker-protocol';

describe('sim-worker-protocol', () => {
  it('accepts INIT inbound and INIT_DONE outbound shapes', () => {
    const inbound = { type: SimWorkerInboundType.INIT } satisfies SimWorkerInbound;
    const outbound = { type: SimWorkerOutboundType.INIT_DONE } satisfies SimWorkerOutbound;
    expect(inbound.type).toBe('INIT');
    expect(outbound.type).toBe('INIT_DONE');
  });

  it('accepts STATE_UPDATE golden payload', () => {
    const msg = {
      type: SimWorkerOutboundType.STATE_UPDATE,
      payload: {
        us: '1000',
        pinStates: { 13: true },
        oledFb: null,
        traces: [{ timestamp: 1, type: 0, pinOrBus: 13, sequence: 1 }],
        isFaulted: false,
      },
    } satisfies SimWorkerOutbound;

    expect(msg.payload.pinStates[13]).toBe(true);
    expect(msg.payload.isFaulted).toBe(false);
  });

  it('accepts ERROR outbound shape', () => {
    const msg = {
      type: SimWorkerOutboundType.ERROR,
      message: 'wasm load failed',
    } satisfies SimWorkerOutbound;
    expect(msg.message).toContain('wasm');
  });

  it('accepts SET_FAULTS inbound shape', () => {
    const msg = {
      type: SimWorkerInboundType.SET_FAULTS,
      payload: {
        bounce_us: 0,
        warmup_us: 0,
        sample_interval_us: 1000,
        adc_noise_v: 0,
        rc_tau_s: 0,
        i2c_drop_permil: 0,
        prng_seed: 1,
      },
    } satisfies SimWorkerInbound;
    expect(msg.payload.sample_interval_us).toBe(1000);
  });
});
