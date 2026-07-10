/**
 * SimWorker.ts — Web Worker message loop for the WASM physical sandbox
 * (ADR-0009 Wave 2 + Phase C P0-2 integration).
 *
 * Protocol overview
 * -----------------
 * Messages exchanged between the UI thread and the simulation worker are
 * tagged discriminated unions. Every command receives a correlation id so
 * the UI can await individual round-trips; the worker mirrors that id on
 * the response. All `*_us`/clock values cross the boundary as `bigint` to
 * match WASM_BIGINT.
 *
 * Commands implemented:
 *   INIT                 — bind to an Emscripten module + clock; idempotent reset.
 *   SET_FAULTS           — push the full `SimFaultsConfig` into WASM.
 *   STEP_CLOCK           — advance the virtual clock by `us: bigint`.
 *                          PinArbiter processes pin changes; IRQ queue
 *                          is drained by C-side Phase 0 on the next wasm entry.
 *   SET_GPIO_IDEAL       — record a pin's pre-degradation (ideal) level.
 *   READ_GPIO_DEGRADED   — read a pin's post-degradation level. Phase C P0-2:
 *                          reads from PinArbiter.getResolvedVoltage (digital
 *                          LOW/HI-Z → false, HIGH/CONFLICT → true) instead
 *                          of bypassing directly to wasm pal_wasm_gpio_read.
 *   TEST_I2C_TRANSFER    — issue a transfer through the degraded HAL.
 *
 * Dependency wiring (Phase C P0-2):
 *   SimWorker now owns the full deps graph that createUnisimImports expects:
 *     - clock:        VirtualClock
 *     - arbiter:      PinArbiter (GPIO arbitration, IRQ edge source)
 *     - i2cBus:       I2CBus (host device model registry)
 *     - irqQueue:     InterruptQueue (GPIO-edge → C ISR FIFO)
 *     - memoryView:   () => HEAPU8 view
 *     - pwmSink:      optional observer
 *     - ultrasonicEchoUs: optional echo-pulse source
 *     - reportHostFault: bridge to pal_wasm_host_fault for safe-off
 *
 *   These deps are wired at construction time; `buildWasmImports()` returns
 *   a config object that can be spread into the WasmSandbox() factory config
 *   so that the Emscripten module sees all js_* imports at instantiation time.
 *
 * The worker exposes `handleMessage()` as the single dispatch entry point,
 * which is what the surrounding `self.onmessage` glue calls. Keeping the
 * dispatcher as a pure method makes it trivially Jest-testable without a
 * real Worker scope.
 */
import { VirtualClock } from '../core/VirtualClock';
import { PinArbiter } from '../core/pin-arbiter';
import { I2CBus } from '../bridge/I2CBus';
import { InterruptQueue } from '../bridge/InterruptQueue';
import { createUnisimImports, UnisimBridgeDeps } from '../bridge/createUnisimImports';
import type { WasmImports } from '../types/wasm/imports';
import {
  WasmPhysicalBridge,
  SimFaultsConfig,
  GpioIdealInjector,
} from './WasmPhysicalBridge';
import type { WasmExports } from '../types/wasm/exports';
import { LogicStates } from '../types/logic-types';
import type { I2CDevice } from '../types/runtime/i2c';

// ---- Request envelopes ----

export interface InitRequest {
  type: 'INIT';
  id: number;
}
export interface SetFaultsRequest {
  type: 'SET_FAULTS';
  id: number;
  faults: SimFaultsConfig;
}
export interface StepClockRequest {
  type: 'STEP_CLOCK';
  id: number;
  us: bigint;
}
export interface SetGpioIdealRequest {
  type: 'SET_GPIO_IDEAL';
  id: number;
  pin: number;
  level: boolean;
}
export interface ReadGpioDegradedRequest {
  type: 'READ_GPIO_DEGRADED';
  id: number;
  pin: number;
}
export interface TestI2cTransferRequest {
  type: 'TEST_I2C_TRANSFER';
  id: number;
  port: number;
  devAddr: number;
  writeBuf: Uint8Array;
  readLen: number;
}

export type SimWorkerRequest =
  | InitRequest
  | SetFaultsRequest
  | StepClockRequest
  | SetGpioIdealRequest
  | ReadGpioDegradedRequest
  | TestI2cTransferRequest;

