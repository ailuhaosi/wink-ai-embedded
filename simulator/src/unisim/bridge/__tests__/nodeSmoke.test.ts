/**
 * nodeSmoke.test.ts — Phase B end-to-end: load real wasm, install
 * createUnisimImports, drive app_init to completion, and assert every
 * js_* import the wasm actually references was hit at least once.
 *
 * Build the wasm before running this test (from repo root):
 *   cd wink-micro-os
 *   emcmake cmake -B build-wasm-unisim -DTARGET_PLATFORM=wasm \
 *                 -DWINK_APP_DIR=samples/unisim_smoke .
 *   cmake --build build-wasm-unisim
 *   # Stage artifacts where this test expects them (repo-root build-wasm-unisim-smoke/):
 *   mkdir -p ../build-wasm-unisim-smoke
 *   cp build-wasm-unisim/wink_simulator.{js,wasm} ../build-wasm-unisim-smoke/
 *
 * If build-wasm-unisim-smoke/wink_simulator.js is absent this test suite
 * skips with a diagnostic — CI must build it as a prereq step.
 *
 * Note on the "13 imports" plan: the wasm fixture declares 13 extern js_*
 * functions in wasm_bridge.h, but the actual imported-symbol set is 11.
 * pal_os_get_us() / pal_os_get_ms() are defined in C (pal_osal_wasm.c) as
 * direct reads of s_virtual_us (per ADR-0009 — virtual clock is owned on
 * the C side; JS advances it via pal_wasm_advance_virtual_clock, not via
 * js_pal_os_get_*). Those two js_* stubs exist in wink_sim_js.js for
 * backward-compat but are not called by current wasm code; we assert the
 * actual imported set below.
 */
import * as fs from 'fs';
import * as path from 'path';
import { VirtualClock } from '../../core/VirtualClock';
import { PinArbiter } from '../../core/pin-arbiter';
import { LogicStates } from '../../types/logic-types';
import { I2CBus } from '../I2CBus';
import { InterruptQueue } from '../InterruptQueue';
import { createUnisimImports, UnisimBridgeDeps } from '../createUnisimImports';
import type { WasmImports } from '../../types/wasm/imports';
import { I2CDevice } from '../../types/runtime/i2c';

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const BUILD_DIR = path.join(REPO_ROOT, 'build-wasm-unisim-smoke');
const GLUE_PATH = path.join(BUILD_DIR, 'wink_simulator.js');
const WASM_PATH = path.join(BUILD_DIR, 'wink_simulator.wasm');

const artifactsPresent = fs.existsSync(GLUE_PATH) && fs.existsSync(WASM_PATH);
const dsuite = artifactsPresent ? describe : describe.skip;

if (!artifactsPresent) {
  // eslint-disable-next-line no-console
  console.warn(
    `[nodeSmoke] Skipping — missing ${GLUE_PATH} or ${WASM_PATH}\n` +
      `            Build with:\n` +
      `              cd wink-micro-os\n` +
      `              emcmake cmake -B build-wasm-unisim -DTARGET_PLATFORM=wasm -DWINK_APP_DIR=samples/unisim_smoke .\n` +
      `              cmake --build build-wasm-unisim\n` +
      `              mkdir -p ../build-wasm-unisim-smoke\n` +
      `              cp build-wasm-unisim/wink_simulator.{js,wasm} ../build-wasm-unisim-smoke/`,
  );
}

class EchoI2CDevice implements I2CDevice {
  readonly addr = 0x3c;
  onTransfer(w: Uint8Array, rl: number) {
    const out = new Uint8Array(rl);
    for (let i = 0; i < rl; i++) out[i] = w[i] ?? 0;
    return { ack: true, readBytes: out };
  }
}

/**
 * Minimal shape of the Emscripten Module we need once WasmSandbox() resolves.
 *
 * EMSCRIPTEN_KEEPALIVE C functions are exposed by Emscripten with a leading
 * underscore (Module._pal_wasm_advance_virtual_clock), AND — because of
 * ccall/cwrap — also as wrappers that handle BigInt<->i64 conversion when
 * WASM_BIGINT=1. We use the underscore-prefixed raw forms here because the
 * C ABI for pal_wasm_advance_virtual_clock(us: uint64_t) expects a BigInt
 * argument directly with -sWASM_BIGINT=1.
 */
interface WasmModule {
  HEAPU8: Uint8Array;
  _pal_wasm_advance_virtual_clock(us: bigint): void;
  _pal_os_get_us(): bigint;
  _pal_os_get_ms(): bigint;
}

