import { createUnisimImports, UnisimBridgeDeps } from '../createUnisimImports';
import { VirtualClock, VirtualClockResetError } from '../../core/VirtualClock';
import { PinArbiter } from '../../core/pin-arbiter';
import { LogicStates, DriveStrength } from '../../types/logic-types';
import { I2CBus } from '../I2CBus';
import { InterruptQueue } from '../InterruptQueue';
import { I2CDevice } from '../../types/runtime/i2c';

function makeHeap(bytes = 4096): { buffer: ArrayBuffer; view: () => Uint8Array } {
  const buffer = new ArrayBuffer(bytes);
  return { buffer, view: () => new Uint8Array(buffer) };
}

function makeDeps(overrides: Partial<UnisimBridgeDeps> = {}): {
  deps: UnisimBridgeDeps;
  heap: ReturnType<typeof makeHeap>;
  clock: VirtualClock;
  arbiter: PinArbiter;
  i2cBus: I2CBus;
  irqQueue: InterruptQueue;
} {
  const heap = makeHeap();
  const clock = new VirtualClock();
  const arbiter = new PinArbiter();
  const i2cBus = new I2CBus();
  const irqQueue = new InterruptQueue();
  const deps: UnisimBridgeDeps = {
    clock,
    arbiter,
    i2cBus,
    irqQueue,
    memoryView: heap.view,
    ...overrides,
  };
  return { deps, heap, clock, arbiter, i2cBus, irqQueue };
}