// ---- Response envelopes ----

export interface OkResponse<T> {
  type: 'OK';
  id: number;
  command: SimWorkerRequest['type'];
  payload: T;
}
export interface ErrResponse {
  type: 'ERR';
  id: number;
  command: SimWorkerRequest['type'] | 'UNKNOWN';
  message: string;
}

export interface StepClockResult {
  /** Post-step clock reading in µs, sourced from the WASM side. */
  us: bigint;
}

export type SimWorkerResponse =
  | OkResponse<null>
  | OkResponse<StepClockResult>
  | OkResponse<{ level: boolean }>
  | OkResponse<{ success: boolean; data?: Uint8Array }>
  | ErrResponse;

/**
 * Construction options. The worker is parameterized over its dependencies so
 * tests can substitute a mock `WasmExports` without needing a real Emscripten
 * module.
 */
export interface SimWorkerOptions {
  exports: WasmExports;
  /**
   * Raw Emscripten module subset needed for _malloc/_free/HEAPU8. When provided,
   * enables:
   *   - proper marshalling in WasmPhysicalBridge.i2cTransfer (real _malloc/_free path);
   *   - pal_wasm_host_fault message writing (P0-3);
   *   - wasm imports production via buildWasmImports() (memoryView closes over it).
   * Tests may omit this to get the mock-compatible fallback path.
   */
  rawModule?: {
    _malloc(size: number): number;
    _free(ptr: number): void;
    HEAPU8: Uint8Array;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  };
  /** Optional callback fired when `setGpioIdeal` is invoked. */
  injectGpioIdeal?: GpioIdealInjector;
  /** Optional PWM observer forwarded to createUnisimImports. */
  pwmSink?: (channel: number, duty: number) => void;
  /** Optional ultrasonic echo source forwarded to createUnisimImports. */
  ultrasonicEchoUs?: (trigPin: number) => number;
  /** Optional I2C device pre-registration convenience. */
  i2cDevices?: Array<{ port: number; device: I2CDevice }>;
}

export class SimWorker {
  private readonly bridge: WasmPhysicalBridge;
  private readonly clock: VirtualClock;
  private readonly arbiter: PinArbiter;
  private readonly i2cBus: I2CBus;
  private readonly irqQueue: InterruptQueue;
  private readonly rawModule: SimWorkerOptions['rawModule'] | null;
  private importsCache: WasmImports | null = null;
  /** PinArbiter → InterruptQueue edge listener cleanup. */
  private pinChangeUnsubs: Array<() => void> = [];
  private bound: boolean = false;

  constructor(opts: SimWorkerOptions) {
    this.rawModule = opts.rawModule ?? null;
    this.bridge = new WasmPhysicalBridge(opts.exports, opts.injectGpioIdeal, opts.rawModule ?? undefined);
    this.clock = new VirtualClock();
    this.arbiter = new PinArbiter();
    this.i2cBus = new I2CBus();
    this.irqQueue = new InterruptQueue();
    if (opts.i2cDevices) {
      for (const { port, device } of opts.i2cDevices) this.i2cBus.register(port, device);
    }
    // Pre-build imports so memoryView/reportHostFault closures capture correctly.
    this.buildImports(opts);
  }

  /**
   * Build the WasmImports object that must be spread into the WasmSandbox()
   * factory config at instantiation time. Call this BEFORE awaiting
   * WasmSandbox() — the imports must be present when wasm first looks them up.
   *
   * Returned object is stable across calls (same reference); deps are already
   * wired in via closure, including the PinArbiter edge-detector that pushes
   * into InterruptQueue (which C-side Phase 0 then drains via js_pal_poll_interrupt).
   */
  buildWasmImports(): WasmImports {
    if (!this.importsCache) this.buildImports({} as SimWorkerOptions);
    return this.importsCache!;
  }