dsuite('Node smoke: real wasm + createUnisimImports end-to-end', () => {
  test(
    'every js_* import the wasm links is exercised; JS↔wasm clocks stay in lockstep',
    async () => {
      const clock = new VirtualClock();
      const arbiter = new PinArbiter();
      const i2cBus = new I2CBus();
      const irqQueue = new InterruptQueue();
      i2cBus.register(0, new EchoI2CDevice());

      const pwmSeen: Array<{ ch: number; duty: number }> = [];
      const ultrasonicTrigPins: number[] = [];
      const ultrasonicEchoPins: number[] = [];

      // Stable closure over a mutable heap-view slot. createUnisimImports
      // captures deps.memoryView and calls it once per operation, so once we
      // populate heapView after WasmSandbox() resolves, the factory picks up
      // the real wasm heap automatically.
      let heapView: () => Uint8Array = () => new Uint8Array(0);
      const deps: UnisimBridgeDeps = {
        clock,
        arbiter,
        i2cBus,
        irqQueue,
        memoryView: () => heapView(),
        pwmSink: (ch, duty) => pwmSeen.push({ ch, duty }),
        ultrasonicEchoUs: (pin) => {
          ultrasonicEchoPins.push(pin);
          return 1500;
        },
      };

      // Wrap js_sim_trigger_ultrasonic to observe calls (createUnisimImports
      // leaves it a no-op; we do it here at the Proxy layer like the other
      // imports so we don't have to add an ultrasonicTrigSink option to
      // UnisimBridgeDeps just for tests).
      const rawImports = createUnisimImports(deps);
      const called = new Set<string>();
      const imports = new Proxy(rawImports, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (typeof v === 'function' && typeof prop === 'string' && prop.startsWith('js_')) {
            return (...args: unknown[]) => {
              called.add(prop);
              if (prop === 'js_sim_trigger_ultrasonic') {
                ultrasonicTrigPins.push(args[0] as number);
              }
              return (v as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return v;
        },
      }) as WasmImports;

      // Load Emscripten glue and instantiate. Spreading imports into the
      // factory config is sufficient — wink_sim_js.js's wrappers read
      // Module.js_xxx per-call (ADR-0019).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const WasmSandbox = require(GLUE_PATH);
      // Use preRun to bind the heap view BEFORE main() runs app_init(),
      // because app_init calls js_pal_i2c_transfer synchronously during
      // startup — the post-instantiation heap bind happens too late.
      // Emscripten calls each preRun with the Module instance as its
      // argument; HEAPU8 is already populated by that point.
      const moduleConfig: Record<string, unknown> = {
        ...imports,
        print: (msg: string) => {
          // eslint-disable-next-line no-console
          console.log(`[wasm] ${msg}`);
        },
        printErr: (msg: string) => {
          // eslint-disable-next-line no-console
          console.error(`[wasm-err] ${msg}`);
        },
        preRun: [(mod: { HEAPU8: Uint8Array }) => {
          // Build fresh Uint8Array views against the current ArrayBuffer on
          // each call (createUnisimImports calls memoryView per op and does
          // NOT cache). Using the buffer directly instead of HEAPU8.subarray
          // means a memory.grow-detached buffer is replaced on the next
          // call automatically.
          heapView = () => new Uint8Array(mod.HEAPU8.buffer);
        }],
      };
      const Module = (await WasmSandbox(moduleConfig)) as WasmModule;

      // Defensive: if preRun didn't fire for some reason, bind now.
      if (heapView === (() => new Uint8Array(0))) {
        heapView = () => new Uint8Array(Module.HEAPU8.buffer);
      }

      // ─── Drive both clocks in lockstep ───────────────────────────────
      //
      // The JS-side VirtualClock is what sleepUs/sleep resolve against;
      // the wasm-side s_virtual_us is what pal_os_get_us() reads inside
      // app_init. Per the dual-clock lockstep invariant (Task 14 review
      // P1-3), each tick advances BOTH by TICK_US and asserts they agree.
      const TICK_US = 1_000n;
      const MAX_TICKS = 20; // fixture completes within ~10ms virtual

      // Note: we don't call pal_wasm_advance_virtual_clock(0) before
      // starting — the wasm begins with s_virtual_us = 0 and JS clock = 0,
      // and the first advance of TICK_US resolves the sleep(5).
      for (let tick = 0; tick < MAX_TICKS; tick++) {
        clock.advance(TICK_US);
        Module._pal_wasm_advance_virtual_clock(TICK_US);
        // Hard invariant: dual-clock drift is a Phase C production bug.
        expect(Module._pal_os_get_us()).toBe(clock.getUs());
        // Yield the microtask queue so Asyncify rewinds can fire between
        // ticks (the Global Constraint "advance single-tick-per-sync-block"
        // applies here).
        await new Promise((r) => setImmediate(r));
      }

      // ─── Coverage assertions ─────────────────────────────────────────
      //
      // These are the js_* symbols the wasm binary ACTUALLY imports
      // (verified via WebAssembly.Module.imports on the built artifact).
      // js_pal_os_get_ms / js_pal_os_get_us are declared extern in
      // wasm_bridge.h but the C-side pal_os_get_us/ms() definitions read
      // s_virtual_us directly (ADR-0009 virtual-clock SSOT lives in C),
      // so they are not in the wasm's import set.
      const expectedActuallyImported = [
        'js_pal_gpio_write',
        'js_pal_gpio_read',
        'js_pal_pwm_set_duty',
        'js_pal_i2c_transfer',
        'js_pal_register_interrupt',
        'js_pal_deregister_interrupt',
        'js_pal_poll_interrupt',
        'js_pal_os_sleep_ms',
        'js_pal_os_busy_wait_us',
        'js_sim_trigger_ultrasonic',
        'js_sim_measure_echo_pulse_us',
      ];
      const missing = expectedActuallyImported.filter((k) => !called.has(k));
      expect(missing).toEqual([]);

      // Sanity-check side effects reached their respective deps.
      expect(pwmSeen.length).toBeGreaterThan(0);
      expect(pwmSeen[0].ch).toBe(1);
      expect(pwmSeen[0].duty).toBeCloseTo(50.0, 3);
      expect(ultrasonicTrigPins).toContain(12); // SMOKE_ULTRASONIC_TRIG
      expect(ultrasonicEchoPins).toContain(13); // SMOKE_ULTRASONIC_ECHO

      // PinArbiter observed the LED write HIGH on pin 2.
      // arbiter.readPin returns LogicState (numeric const: HIGH=1, LOW=0, etc.).
      expect(arbiter.readPin(2)).toBe(LogicStates.HIGH);

      // Final dual-clock invariant.
      expect(Module._pal_os_get_us()).toBe(clock.getUs());
    },
    15_000,
  );
});
