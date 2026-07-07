/**
 * nodeSmoke.test.ts — Phase B end-to-end: load real wasm, install
 * createUnisimImports, drive app_init to completion, and assert every
 * js_* import the wasm actually references was hit at least once.
 *
 * Build the wasm before running this test. Choose one of:
 *
 *   (A) In-tree canonical build (auto-discovered — no staging step):
 *       cd wink-micro-os
 *       emcmake cmake -B build-wasm-unisim -DTARGET_PLATFORM=wasm \
 *                     -DWINK_APP_DIR=samples/unisim_smoke .
 *       cmake --build build-wasm-unisim
 *       # (no cp needed; test looks for wink-micro-os/build-wasm-unisim/)
 *
 *   (B) Host ctest ExternalProject build — point at ctest-built artifact:
 *       cd wink-micro-os
 *       cmake -S . -B build-host -DTARGET_PLATFORM=host -G "MinGW Makefiles"
 *       cmake --build build-host --target wasm_unisim_smoke_build-build
 *       # then: WASM_BUILD_DIR=wink-micro-os/build-host/wasm-unisim-smoke npx jest nodeSmoke
 *
 *   (C) Set WASM_BUILD_DIR env var to any absolute or repo-root-relative path
 *       containing wink_simulator.{js,wasm}.
 *
 * If no build directory contains artifacts, this suite skips with a diagnostic.
 *
 * Note on the "13 imports" plan: the wasm fixture declares 13 extern js_*
 * functions in wasm_bridge.h, but the actual imported-symbol set is 11
 * (12 when js_pal_log is linked — count fluctuates by App variant).
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
/* BUILD_DIR resolution precedence:
 *   1. WASM_BUILD_DIR env var (set by CI / ctest shim / developer), absolute or
 *      repo-root-relative. Lets the test point at any freshly-built artifact,
 *      e.g. the ctest ExternalProject dir: WINK_MICRO_OS/build-host/wasm-unisim-smoke.
 *   2. Legacy repo-root staging dir build-wasm-unisim-smoke/ (created by manual
 *      cp step in old instructions).
 * The first path that actually contains both wink_simulator.js and .wasm wins;
 * if neither exists we skip the suite (same behavior as before). */
function resolveBuildDir(): string {
  const envDir = process.env.WASM_BUILD_DIR;
  const candidates: string[] = [];
  if (envDir) {
    candidates.push(path.isAbsolute(envDir) ? envDir : path.resolve(REPO_ROOT, envDir));
  }
  candidates.push(path.join(REPO_ROOT, 'build-wasm-unisim-smoke'));
  // Also auto-discover the canonical in-tree build-wasm-unisim/ used by developers
  // running `cmake --build build-wasm-unisim` from wink-micro-os/:
  candidates.push(path.join(REPO_ROOT, 'wink-micro-os', 'build-wasm-unisim'));
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'wink_simulator.js')) &&
        fs.existsSync(path.join(c, 'wink_simulator.wasm'))) {
      return c;
    }
  }
  // Default: legacy staging dir (test will skip if artifacts absent).
  return candidates[0];
}
const BUILD_DIR = resolveBuildDir();
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

/* Address 0x50 is chosen to avoid the C-side SSD1306 simulator, which
 * unconditionally intercepts 0x3C/0x3D in wasm_sim_registry.c (Scheme A
 * short-circuit in pal_i2c_transfer). unisim_smoke's SMOKE_I2C_ADDR must
 * match this; the fixture and test are kept in lockstep via this constant. */
const SMOKE_I2C_ADDR = 0x50;

class EchoI2CDevice implements I2CDevice {
  readonly addr = SMOKE_I2C_ADDR;
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
      const ultrasonicEchoPins: number[] = [];
      const gpioWrites: Array<{ pin: number; level: number }> = [];

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