  private buildImports(opts: SimWorkerOptions) {
    // Edge detection: when PinArbiter resolves a new state for a pin that wasm
    // has registered an interrupt on, push it to InterruptQueue for C-side drain.
    // (Re-subscription on INIT reset is handled by reset() clearing + rebind.)
    const self = this;
    const deps: UnisimBridgeDeps = {
      clock: this.clock,
      arbiter: this.arbiter,
      i2cBus: this.i2cBus,
      irqQueue: this.irqQueue,
      memoryView: () => (self.rawModule ? self.rawModule.HEAPU8 : new Uint8Array(0)),
      pwmSink: opts.pwmSink,
      ultrasonicEchoUs: opts.ultrasonicEchoUs,
      reportHostFault(code, err) {
        // P0-3: write the error message to wasm heap and invoke pal_wasm_host_fault.
        // rawModule is required for _malloc/_free marshalling; host_fault export is
        // always present once wasm is instantiated (checked via type system below).
        if (!self.rawModule) {
          // eslint-disable-next-line no-console
          console.warn('[SimWorker] host fault cannot be delivered (rawModule not wired):', err);
          return;
        }
        const exports = self.bridge.getExports();
        if (exports.pal_wasm_is_faulted()) return; // idempotent: safe-off already executed
        const msg = err instanceof Error ? err.message : String(err);
        const M = self.rawModule;
        let ptr = 0;
        try {
          const enc = new TextEncoder();
          const bytes = enc.encode(msg + '\0');
          ptr = M._malloc(bytes.length);
          M.HEAPU8.set(bytes, ptr);
          exports.pal_wasm_host_fault(code, ptr);
        } catch (allocErr) {
          // eslint-disable-next-line no-console
          console.warn('[SimWorker] host fault (malloc unavailable):', msg, allocErr);
          try {
            exports.pal_wasm_host_fault(code, 0);
          } catch {
            // ignore secondary fault delivery failure
          }
        } finally {
          if (ptr) M._free(ptr);
        }
      },
    };
    this.importsCache = createUnisimImports(deps);
    this.bindPinEdgeDetection();
  }

  /**
   * Wire PinArbiter → InterruptQueue edge detection.
   *
   * wasm-side pal_gpio_enable_interrupt_ex calls js_pal_register_interrupt which
   * calls irqQueue.register(pin, cbIdx, argPtr). When PinArbiter subsequently
   * reports a state change on that pin (from wasm js_pal_gpio_write or an ideal-
   * level inject), we push the pin into InterruptQueue for C-side Phase 0 drain.
   *
   * Implementation: wrap irqQueue.register/deregister to manage per-pin
   * PinArbiter subscriptions on demand. Pins that werem has no ISR registered
   * never get a listener (zero overhead for GPIO output-only pins).
   */
  private bindPinEdgeDetection() {
    this.pinChangeUnsubs.forEach((u) => u());
    this.pinChangeUnsubs = [];

    const realRegister = this.irqQueue.register.bind(this.irqQueue);
    const realDeregister = this.irqQueue.deregister.bind(this.irqQueue);
    const subscribedPins = new Map<number, () => void>();

    const subscribePin = (pin: number) => {
      if (subscribedPins.has(pin)) return;
      const unsub = this.arbiter.onPinChange(pin, () => {
        // Every edge on an ISR-registered pin enqueues an IRQ. Phase B/C
        // semantics: C-side ISR reads pin state itself; intr_type filtering
        // (RISING/FALLING/ANY) happens in C if at all.
        this.irqQueue.push(pin);
      });
      subscribedPins.set(pin, unsub);
      this.pinChangeUnsubs.push(unsub);
    };
    const unsubscribePin = (pin: number) => {
      const unsub = subscribedPins.get(pin);
      if (unsub) {
        unsub();
        subscribedPins.delete(pin);
        // Remove from pinChangeUnsubs list for cleanliness (not strictly
        // necessary — INIT reset clears all).
        const idx = this.pinChangeUnsubs.indexOf(unsub);
        if (idx >= 0) this.pinChangeUnsubs.splice(idx, 1);
      }
    };

    // Install overrides on the InterruptQueue instance.
    const iq = this.irqQueue as InterruptQueue;
    iq.register = (pin: number, cbIdx: number, argPtr: number) => {
      realRegister(pin, cbIdx, argPtr);
      subscribePin(pin);
    };
    iq.deregister = (pin: number) => {
      realDeregister(pin);
      unsubscribePin(pin);
    };
  }

  /** FUTURE (D2 / Phase C): add gpio config-mode support for INPUT release. */

