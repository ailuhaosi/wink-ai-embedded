/**
 * createUnisimImports — the strongly-typed factory that produces the object
 * installUnisimBridge assigns onto the Emscripten Module.
 *
 * Everything wired here routes into an existing subsystem:
 *   PinArbiter    <- gpio_write / gpio_read
 *   I2CBusApi     <- i2c_transfer (with wasm-heap ptr+len marshalling)
 *   WasmInterruptQueue <- register / deregister / poll (poll writes out
 *                          uint32 LE into the wasm heap)
 *   VirtualClock  <- sleep_ms / busy_wait_us (Promise<void>) / get_ms / get_us
 *   pwmSink       <- js_pal_pwm_set_duty (optional observer; PinArbiter
 *                    does not yet model PWM channels; Phase C will)
 *   ultrasonicEchoUs <- js_sim_measure_echo_pulse_us (optional; default
 *                       1000us matches wink_sim_js.js default stub)
 *
 * Wasm-heap marshalling:
 *   memoryView() is called ONCE PER OPERATION, never cached. Emscripten
 *   may grow linear memory (memory.grow / _emscripten_resize_heap) at any
 *   time; a cached Uint8Array becomes detached and reads throw or return
 *   zero. Cost is a Uint8Array constructor per call which is cheap.
 */
import type { WasmImports } from '../types/wasm/imports';
import type { WasmInterruptQueue } from '../types/wasm/interrupt-queue';
import type { I2CBusApi } from '../types/runtime/i2c';
import { VirtualClock } from '../core/VirtualClock';
import { PinArbiter } from '../core/pin-arbiter';
import { LogicStates, DriveStrength } from '../types/logic-types';

export interface UnisimBridgeDeps {
  clock: VirtualClock;
  arbiter: PinArbiter;
  i2cBus: I2CBusApi;
  irqQueue: WasmInterruptQueue;
  /**
   * Return a fresh Uint8Array view over the current wasm linear memory.
   * MUST return a new view each call — do NOT cache internally, because
   * Emscripten's memory.grow detaches the backing ArrayBuffer.
   */
  memoryView: () => Uint8Array;
  /** Optional PWM observer. If absent, js_pal_pwm_set_duty is a no-op. */
  pwmSink?: (channel: number, duty: number) => void;
  /**
   * Optional ultrasonic echo-pulse producer. Default returns 1000 (matches
   * wink_sim_js.js default stub which models ~17 cm echo).
   */
  ultrasonicEchoUs?: (trigPin: number) => number;
}

// The wasm side is the strongest driver on any pin it writes to.
const WASM_DRIVER_ID_PREFIX = 'mcu:gpio';

function writeU32LE(view: Uint8Array, off: number, value: number): void {
  view[off] = value & 0xff;
  view[off + 1] = (value >>> 8) & 0xff;
  view[off + 2] = (value >>> 16) & 0xff;
  view[off + 3] = (value >>> 24) & 0xff;
}

export function createUnisimImports(deps: UnisimBridgeDeps): WasmImports {
  const { clock, arbiter, i2cBus, irqQueue, memoryView, pwmSink, ultrasonicEchoUs } = deps;

  return {
    // --- PAL HAL: GPIO / PWM / I2C ---
    js_pal_gpio_write(pin, level) {
      arbiter.setDriver(pin, {
        id: `${WASM_DRIVER_ID_PREFIX}${pin}`,
        state: level ? LogicStates.HIGH : LogicStates.LOW,
        strength: DriveStrength.SUPPLY,
      });
    },
    js_pal_gpio_read(pin) {
      return arbiter.readPin(pin) === LogicStates.HIGH;
    },
    js_pal_pwm_set_duty(channel, duty) {
      if (pwmSink) pwmSink(channel, duty);
    },
    js_pal_i2c_transfer(port, addr, wbuf, wlen, rbuf, rlen) {
      const view = memoryView();
      const writeBytes = view.slice(wbuf, wbuf + wlen);
      const readBuf = new Uint8Array(rlen);
      const ok = i2cBus.transfer(port, addr, writeBytes, readBuf);
      if (ok && rlen > 0) {
        // Re-acquire heap view: i2cBus.transfer() or a device model callback
        // could theoretically trigger wasm heap growth (memory.grow), which
        // detaches the ArrayBuffer backing the old view. Calling memoryView()
        // again is cheap (one Uint8Array ctor) and safe against this class of
        // detached-buffer silent-corruption bug.
        const freshView = memoryView();
        freshView.set(readBuf, rbuf);
      }
      return ok;
    },

    // --- Interrupt bridge (poll model) ---
    js_pal_register_interrupt(pin, cbIdx, argPtr) {
      irqQueue.register(pin, cbIdx, argPtr);
    },
    js_pal_deregister_interrupt(pin) {
      irqQueue.deregister(pin);
    },
    js_pal_poll_interrupt(outCbPtr, outArgPtr) {
      const pending = irqQueue.pop();
      if (!pending) return false;
      const view = memoryView();
      writeU32LE(view, outCbPtr, pending.cbIdx);
      writeU32LE(view, outArgPtr, pending.argPtr);
      return true;
    },

    // --- PAL OSAL (Asyncify imports MUST return Promise<void>) ---
    async js_pal_os_sleep_ms(ms) {
      // >>> 0 coerces to unsigned uint32 range — C-side uint32_t may arrive
      // as signed number through the Emscripten ABI (e.g. (uint32_t)-1 = -1).
      await clock.sleep(ms >>> 0);
    },
    async js_pal_os_busy_wait_us(us) {
      // µs-precision primitive path — MUST NOT truncate to Math.floor(us/1000).
      // I²C bit-bang, one-wire, servo pulse widths all rely on sub-ms accuracy.
      // See Global Constraint "busy_wait_us sub-millisecond precision" and
      // VirtualClock.sleepUs docstring.
      //
      // >>> 0 coerces to unsigned uint32 range — see Global Constraint
      // "uint32_t unsigned coercion at JS boundary". Without this,
      // BigInt(-1) throws RangeError inside sleepUs, while the C side
      // intended 0xFFFFFFFF (~71 minutes, used as "wait forever" sentinel
      // in some embedded drivers).
      await clock.sleepUs(BigInt(us >>> 0));
    },
    js_pal_os_get_ms() {
      return clock.getMs();
    },
    js_pal_os_get_us() {
      return clock.getUs();
    },

    // --- DAL bypass ---
    js_sim_trigger_ultrasonic(_trigPin) {
      // Phase B: no-op; Phase C will derive from PinArbiter GPIO edges.
    },
    js_sim_measure_echo_pulse_us(trigPin) {
      return ultrasonicEchoUs ? ultrasonicEchoUs(trigPin) : 1000;
    },
  };
}
