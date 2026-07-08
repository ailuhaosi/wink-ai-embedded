/**
 * createUnisimImports — the strongly-typed factory that produces the object
 * installUnisimBridge assigns onto the Emscripten Module.
 *
 * Everything wired here routes into an existing subsystem:
 *   PinArbiter    <- gpio_write / gpio_read
 *   I2CBusApi     <- i2c_transfer (with wasm-heap ptr+len marshalling)
 *   WasmInterruptQueue <- register / deregister / poll (poll writes out
 *                          uint32 LE into the wasm heap)
 *   VirtualClock  <- sleep_ms / busy_wait_us (Promise<void>)
 *   pwmSink       <- js_pal_pwm_set_duty (optional observer; PinArbiter
 *                    does not yet model PWM channels; Phase C will)
 *   ultrasonicEchoUs <- js_sim_measure_echo_pulse_us (optional; default
 *                       1000us matches wink_sim_js.js default stub)
 *
 * Time SSOT (P2-1, Phase C): C-side pal_os_get_us/ms() reads `s_virtual_us`
 * directly from linear memory (zero JS call); the JS VirtualClock is the
 * SSOT advanced by the host via postMessage. The legacy js_pal_os_get_ms/_us
 * imports were dead stubs (wasm never imported them) and have been removed.
 * Hosts that need a clock reading should read clock.getUs()/getMs() directly.
 *
 * Exception safety (P0-3/P1-8, Phase C):
 *   Every user-overridable import (pwmSink, i2cBus, irqQueue, ultrasonicEchoUs)
 *   goes through safeWrap / safeWrapAsync. If the user implementation throws
 *   synchronously or rejects its Promise, the wrapper:
 *     1. Calls deps.reportHostFault(err) so the wiring layer can invoke
 *        pal_wasm_host_fault(8003, msg) for safe-off;
 *     2. Returns a safe default (false for boolean-returning, 0 for numeric,
 *        resolved Promise for async paths) so Emscripten never sees a throw
 *        that would abort the entire wasm instance.
 *   Framework-owned deps (arbiter, clock) are NOT wrapped — they're trusted
 *   framework code; a throw there is a bug and should surface loudly.
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
  /**
   * Host fault reporter (P0-3). Called when a user-overridable import
   * (pwmSink / i2cBus / ultrasonicEchoUs / irqQueue) throws or rejects.
   * The wiring layer (SimWorker/installUnisimBridge) provides this to
   * marshal the error into wasm linear memory and invoke
   * pal_wasm_host_fault(8003, msgCstr) for safe-off.
   *
   * If absent (e.g. in unit tests that pass plain objects), the wrapper
   * still catches and returns a safe default but does NOT notify C.
   */
  reportHostFault?: (code: number, err: unknown) => void;
}

// The wasm side is the strongest driver on any pin it writes to.
const WASM_DRIVER_ID_PREFIX = 'mcu:gpio';

function writeU32LE(view: Uint8Array, off: number, value: number): void {
  view[off] = value & 0xff;
  view[off + 1] = (value >>> 8) & 0xff;
  view[off + 2] = (value >>> 16) & 0xff;
  view[off + 3] = (value >>> 24) & 0xff;
}

/**
 * Wrap a synchronous user-provided import so throws are caught, reported
 * to the host fault channel, and a safe default is returned to Emscripten
 * (preventing throw-through into the wasm import stub which would abort).
 */
function safeWrap<A extends unknown[], R>(
  fn: (...args: A) => R,
  defaultValue: R,
  reportHostFault: ((code: number, err: unknown) => void) | undefined,
  code: number,
  name: string,
): (...args: A) => R {
  return (...args: A) => {
    try {
      return fn(...args);
    } catch (err) {
      if (reportHostFault) reportHostFault(code, err);
      else {
        // eslint-disable-next-line no-console
        console.warn(`[unisim] ${name} threw; returning safe default (no reportHostFault wired):`, err);
      }
      return defaultValue;
    }
  };
}

/**
 * Wrap an async (Promise-returning) user-provided import. The returned
 * Promise NEVER rejects — rejection is converted into a host-fault report
 * and a resolved promise with a safe default value. Asyncify relies on
 * the Promise resolving (not rejecting) to complete its rewind cycle; a
 * rejection inside an Asyncify import triggers Emscripten abort.
 */
function safeWrapAsync<A extends unknown[], R>(
  fn: (...args: A) => Promise<R>,
  defaultValue: R,
  reportHostFault: ((code: number, err: unknown) => void) | undefined,
  code: number,
  name: string,
): (...args: A) => Promise<R> {
  return (...args: A) => {
    try {
      return Promise.resolve(fn(...args)).catch((err) => {
        if (reportHostFault) reportHostFault(code, err);
        else {
          // eslint-disable-next-line no-console
          console.warn(`[unisim] ${name} rejected; returning safe default (no reportHostFault wired):`, err);
        }
        return defaultValue;
      });
    } catch (err) {
      // Synchronous throw from the user function (before returning a Promise)
      if (reportHostFault) reportHostFault(code, err);
      else {
        // eslint-disable-next-line no-console
        console.warn(`[unisim] ${name} threw synchronously; returning safe default:`, err);
      }
      return Promise.resolve(defaultValue);
    }
  };
}

