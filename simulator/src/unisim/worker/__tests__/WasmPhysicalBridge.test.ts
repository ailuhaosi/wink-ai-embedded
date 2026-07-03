/**
 * WasmPhysicalBridge.test.ts — Jest coverage for the ADR-0009 Wave 2 bridge.
 *
 * Test goals (per plan §5.5.3):
 *   1. JSON config fields map 1:1 onto the C setters (string-key tracing).
 *   2. The virtual clock is bigint on both JS and (mocked) WASM sides.
 *   3. Degraded pin reads exercise the mocked debounce — JS-side `setGpioIdeal`
 *      drives the mock which the bridge then reads back through `pal_gpio_read`.
 *   4. OOB pin numbers do not throw, matching the C-side `pal_wasm_get_debounce_ctx`
 *      NULL-fallthrough behaviour.
 */
import { VirtualClock } from '../../core/VirtualClock';
import {
  WasmPhysicalBridge,
  SimFaultsConfig,
} from '../WasmPhysicalBridge';
import type { WasmExports } from '../../types/wasm/exports';
import { SimWorker, SimWorkerRequest, SimWorkerResponse, OkResponse } from '../SimWorker';

// ---------------------------------------------------------------------------
// Test double: records every call and lets us script `pal_gpio_read` returns.
// ---------------------------------------------------------------------------
interface MockState {
  bounce_us: number;
  warmup_us: number;
  sample_interval_us: number;
  adc_noise_v: number;
  rc_tau_s: number;
  i2c_drop_permil: number;
  prng_seed: number;
  prng_state: number;
  clock_us: bigint;
  /** When set to true the mocked WASM reports the one-shot overflow warning. */
  clockWarningFired: boolean;
  gpioLevels: Map<number, boolean>;
  resetCount: number;
  advanceClockCalls: { us: bigint }[];
  i2cTransfers: Array<{
    port: number;
    devAddr: number;
    writeBuf: Uint8Array;
    readLen: number;
  }>;
  i2cReturn: boolean;
}