describe('createUnisimImports', () => {
  test('produces an object with all 11 WasmImports members as functions', () => {
    const { deps } = makeDeps();
    const imports = createUnisimImports(deps);
    const expected = [
      'js_pal_gpio_write', 'js_pal_gpio_read', 'js_pal_pwm_set_duty',
      'js_pal_i2c_transfer',
      'js_pal_register_interrupt', 'js_pal_deregister_interrupt', 'js_pal_poll_interrupt',
      'js_pal_os_sleep_ms', 'js_pal_os_busy_wait_us',
      'js_sim_trigger_ultrasonic', 'js_sim_measure_echo_pulse_us',
    ] as const;
    for (const key of expected) {
      expect(typeof (imports as any)[key]).toBe('function');
    }
  });

  test('gpio_write drives the PinArbiter; gpio_read reads it back', () => {
    const { deps, arbiter } = makeDeps();
    const imports = createUnisimImports(deps);
    imports.js_pal_gpio_write(5, true);
    // Pin 5 should now be HIGH via the wasm-side driver
    expect(arbiter.readPin(5)).toBe(LogicStates.HIGH);
    expect(imports.js_pal_gpio_read(5)).toBe(true);
    imports.js_pal_gpio_write(5, false);
    expect(imports.js_pal_gpio_read(5)).toBe(false);
  });

  test('gpio_read on floating pin returns false', () => {
    const { deps } = makeDeps();
    const imports = createUnisimImports(deps);
    expect(imports.js_pal_gpio_read(99)).toBe(false);
  });

  test('pwm_set_duty invokes optional pwmSink', () => {
    const seen: Array<{ ch: number; duty: number }> = [];
    const { deps } = makeDeps({ pwmSink: (ch, duty) => seen.push({ ch, duty }) });
    const imports = createUnisimImports(deps);
    imports.js_pal_pwm_set_duty(2, 42.5);
    expect(seen).toEqual([{ ch: 2, duty: 42.5 }]);
  });

  test('pwm_set_duty is a silent no-op when no pwmSink is provided', () => {
    const { deps } = makeDeps();
    const imports = createUnisimImports(deps);
    expect(() => imports.js_pal_pwm_set_duty(2, 42.5)).not.toThrow();
  });

  test('i2c_transfer marshals wasm heap into device, writes read bytes back', () => {
    const { deps, heap, i2cBus } = makeDeps();
    class EchoDev implements I2CDevice {
      readonly addr = 0x3C;
      onTransfer(w: Uint8Array, rl: number) {
        // Echo write buffer into read (length must match rl)
        const out = new Uint8Array(rl);
        for (let i = 0; i < rl; i++) out[i] = w[i % Math.max(1, w.length)];
        return { ack: true, readBytes: out };
      }
    }
    i2cBus.register(0, new EchoDev());

    // Write {0xDE, 0xAD} at heap[100..102], expect read at heap[200..202]
    const view = heap.view();
    view[100] = 0xDE; view[101] = 0xAD;

    const imports = createUnisimImports(deps);
    const ok = imports.js_pal_i2c_transfer(0, 0x3C, 100, 2, 200, 2);
    expect(ok).toBe(true);
    expect(view[200]).toBe(0xDE);
    expect(view[201]).toBe(0xAD);
  });

  test('i2c_transfer NACKs unregistered address', () => {
    const { deps } = makeDeps();
    const imports = createUnisimImports(deps);
    expect(imports.js_pal_i2c_transfer(0, 0x77, 0, 0, 0, 0)).toBe(false);
  });

  test('interrupt register/push/poll writes wasm heap out pointers correctly', () => {
    const { deps, heap, irqQueue } = makeDeps();
    const imports = createUnisimImports(deps);
    imports.js_pal_register_interrupt(7, 123, 0xCAFEBABE);
    irqQueue.push(7);

    // outCbPtr @ heap[0], outArgPtr @ heap[8]
    const gotOne = imports.js_pal_poll_interrupt(0, 8);
    expect(gotOne).toBe(true);
    const view = heap.view();
    // Little-endian uint32
    const readU32LE = (off: number) =>
      (view[off] | (view[off + 1] << 8) | (view[off + 2] << 16) | (view[off + 3] << 24)) >>> 0;
    expect(readU32LE(0)).toBe(123);
    expect(readU32LE(8)).toBe(0xCAFEBABE);

    // Queue drained
    expect(imports.js_pal_poll_interrupt(0, 8)).toBe(false);
  });

  test('deregister_interrupt stops future push from enqueuing', () => {
    const { deps, irqQueue } = makeDeps();
    const imports = createUnisimImports(deps);
    imports.js_pal_register_interrupt(7, 1, 0);
    imports.js_pal_deregister_interrupt(7);
    expect(irqQueue.push(7)).toBe(false);
  });

  test('sleep_ms reset rejection does not report host fault', async () => {
    const faults: unknown[] = [];
    const { deps, clock } = makeDeps({
      reportHostFault: (_code, err) => faults.push(err),
    });
    const imports = createUnisimImports(deps);
    const p = imports.js_pal_os_sleep_ms(100);
    clock.reset();
    await p;
    expect(faults).toEqual([]);
  });

  test('sleep_ms reports non-reset rejections as host fault', async () => {
    const faults: unknown[] = [];
    const brokenClock = {
      sleep: () => Promise.reject(new RangeError('bad ms')),
      sleepUs: () => Promise.reject(new RangeError('bad us')),
    } as unknown as VirtualClock;
    const { deps } = makeDeps({
      clock: brokenClock,
      reportHostFault: (_code, err) => faults.push(err),
    });
    const imports = createUnisimImports(deps);
    await imports.js_pal_os_sleep_ms(1);
    expect(faults[0]).toBeInstanceOf(RangeError);
    expect(faults.some((e) => e instanceof VirtualClockResetError)).toBe(false);
  });

  test('sleep_ms returns a Promise that resolves after advance crosses wake time', async () => {
    const { deps, clock } = makeDeps();
    const imports = createUnisimImports(deps);
    let resolved = false;
    const p = imports.js_pal_os_sleep_ms(50).then(() => { resolved = true; });
    clock.advance(49_000n);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1_000n);
    await p;
    expect(resolved).toBe(true);
  });

  test('busy_wait_us has sub-millisecond precision (routes through sleepUs)', async () => {
    const { deps, clock } = makeDeps();
    const imports = createUnisimImports(deps);
    // 500us wait: MUST NOT be truncated to Math.floor(500/1000) = 0.
    let resolved = false;
    const p = imports.js_pal_os_busy_wait_us(500).then(() => { resolved = true; });
    clock.advance(499n);
    await Promise.resolve();
    expect(resolved).toBe(false);          // <500us elapsed
    clock.advance(1n);
    await p;
    expect(resolved).toBe(true);           // exactly 500us — resolves
  });

  test('busy_wait_us(0) still waits for next non-zero advance', async () => {
    const { deps, clock } = makeDeps();
    const imports = createUnisimImports(deps);
    let resolved = false;
    const p = imports.js_pal_os_busy_wait_us(0).then(() => { resolved = true; });
    clock.advance(0n);
    await Promise.resolve();
    expect(resolved).toBe(false);
    clock.advance(1n);
    await p;
    expect(resolved).toBe(true);
  });

  test('ultrasonic trigger is a no-op; measure returns 1000 by default', () => {
    const { deps } = makeDeps();
    const imports = createUnisimImports(deps);
    expect(() => imports.js_sim_trigger_ultrasonic(3)).not.toThrow();
    expect(imports.js_sim_measure_echo_pulse_us(3)).toBe(1000);
  });

  test('ultrasonic honours deps.ultrasonicEchoUs when provided', () => {
    const seen: number[] = [];
    const { deps } = makeDeps({
      ultrasonicEchoUs: (pin) => { seen.push(pin); return 2500; },
    });
    const imports = createUnisimImports(deps);
    expect(imports.js_sim_measure_echo_pulse_us(9)).toBe(2500);
    expect(seen).toEqual([9]);
  });
});
