/**
 * SimWorker.ts — Web Worker message loop for the WASM physical sandbox
 * (ADR-0009 Wave 2).
 *
 * Protocol overview
 * -----------------
 * Messages exchanged between the UI thread and the simulation worker are
 * tagged discriminated unions. Every command receives a correlation id so
 * the UI can await individual round-trips; the worker mirrors that id on
 * the response. All `*_us`/clock values cross the boundary as `bigint` to
 * match WASM_BIGINT.
 *
 * Commands implemented this wave (one per the task brief):
 *   INIT                 — bind to an Emscripten module + clock; idempotent reset.
 *   SET_FAULTS           — push the full `SimFaultsConfig` into WASM.
 *   STEP_CLOCK           — advance the virtual clock by `us: bigint`.
 *   SET_GPIO_IDEAL       — record a pin's pre-degradation level.
 *   READ_GPIO_DEGRADED   — read a pin's post-debounce level from WASM.
 *   TEST_I2C_TRANSFER    — issue a transfer through the degraded HAL.
 *
 * The worker exposes `handleMessage()` as the single dispatch entry point,
 * which is what the surrounding `self.onmessage` glue calls. Keeping the
 * dispatcher as a pure method makes it trivially Jest-testable without a
 * real Worker scope.
 */
import { VirtualClock } from '../core/VirtualClock';
import {
  WasmPhysicalBridge,
  WasmExports,
  SimFaultsConfig,
  GpioIdealInjector,
} from './WasmPhysicalBridge';

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
  | OkResponse<{ success: boolean }>
  | ErrResponse;

/**
 * Construction options. The worker is parameterized over its dependencies so
 * tests can substitute a mock `WasmExports` without needing a real Emscripten
 * module.
 */
export interface SimWorkerOptions {
  exports: WasmExports;
  /** Optional callback fired when `setGpioIdeal` is invoked. */
  injectGpioIdeal?: GpioIdealInjector;
}

export class SimWorker {
  private readonly bridge: WasmPhysicalBridge;
  private readonly clock: VirtualClock;

  constructor(opts: SimWorkerOptions) {
    this.bridge = new WasmPhysicalBridge(opts.exports, opts.injectGpioIdeal);
    this.clock = new VirtualClock();
  }

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
    const level = this.bridge.readGpioDegraded(msg.pin);
    return {
      type: 'OK',
      id: msg.id,
      command: 'READ_GPIO_DEGRADED',
      payload: { level },
    };
  }

  private handleTestI2cTransfer(
    msg: TestI2cTransferRequest,
  ): OkResponse<{ success: boolean }> {
    const success = this.bridge.i2cTransfer(
      msg.port,
      msg.devAddr,
      msg.writeBuf,
      msg.readLen,
    );
    return {
      type: 'OK',
      id: msg.id,
      command: 'TEST_I2C_TRANSFER',
      payload: { success },
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