  /**
   * Single dispatch entry. Returns the response synchronously; production
   * glue wraps this in `self.onmessage = (e) => self.postMessage(worker.handleMessage(e.data))`.
   *
   * Never throws — all errors become `ErrResponse` so the UI thread can rely
   * on every request producing exactly one response.
   */
  handleMessage(msg: SimWorkerRequest): SimWorkerResponse {
    try {
      switch (msg.type) {
        case 'INIT':
          return this.handleInit(msg);
        case 'SET_FAULTS':
          return this.handleSetFaults(msg);
        case 'STEP_CLOCK':
          return this.handleStepClock(msg);
        case 'SET_GPIO_IDEAL':
          return this.handleSetGpioIdeal(msg);
        case 'READ_GPIO_DEGRADED':
          return this.handleReadGpioDegraded(msg);
        case 'TEST_I2C_TRANSFER':
          return this.handleTestI2cTransfer(msg);
        default: {
          // exhaustiveness guard
          const _exhaustive: never = msg;
          return {
            type: 'ERR',
            id: (msg as { id?: number }).id ?? -1,
            command: 'UNKNOWN',
            message: `Unknown command: ${JSON.stringify(_exhaustive)}`,
          };
        }
      }
    } catch (err) {
      return {
        type: 'ERR',
        id: msg.id,
        command: msg.type,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ---- per-command handlers ----

  private handleInit(msg: InitRequest): OkResponse<null> {
    this.bridge.reset();
    this.clock.reset();
    this.irqQueue.resetOverflowCount();
    // PinArbiter doesn't have an explicit reset — drivers are re-registered
    // by wasm init code via js_pal_gpio_write and js_pal_register_interrupt.
    // Re-bind edge detection in case INIT was called after a prior run.
    this.bindPinEdgeDetection();
    return { type: 'OK', id: msg.id, command: 'INIT', payload: null };
  }

  private handleSetFaults(msg: SetFaultsRequest): OkResponse<null> {
    this.bridge.setFaults(msg.faults);
    return { type: 'OK', id: msg.id, command: 'SET_FAULTS', payload: null };
  }

  private handleStepClock(msg: StepClockRequest): OkResponse<StepClockResult> {
    // Defensive: the type system forbids `number`, but JSON-deserialised
    // payloads can still smuggle one in via `as any`. Reject explicitly so
    // we surface the issue before it hits Emscripten as a cryptic TypeError.
    if (typeof msg.us !== 'bigint') {
      throw new TypeError(
        `STEP_CLOCK: us must be bigint (WASM_BIGINT contract), got ${typeof msg.us}`,
      );
    }
    // Lockstep order (preserved from Phase B):
    //   1. bridge.advanceClock(us) → pal_wasm_advance_virtual_clock(us): wasm
    //      s_virtual_us is updated first so any wasm re-entry triggered by
    //      promise resolution in step 2 reads the correct new time.
    //   2. clock.advance(us) → resolves pending JS sleeps; sensor models /
    //      time-driven logic may push GPIO edges into PinArbiter which flows
    //      through InterruptQueue (P0-2 wiring). By the time wasm re-enters
    //      on the next tick, Phase 0 drains all queued IRQs.
    this.bridge.advanceClock(msg.us);
    this.clock.advance(msg.us);
    return {
      type: 'OK',
      id: msg.id,
      command: 'STEP_CLOCK',
      payload: { us: this.bridge.getClockUs() },
    };
  }

  private handleSetGpioIdeal(msg: SetGpioIdealRequest): OkResponse<null> {
    this.bridge.setGpioIdeal(msg.pin, msg.level);
    return { type: 'OK', id: msg.id, command: 'SET_GPIO_IDEAL', payload: null };
  }

  private handleReadGpioDegraded(
    msg: ReadGpioDegradedRequest,
  ): OkResponse<{ level: boolean }> {
    // P0-2 (Phase C): read from PinArbiter's resolved voltage rather than
    // bypassing to wasm pal_wasm_gpio_read directly. This honors driver
    // arbitration (e.g. PWM "driver" on the same pin) and reflects the
    // post-arbitration level the physical world sees.
    //
    // Data path rationale:
    //   - When WASM app calls pal_gpio_write(), the js_pal_gpio_write import
    //     registers a SUPPLY-strength driver in PinArbiter → arbiter reads
    //     return HIGH/LOW directly (no bounce/noise applied, since WASM HAL
    //     applies that on its own read path when there IS a driver).
    //   - When host injects ideal levels via SET_GPIO_IDEAL (test/UI input
    //     stimulus) WITHOUT the WASM app ever calling pal_gpio_write (i.e.
    //     pin is an input-only sensor), no driver is registered → arbiter
    //     returns HI_Z. In that case we fall through to the wasm-side
    //     pal_wasm_gpio_read → pal_gpio_read → debounce middleware, which
    //     reads the ideal level via js_pal_gpio_read (which itself reads
    //     the arbiter, but the ideal-inject hook writes directly to... see
    //     note below) and applies bounce/noise.
    //
    // Mapping: HIGH / CONFLICT → true (driven), LOW / HI_Z → false.
    // For CONFLICT we err on the side of "signal present" since the
    // physical level is mid-rail.
    //
    // NOTE (HI_Z fallback path): in the current wiring, host SET_GPIO_IDEAL
    // calls bridge.setGpioIdeal() which fires the injectGpioIideal callback.
    // Production hosts that wire injectGpioIdeal to arbiter.setDriver will
    // never hit HI_Z (a driver exists); test/mock hosts that use the default
    // bridge-only cache will hit HI_Z and fall through to wasm-side degraded
    // reads, which read via js_pal_gpio_read (arbiter-backed, returning
    // false for HI_Z) — so the ideal-level path goes through bridge cache
    // for set and arbiter returns false for undriven inputs, matching the
    // physical model (floating pins read LOW in the digital model).
    const arbiterState = this.arbiter.readPin(msg.pin);
    let level: boolean;
    if (arbiterState === LogicStates.HIGH || arbiterState === LogicStates.CONFLICT) {
      level = true;
    } else if (arbiterState === LogicStates.LOW) {
      level = false;
    } else {
      // HI_Z — no driver registered in PinArbiter (input-only pin, or
      // test/mock host); fall through to wasm-side degraded read path
      // which applies bounce/noise middleware using js_pal_gpio_read.
      level = this.bridge.readGpioDegraded(msg.pin);
    }
    return {
      type: 'OK',
      id: msg.id,
      command: 'READ_GPIO_DEGRADED',
      payload: { level },
    };
  }

  /** Expose PinArbiter for tests / UI introspection. */
  getArbiter(): PinArbiter {
    return this.arbiter;
  }

  /** Expose I2CBus so hosts can register device models. */
  getI2CBus(): I2CBus {
    return this.i2cBus;
  }

  /** Expose InterruptQueue for tests / diagnostics. */
  getInterruptQueue(): InterruptQueue {
    return this.irqQueue;
  }

  private handleTestI2cTransfer(
    msg: TestI2cTransferRequest,
  ): OkResponse<{ success: boolean; data?: Uint8Array }> {
    const result = this.bridge.i2cTransfer(
      msg.port,
      msg.devAddr,
      msg.writeBuf,
      msg.readLen,
    );
    return {
      type: 'OK',
      id: msg.id,
      command: 'TEST_I2C_TRANSFER',
      payload: { success: result.ok, data: result.data },
    };
  }

  // ---- accessors (test / introspection only) ----

  /** Expose the JS-side clock for tests and timeline UI. */
  getClock(): VirtualClock {
    return this.clock;
  }

  /** Expose the bridge for tests; production callers should not need this. */
  getBridge(): WasmPhysicalBridge {
    return this.bridge;
  }
}

/**
 * Bind a `SimWorker` instance to a DedicatedWorkerGlobalScope. Call this from
 * the bundled Worker entry script after constructing the worker:
 *
 *   const worker = new SimWorker({ exports });
 *   bindWorkerScope(worker, self);
 *
 * Kept separate from the class to allow Jest to test the dispatcher in plain
 * Node without a Worker scope being present.
 */
export function bindWorkerScope(
  worker: SimWorker,
  scope: { postMessage: (msg: SimWorkerResponse) => void; onmessage?: ((ev: MessageEvent<SimWorkerRequest>) => void) | null },
): void {
  scope.onmessage = (ev: MessageEvent<SimWorkerRequest>): void => {
    const response = worker.handleMessage(ev.data);
    scope.postMessage(response);
  };
}