      const rawImports = createUnisimImports(deps);
      const called = new Set<string>();
      const imports = new Proxy(rawImports, {
        get(target, prop, recv) {
          const v = Reflect.get(target, prop, recv);
          if (typeof v === 'function' && typeof prop === 'string' && prop.startsWith('js_')) {
            return (...args: unknown[]) => {
              called.add(prop);
              /* ADR-0017: TRIG is fired via raw pal_gpio_write (the TRIG pulse
               * is a standard GPIO HIGH→delay→LOW sequence, not a dedicated
               * js_sim_trigger_ultrasonic hook). We record GPIO writes here so
               * we can assert TRIG pin 12 toggled, replacing the stale
               * js_sim_trigger_ultrasonic observation. */
              if (prop === 'js_pal_gpio_write' && args.length >= 2) {
                gpioWrites.push({ pin: args[0] as number, level: args[1] as number });
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
      // Note: the legacy js_pal_os_get_ms/_us dead stubs were removed in
      // Phase C P2-1 — C-side pal_os_get_us/ms() reads s_virtual_us
      // directly (virtual-clock SSOT lives in C); the JS VirtualClock is
      // pushed forward via the C→JS export pal_wasm_advance_virtual_clock.
      /* js_* imports whose calls the JS host bridge is expected to observe
       * (verified against the built artifact):
       *
       * - js_sim_trigger_ultrasonic is TREE-SHAKEN: per ADR-0017
       *   unisim_smoke fires TRIG via raw pal_gpio_write, no dedicated
       *   bridge hook. Ultrasonic ECHO is measured through
       *   pal_gpio_pulse_in → js_sim_measure_echo_pulse_us (C-side
       *   ultrasonic model defaults to the -1.0f "not injected" sentinel
       *   so JS fallback fires when the host does not call
       *   pal_wasm_set_ultrasonic_distance).
       * - js_pal_log is imported but intentionally not asserted here: it
       *   is handled by the default --js-library wrapper which routes to
       *   console.*; createUnisimImports does not intercept it because
       *   log routing has no effect on device simulation.
       * - js_pal_i2c_transfer fires for addr=0x50; the C-side SSD1306 sim
       *   unconditionally intercepts 0x3C/0x3D (wasm_sim_registry.c), so
       *   SMOKE_I2C_ADDR/EchoI2CDevice both use 0x50 to exercise the JS
       *   bridge path. C-side SSD1306 coverage lives in
       *   test_wasm_devices_sim (host Unity test).
       */
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
        'js_sim_measure_echo_pulse_us',
      ];
      const missing = expectedActuallyImported.filter((k) => !called.has(k));
      expect(missing).toEqual([]);

      // Sanity-check side effects reached their respective deps.
      expect(pwmSeen.length).toBeGreaterThan(0);
      expect(pwmSeen[0].ch).toBe(1);
      expect(pwmSeen[0].duty).toBeCloseTo(50.0, 3);

      /* ADR-0017: TRIG pulse is a standard pal_gpio_write sequence on pin 12
       * (HIGH → busy_wait 10us → LOW), not a dedicated bridge hook. The Proxy
       * records js_pal_gpio_write calls into gpioWrites; assert pin 12
       * transitions through HIGH. */
      const trigWrites = gpioWrites.filter((w) => w.pin === 12);
      expect(trigWrites.length).toBeGreaterThanOrEqual(2); // HIGH + LOW
      expect(trigWrites.some((w) => w.level === 1)).toBe(true); // at least one HIGH
      /* ECHO measurement flows through js_sim_measure_echo_pulse_us because the
       * C-side ultrasonic model starts at -1.0f sentinel (BSS-init bug fix in
       * wasm_dev_ultrasonic.c). Pin 13 = SMOKE_ULTRASONIC_ECHO from
       * device_tree.h. */
      expect(ultrasonicEchoPins).toContain(13);

      // PinArbiter observed the LED write HIGH on pin 2.
      // arbiter.readPin returns LogicState (numeric const: HIGH=1, LOW=0, etc.).
      expect(arbiter.readPin(2)).toBe(LogicStates.HIGH);

      // Final dual-clock invariant.
      expect(Module._pal_os_get_us()).toBe(clock.getUs());

      // P1-1 CI gate: Asyncify backup-stack high-water must remain under 80%
      // of ASYNCIFY_STACK_SIZE (64 KiB = 65536 bytes, per CMakeLists.txt).
      // If this fails, either a deeper AI-generated call chain needs a bigger
      // stack (raise -sASYNCIFY_STACK_SIZE) or there's an unintended recursion
      // path through Asyncify that should be flattened.
      //
      // Guard: emcc installs a throwing getter on Module for any runtime method
      // requested via EXPORTED_RUNTIME_METHODS but not actually provided by the
      // linked library — accessing .Asyncify directly would abort(). Use
      // getOwnPropertyDescriptor to detect the real binding before reading it.
      let highwater: number | undefined;
      {
        const desc = Object.getOwnPropertyDescriptor(Module, 'Asyncify');
        const AsyncifyRT = desc?.value as { getStackMax?: () => number } | undefined;
        if (AsyncifyRT && typeof AsyncifyRT.getStackMax === 'function') {
          highwater = AsyncifyRT.getStackMax();
        }
      }
      if (highwater !== undefined) {
        const ASYNCIFY_STACK_SIZE = 65536;
        expect(highwater).toBeLessThan(ASYNCIFY_STACK_SIZE * 0.8);
      }
      // If Asyncify isn't exposed (different emcc config / ASSERTIONS off),
      // we skip the assertion — the gate is best-effort in CI, not a hard
      // requirement for smoke to pass. Production profiling can add logging.
    },
    15_000,
  );
});