export function createUnisimImports(deps: UnisimBridgeDeps): WasmImports {
  const {
    clock,
    arbiter,
    i2cBus,
    irqQueue,
    memoryView,
    pwmSink,
    ultrasonicEchoUs,
    reportHostFault,
  } = deps;

  /* 8003 = JS host plugin fault (review P0-3). 8001 = boot-after-reset,
   * 8002 = WCET, 8003 = host plugin fault. Keep codes adjacent. */
  const FAULT_CODE_HOST = 8003;

  // Safe-wrapped optional user sinks.
  const safePwmSink = pwmSink
    ? safeWrap(pwmSink, undefined as void, reportHostFault, FAULT_CODE_HOST, 'js_pal_pwm_set_duty(pwmSink)')
    : undefined;
  const safeUltrasonic = ultrasonicEchoUs
    ? safeWrap(ultrasonicEchoUs, 1000, reportHostFault, FAULT_CODE_HOST, 'js_sim_measure_echo_pulse_us')
    : undefined;

  // i2cBus.transfer and irqQueue.pop/register/deregister are framework-wired
  // in our own code (I2CBus / InterruptQueue), but we still wrap them because
  // device.onTransfer is user-supplied and may throw.
  const safeI2cTransfer = safeWrap(
    (port: number, addr: number, wb: Uint8Array, rb: Uint8Array) => i2cBus.transfer(port, addr, wb, rb),
    false,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_i2c_transfer(i2cBus.transfer)',
  );
  const safeIrqRegister = safeWrap(
    (pin: number, cbIdx: number, argPtr: number) => irqQueue.register(pin, cbIdx, argPtr),
    undefined as void,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_register_interrupt(irqQueue.register)',
  );
  const safeIrqDeregister = safeWrap(
    (pin: number) => irqQueue.deregister(pin),
    undefined as void,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_deregister_interrupt(irqQueue.deregister)',
  );
  const safeIrqPop = safeWrap(
    () => irqQueue.pop(),
    null as ReturnType<WasmInterruptQueue['pop']>,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_poll_interrupt(irqQueue.pop)',
  );

  // Sleep paths return Promise<void> — wrap to guarantee non-rejection.
  const safeClockSleep = safeWrapAsync(
    (ms: number) => clock.sleep(ms),
    undefined as void,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_os_sleep_ms(clock.sleep)',
  );
  const safeClockSleepUs = safeWrapAsync(
    (us: bigint) => clock.sleepUs(us),
    undefined as void,
    reportHostFault,
    FAULT_CODE_HOST,
    'js_pal_os_busy_wait_us(clock.sleepUs)',
  );

  return {
    // --- PAL HAL: GPIO / PWM / I2C ---
    js_pal_gpio_write(pin, level) {
      // arbiter is framework-owned; not wrapped
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
      if (safePwmSink) safePwmSink(channel, duty);
    },
    js_pal_i2c_transfer(port, addr, wbuf, wlen, rbuf, rlen) {
      const view = memoryView();
      const writeBytes = view.slice(wbuf, wbuf + wlen);
      const readBuf = new Uint8Array(rlen);
      const ok = safeI2cTransfer(port, addr, writeBytes, readBuf);
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
      safeIrqRegister(pin, cbIdx, argPtr);
    },
    js_pal_deregister_interrupt(pin) {
      safeIrqDeregister(pin);
    },
    js_pal_poll_interrupt(outCbPtr, outArgPtr) {
      const pending = safeIrqPop();
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
      await safeClockSleep(ms >>> 0);
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
      await safeClockSleepUs(BigInt(us >>> 0));
    },
    js_pal_log(level, msgCstr) {
      const view = memoryView();
      let len = 0;
      while (view[msgCstr + len] !== 0) {
        len++;
      }
      const bytes = view.subarray(msgCstr, msgCstr + len);
      const msg = new TextDecoder().decode(bytes);
      // Fallback log to console.info/error/warn/debug
      switch (level) {
        case 1: console.error(`[wink E] ${msg}`); break;
        case 2: console.warn(`[wink W] ${msg}`); break;
        case 3: console.info(`[wink I] ${msg}`); break;
        case 4: console.debug(`[wink D] ${msg}`); break;
        default: console.log(`[wink ?] ${msg}`); break;
      }
    },

    // --- DAL bypass ---
    js_sim_trigger_ultrasonic(_trigPin) {
      // Phase B: no-op; Phase C will derive from PinArbiter GPIO edges.
    },
    js_sim_measure_echo_pulse_us(trigPin) {
      return safeUltrasonic ? safeUltrasonic(trigPin) : 1000;
    },
  };
}