function makeMockExports(): { exports: WasmExports; state: MockState } {
  const state: MockState = {
    bounce_us: 0,
    warmup_us: 0,
    sample_interval_us: 0,
    adc_noise_v: 0,
    rc_tau_s: 0,
    i2c_drop_permil: 0,
    prng_seed: 1,
    prng_state: 1,
    clock_us: 0n,
    clockWarningFired: false,
    gpioLevels: new Map(),
    resetCount: 0,
    advanceClockCalls: [],
    i2cTransfers: [],
    i2cReturn: true,
  };

  const exports: WasmExports = {
    pal_wasm_advance_virtual_clock(us) {
      state.advanceClockCalls.push({ us });
      state.clock_us += us;
    },
    pal_os_get_us() {
      return state.clock_us;
    },
    pal_wasm_is_clock_warning_fired() {
      return state.clockWarningFired;
    },
    pal_wasm_get_virtual_clock_us() {
      return state.clock_us;
    },
    pal_wasm_set_bounce_us(us) {
      state.bounce_us = us;
    },
    pal_wasm_set_warmup_us(us) {
      state.warmup_us = us;
    },
    pal_wasm_set_sample_interval_us(us) {
      state.sample_interval_us = us;
    },
    pal_wasm_set_adc_noise_v(v) {
      state.adc_noise_v = v;
    },
    pal_wasm_set_rc_tau_s(s) {
      state.rc_tau_s = s;
    },
    pal_wasm_set_i2c_drop_permil(permil) {
      state.i2c_drop_permil = permil;
    },
    pal_wasm_set_prng_seed(seed) {
      state.prng_seed = seed;
      state.prng_state = seed;
    },
    pal_wasm_reset_physical() {
      state.bounce_us = 0;
      state.warmup_us = 0;
      state.sample_interval_us = 0;
      state.adc_noise_v = 0;
      state.rc_tau_s = 0;
      state.i2c_drop_permil = 0;
      state.prng_seed = 1;
      state.prng_state = 1;
      state.clock_us = 0n;
      state.clockWarningFired = false;
      state.gpioLevels.clear();
      state.resetCount += 1;
    },
    pal_wasm_get_prng_state() {
      return state.prng_state;
    },
    pal_wasm_gpio_read(pin) {
      return state.gpioLevels.get(pin) ?? false;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    pal_wasm_i2c_transfer(port: any, devAddr: any, writeBuf: any, readLen: any) {
      // When testing the null-branch path (no rawModule wired), the bridge
      // casts exports to `any` and passes marshalled args; when used against
      // the raw ABI the args will be numbers. We coerce to Uint8Array/number
      // only when writeBuf looks like a Uint8Array for backward test compat.
      if (writeBuf instanceof Uint8Array) {
        state.i2cTransfers.push({ port, devAddr, writeBuf, readLen });
      } else {
        // Raw ABI call (wbufPtr, wlen, rbufPtr, rlen) — record the shape but
        // don't attempt heap marshalling in this mock.
        state.i2cTransfers.push({ port, devAddr, writeBuf: new Uint8Array(0), readLen: readLen ?? 0 });
      }
      return state.i2cReturn;
    },
    pal_os_get_ms: () => state.clock_us / 1000n,
    pal_wasm_get_fault_log_count: () => 0,
    pal_wasm_reset_fault_log: () => {},
    pal_wasm_fault_event_get_timestamp: () => 0n,
    pal_wasm_fault_event_get_type: () => 0,
    pal_wasm_fault_event_get_pin_or_bus: () => 0,
    pal_wasm_fault_event_get_sequence: () => 0,
    pal_wasm_set_pin_power_model: () => 0,
    pal_wasm_get_total_energy_mj: () => 0n,
  };

  return { exports, state };
}

// ---------------------------------------------------------------------------
// VirtualClock
// ---------------------------------------------------------------------------
describe('VirtualClock — bigint discipline', () => {
  test('reads as bigint zero on construction', () => {
    const clk = new VirtualClock();
    expect(typeof clk.getUs()).toBe('bigint');
    expect(clk.getUs()).toBe(0n);
    expect(clk.getMs()).toBe(0n);
  });

  test('advance accumulates bigint', () => {
    const clk = new VirtualClock();
    clk.advance(1500n);
    clk.advance(2000n);
    expect(clk.getUs()).toBe(3500n);
    expect(clk.getMs()).toBe(3n); // integer division 3500/1000
  });

  test('reject negative advance', () => {
    const clk = new VirtualClock();
    expect(() => clk.advance(-1n)).toThrow(RangeError);
  });

  test('handles values beyond 2^53 without precision loss', () => {
    const clk = new VirtualClock();
    const big = (1n << 53n) + 12345n;
    clk.advance(big);
    expect(clk.getUs()).toBe(big);
  });

  test('reset zeroes the clock', () => {
    const clk = new VirtualClock();
    clk.advance(9999n);
    clk.reset();
    expect(clk.getUs()).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// WasmPhysicalBridge
// ---------------------------------------------------------------------------
describe('WasmPhysicalBridge — config / clock / GPIO / I²C', () => {
  test('setFaults: every JSON field reaches the matching C setter', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);

    const cfg: SimFaultsConfig = {
      bounce_us: 30_000,
      warmup_us: 500_000,
      sample_interval_us: 1_000,
      adc_noise_v: 0.05,
      rc_tau_s: 0.01,
      i2c_drop_permil: 50,
      prng_seed: 0xdeadbeef,
    };
    bridge.setFaults(cfg);

    expect(state.bounce_us).toBe(cfg.bounce_us);
    expect(state.warmup_us).toBe(cfg.warmup_us);
    expect(state.sample_interval_us).toBe(cfg.sample_interval_us);
    expect(state.adc_noise_v).toBeCloseTo(cfg.adc_noise_v);
    expect(state.rc_tau_s).toBeCloseTo(cfg.rc_tau_s);
    expect(state.i2c_drop_permil).toBe(cfg.i2c_drop_permil);
    expect(state.prng_seed).toBe(cfg.prng_seed);
  });

  test('advanceClock + getClockUs round-trip with bigint', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);

    bridge.advanceClock(1_000_000n);
    bridge.advanceClock(500n);

    expect(state.advanceClockCalls).toHaveLength(2);
    expect(state.advanceClockCalls[0].us).toBe(1_000_000n);
    expect(state.advanceClockCalls[1].us).toBe(500n);
    expect(typeof bridge.getClockUs()).toBe('bigint');
    expect(bridge.getClockUs()).toBe(1_000_500n);
  });

  test('advanceClock rejects negative bigint', () => {
    const { exports } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);
    expect(() => bridge.advanceClock(-1n)).toThrow(RangeError);
  });

  test('advanceClock emits a single console.warn when C-side warning fires (Wave2 P1 Task 6)', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    // Before the C-side flag flips: no warning.
    bridge.advanceClock(1_000_000n);
    expect(warnSpy).not.toHaveBeenCalled();

    // C-side crosses the threshold and the one-shot flag latches true.
    state.clockWarningFired = true;
    bridge.advanceClock(1n);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toMatch(/\[CLOCK\]/);
    expect(msg).toMatch(/292 years/);
    expect(msg).toMatch(/us\)/);
    expect(msg).toMatch(/Reset simulation/);

    // Subsequent advances must NOT spam: TS-side latch dedupes.
    bridge.advanceClock(1n);
    bridge.advanceClock(1n);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });

  test('reset clears the TS-side warning latch so a fresh long-run can re-emit', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    state.clockWarningFired = true;
    bridge.advanceClock(1n);
    const callsAfterFirst = warnSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

    bridge.reset();
    // After reset the mock also clears the flag; simulate a NEW long-running
    // instance crossing the threshold again. The TS latch must have been
    // cleared by reset(), so a second emission is allowed.
    state.clockWarningFired = true;
    bridge.advanceClock(1n);
    expect(warnSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);

    warnSpy.mockRestore();
  });

  test('setGpioIdeal records state and fires injector callback', () => {
    const { exports } = makeMockExports();
    const injections: Array<{ pin: number; level: boolean }> = [];
    const bridge = new WasmPhysicalBridge(exports, (pin, level) =>
      injections.push({ pin, level }),
    );

    bridge.setGpioIdeal(7, true);
    bridge.setGpioIdeal(7, false);
    bridge.setGpioIdeal(8, true);

    expect(bridge.getGpioIdeal(7)).toBe(false);
    expect(bridge.getGpioIdeal(8)).toBe(true);
    expect(injections).toEqual([
      { pin: 7, level: true },
      { pin: 7, level: false },
      { pin: 8, level: true },
    ]);
  });

  test('readGpioDegraded passes through to pal_gpio_read', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);
    state.gpioLevels.set(9, true);
    expect(bridge.readGpioDegraded(9)).toBe(true);
    expect(bridge.readGpioDegraded(10)).toBe(false); // unset default
  });

  test('OOB / unusual pin numbers do not throw', () => {
    const { exports } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);

    // C-side `pal_wasm_get_debounce_ctx` returns NULL for pin>=WASM_SIM_MAX_PINS (128),
    // and the HAL falls through to ideal level. Mirror that contract: the bridge
    // must accept any pin number without throwing.
    expect(() => bridge.setGpioIdeal(127, true)).not.toThrow();
    expect(() => bridge.setGpioIdeal(128, true)).not.toThrow();
    expect(() => bridge.setGpioIdeal(0xffff, false)).not.toThrow();
    expect(() => bridge.readGpioDegraded(128)).not.toThrow();
    expect(() => bridge.readGpioDegraded(0xffff)).not.toThrow();
    expect(() => bridge.readGpioDegraded(-1)).not.toThrow();
  });

  test('i2cTransfer forwards args and returns mock result', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);
    const buf = new Uint8Array([0x12, 0x34]);

    state.i2cReturn = true;
    expect(bridge.i2cTransfer(0, 0x68, buf, 4)).toBe(true);
    state.i2cReturn = false;
    expect(bridge.i2cTransfer(1, 0x77, buf, 0)).toBe(false);

    expect(state.i2cTransfers).toHaveLength(2);
    expect(state.i2cTransfers[0]).toEqual({
      port: 0,
      devAddr: 0x68,
      writeBuf: buf,
      readLen: 4,
    });
  });

  test('reset clears bridge ideal map and calls pal_wasm_reset_physical', () => {
    const { exports, state } = makeMockExports();
    const bridge = new WasmPhysicalBridge(exports);

    bridge.setGpioIdeal(3, true);
    bridge.advanceClock(1000n);
    bridge.reset();

    expect(state.resetCount).toBe(1);
    expect(bridge.getGpioIdeal(3)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SimWorker — protocol correctness
// ---------------------------------------------------------------------------
describe('SimWorker — message protocol', () => {
  function makeWorker() {
    const { exports, state } = makeMockExports();
    const worker = new SimWorker({ exports });
    return { worker, state };
  }

  function expectOk<T>(resp: SimWorkerResponse): OkResponse<T> {
    if (resp.type !== 'OK') {
      throw new Error(`expected OK, got ${JSON.stringify(resp)}`);
    }
    return resp as OkResponse<T>;
  }

  test('INIT resets bridge + clock', () => {
    const { worker, state } = makeWorker();
    // Pre-pollute state to prove INIT really wipes it
    state.clock_us = 9999n;
    state.bounce_us = 42;

    const resp = worker.handleMessage({ type: 'INIT', id: 1 });
    const ok = expectOk<null>(resp);
    expect(ok.command).toBe('INIT');
    expect(state.clock_us).toBe(0n);
    expect(state.bounce_us).toBe(0);
    expect(worker.getClock().getUs()).toBe(0n);
  });

  test('SET_FAULTS round-trips every field', () => {
    const { worker, state } = makeWorker();
    const faults: SimFaultsConfig = {
      bounce_us: 25_000,
      warmup_us: 100_000,
      sample_interval_us: 500,
      adc_noise_v: 0.02,
      rc_tau_s: 0.005,
      i2c_drop_permil: 10,
      prng_seed: 12345,
    };
    const resp = worker.handleMessage({ type: 'SET_FAULTS', id: 2, faults });
    expectOk<null>(resp);
    expect(state.bounce_us).toBe(25_000);
    expect(state.prng_seed).toBe(12345);
  });

  test('STEP_CLOCK advances both clocks and returns current us', () => {
    const { worker } = makeWorker();
    const resp = worker.handleMessage({ type: 'STEP_CLOCK', id: 3, us: 250n });
    const ok = expectOk<{ us: bigint }>(resp);
    expect(typeof ok.payload.us).toBe('bigint');
    expect(ok.payload.us).toBe(250n);
    expect(worker.getClock().getUs()).toBe(250n);
  });

  test('STEP_CLOCK rejects number (bigint contract enforcement)', () => {
    const { worker } = makeWorker();
    // Simulate a misbehaving caller using a structured-clone-like number.
    const bad = { type: 'STEP_CLOCK', id: 4, us: 250 } as unknown as SimWorkerRequest;
    const resp = worker.handleMessage(bad);
    expect(resp.type).toBe('ERR');
    if (resp.type === 'ERR') {
      expect(resp.message).toMatch(/bigint/i);
    }
  });

  test('SET_GPIO_IDEAL + READ_GPIO_DEGRADED flow (with injector)', () => {
    const { exports, state } = makeMockExports();
    const worker = new SimWorker({
      exports,
      injectGpioIdeal: (pin, level) => state.gpioLevels.set(pin, level),
    });

    worker.handleMessage({ type: 'SET_GPIO_IDEAL', id: 5, pin: 7, level: true });
    const resp = worker.handleMessage({
      type: 'READ_GPIO_DEGRADED',
      id: 6,
      pin: 7,
    });
    const ok = expectOk<{ level: boolean }>(resp);
    expect(ok.payload.level).toBe(true);
  });

  test('READ_GPIO_DEGRADED with OOB pin does not crash', () => {
    const { worker } = makeWorker();
    const resp = worker.handleMessage({
      type: 'READ_GPIO_DEGRADED',
      id: 7,
      pin: 9999,
    });
    const ok = expectOk<{ level: boolean }>(resp);
    expect(ok.payload.level).toBe(false);
  });

  test('TEST_I2C_TRANSFER forwards args and reports success', () => {
    const { worker, state } = makeWorker();
    state.i2cReturn = true;
    const resp = worker.handleMessage({
      type: 'TEST_I2C_TRANSFER',
      id: 8,
      port: 0,
      devAddr: 0x68,
      writeBuf: new Uint8Array([0x01]),
      readLen: 2,
    });
    const ok = expectOk<{ success: boolean }>(resp);
    expect(ok.payload.success).toBe(true);
    expect(state.i2cTransfers).toHaveLength(1);
    expect(state.i2cTransfers[0].devAddr).toBe(0x68);
  });

  test('Unknown command returns ERR without crashing', () => {
    const { worker } = makeWorker();
    const bad = { type: 'DOES_NOT_EXIST', id: 99 } as unknown as SimWorkerRequest;
    const resp = worker.handleMessage(bad);
    expect(resp.type).toBe('ERR');
    if (resp.type === 'ERR') {
      expect(resp.command).toBe('UNKNOWN');
    }
  });

  test('correlation id is echoed on every response', () => {
    const { worker } = makeWorker();
    const ids = [101, 202, 303];
    const responses = [
      worker.handleMessage({ type: 'INIT', id: ids[0] }),
      worker.handleMessage({ type: 'STEP_CLOCK', id: ids[1], us: 1n }),
      worker.handleMessage({ type: 'READ_GPIO_DEGRADED', id: ids[2], pin: 0 }),
    ];
    responses.forEach((r, i) => expect(r.id).toBe(ids[i]));
  });
});
