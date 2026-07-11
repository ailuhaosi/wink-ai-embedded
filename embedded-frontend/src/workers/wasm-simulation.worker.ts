import { SIM_UI_TICK_MS } from '../constants/simulation';
import type { SimWorkerInbound, SimWorkerOutbound } from '../types/sim-worker-protocol';
import { SimWorkerOutboundType } from '../types/sim-worker-protocol';
import type { ActuatorObserveSource } from '../types/actuator-observation';

// @ts-ignore — loaded at runtime via importScripts to avoid Vite bundling Node fs paths
import { SimWorker } from '@unisim/worker/SimWorker';
import {
  adaptEmscriptenRawModule,
  callEmscriptenExport,
  createEmscriptenExportsAdapter,
  hasEmscriptenExport,
} from '@unisim/bridge/adaptEmscriptenExports';

type WasmSandboxFactory = (moduleArg?: Record<string, unknown>) => Promise<Record<string, unknown>>;

let wasmSandboxLoader: Promise<WasmSandboxFactory> | null = null;

/**
 * Load Emscripten glue from /public/wasm without Vite bundling.
 * Bundling wink_simulator.js into the worker makes Emscripten detect Node (process polyfill)
 * and call require('node:fs'), which never completes in the browser.
 * Module workers cannot use importScripts(), so fetch + Function is used instead.
 */
/**
 * Inject C getenv keys into Emscripten glue's internal ENV object.
 * Modularize builds do not always merge Module.ENV from the factory config.
 */
function patchEmscriptenGlueEnv(code: string): string {
  const marker = 'var ENV = {';
  if (!code.includes(marker)) return code;
  return code.replace(marker, 'var ENV = {"WINK_SIM_BYPASS_WCET":"1",');
}

function loadWasmSandboxFactory(): Promise<WasmSandboxFactory> {
  if (!wasmSandboxLoader) {
    wasmSandboxLoader = (async () => {
      const glueUrl = new URL('/wasm/wink_simulator.js', self.location.origin).href;
      const response = await fetch(glueUrl);
      if (!response.ok) {
        throw new Error(`Failed to load WASM glue (${response.status})`);
      }
      const code = patchEmscriptenGlueEnv(await response.text());
      const shimModule = { exports: {} as WasmSandboxFactory & { default?: WasmSandboxFactory } };
      const loader = new Function(
        'module',
        'exports',
        `${code}\nreturn module.exports.default ?? module.exports;`,
      ) as (
        module: { exports: WasmSandboxFactory & { default?: WasmSandboxFactory } },
        exports: WasmSandboxFactory & { default?: WasmSandboxFactory },
      ) => WasmSandboxFactory;
      const factory = loader(shimModule, shimModule.exports);
      if (typeof factory !== 'function') {
        throw new TypeError('WasmSandbox factory not found in /wasm/wink_simulator.js');
      }
      return factory;
    })();
  }
  return wasmSandboxLoader;
}

// Redirect standard console logging to postMessage so the UI can capture it
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;
const originalDebug = console.debug;

function sendLogToUI(level: 'log' | 'warn' | 'error' | 'info' | 'debug', msg: string) {
  self.postMessage({
    type: SimWorkerOutboundType.LOG,
    payload: { level, message: msg, timestamp: Date.now() },
  } satisfies SimWorkerOutbound);
}

console.log = (...args) => {
  sendLogToUI('log', args.join(' '));
  originalLog.apply(console, args);
};
console.warn = (...args) => {
  sendLogToUI('warn', args.join(' '));
  originalWarn.apply(console, args);
};
console.error = (...args) => {
  sendLogToUI('error', args.join(' '));
  originalError.apply(console, args);
};
console.info = (...args) => {
  sendLogToUI('info', args.join(' '));
  originalInfo.apply(console, args);
};
console.debug = (...args) => {
  sendLogToUI('debug', args.join(' '));
  originalDebug.apply(console, args);
};

// @ts-ignore — runtime importScripts, see loadWasmSandboxFactory()

let simWorker: SimWorker | null = null;
let running = false;
let simTimer: ReturnType<typeof setTimeout> | null = null;
let wasmMainStarted = false;
let speedMultiplier = 1; // 1x speed: step 1000us per 1ms real-time
const STEP_US = 1000n; // 1ms virtual step

const observedPins = new Set<number>();
let hasOled = false;
const ultrasonicDistances = new Map<number, number>();
let observedActuatorSources: ActuatorObserveSource[] = [];

// Proxies for deferred initialization of exports and module
let realModule: Record<string, unknown> | null = null;
let rawModuleAdapter: ReturnType<typeof adaptEmscriptenRawModule> | null = null;

const exportsProxy = createEmscriptenExportsAdapter(() => realModule);

const moduleProxy = new Proxy({} as Record<string, unknown>, {
  get(_target, prop) {
    if (prop === 'HEAPU8') {
      if (rawModuleAdapter) return rawModuleAdapter.HEAPU8;
      const heap = realModule?.HEAPU8;
      if (heap instanceof Uint8Array) return heap;
      throw new Error('Wasm module HEAPU8 accessed before instantiation completed!');
    }
    if (!rawModuleAdapter) {
      throw new Error(`Wasm module accessed before instantiation completed!`);
    }
    if (prop === '_malloc') return rawModuleAdapter._malloc;
    if (prop === '_free') return rawModuleAdapter._free;
    return realModule?.[String(prop)];
  },
});

// Load the WASM sandbox and initialize the SimWorker
async function initSimulator() {
  try {
    console.log('[SimWorker] Loading Emscripten glue...');
    const WasmSandbox = await loadWasmSandboxFactory();

    console.log('[SimWorker] Instantiating SimWorker...');
    simWorker = new SimWorker({
      exports: exportsProxy,
      rawModule: moduleProxy as unknown as import('@unisim/worker/WasmPhysicalBridge').RawModule,
      injectGpioIdeal: (pin, level) => {
        if (realModule && hasEmscriptenExport(realModule, 'pal_wasm_set_gpio_input')) {
          callEmscriptenExport(realModule, 'pal_wasm_set_gpio_input', pin, level);
        }
      },
      ultrasonicEchoUs: (pin) => {
        const dist = ultrasonicDistances.get(pin) ?? 10.0;
        return dist * 58; // 58us per cm
      },
    });

    // Get the imports configuration from the worker
    const imports = simWorker.buildWasmImports();

    const moduleConfig = {
      ...imports,
      // Defer main() until SimWorker INIT resets clocks — auto callMain before
      // INIT races with Asyncify sleeps and triggers spurious host fault 8003.
      noInitialRun: true,
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/wasm/wink_simulator.wasm';
        }
        return path;
      },
      preRun: [(mod: Record<string, unknown>) => {
        realModule = mod;
        try {
          rawModuleAdapter = adaptEmscriptenRawModule(realModule);
        }
        catch {
          rawModuleAdapter = null;
        }
      }],
    };

    console.log('[SimWorker] Instantiating WASM sandbox...');
    const Module = await WasmSandbox(moduleConfig);

    realModule = Module as Record<string, unknown>;
    if (!rawModuleAdapter) {
      try {
        rawModuleAdapter = adaptEmscriptenRawModule(realModule);
      }
      catch {
        rawModuleAdapter = null;
      }
    }

    // Reset worker clocks/physical state (wasm app starts on first START).
    simWorker.handleMessage({ type: 'INIT', id: 0 });

    console.log('[SimWorker] WASM simulation sandbox initialized successfully!');

    self.postMessage({ type: SimWorkerOutboundType.INIT_DONE } satisfies SimWorkerOutbound);
  }
  catch (err: any) {
    console.error(`[SimWorker] Initialization failed: ${err.message}`);
    self.postMessage({ type: SimWorkerOutboundType.ERROR, message: err.message } satisfies SimWorkerOutbound);
  }
}

function ensureWasmMainStarted(): void {
  if (wasmMainStarted || !realModule) return;
  if (!hasEmscriptenExport(realModule, 'main')) {
    throw new Error('Wasm module missing _main export');
  }
  callEmscriptenExport(realModule, 'main', 0, 0);
  wasmMainStarted = true;
}

// Drive the simulation loop
function simLoop() {
  if (!running || !simWorker) return;

  try {
    // Step the clock based on the speed multiplier
    for (let i = 0; i < speedMultiplier; i++) {
      simWorker.handleMessage({ type: 'STEP_CLOCK', id: 0, us: STEP_US });
    }

    // Read the states of all registered pins
    const pinStates: Record<number, boolean> = {};
    for (const pin of observedPins) {
      const res = simWorker.handleMessage({ type: 'READ_GPIO_DEGRADED', id: 0, pin });
      if (res.type === 'OK') {
        pinStates[pin] = (res.payload as any).level;
      }
    }

    // Read OLED Framebuffer if enabled
    let oledFb: Uint8Array | null = null;
    if (hasOled && realModule && rawModuleAdapter && hasEmscriptenExport(realModule, 'pal_wasm_get_ssd1306_fb')) {
      const wPtr = rawModuleAdapter!._malloc(4);
      const hPtr = rawModuleAdapter!._malloc(4);
      try {
        const fbPtr = callEmscriptenExport(realModule, 'pal_wasm_get_ssd1306_fb', wPtr, hPtr) as number;
        if (fbPtr) {
          const heap = rawModuleAdapter!.HEAPU8;
          const width = new Uint32Array(heap.buffer, wPtr, 1)[0];
          const height = new Uint32Array(heap.buffer, hPtr, 1)[0];
          const fbSize = (width * height) / 8;
          oledFb = new Uint8Array(heap.buffer, fbPtr, fbSize).slice();
        }
      }
      finally {
        rawModuleAdapter!._free(wPtr);
        rawModuleAdapter!._free(hPtr);
      }
    }

    const traces: any[] = [];
    if (realModule && hasEmscriptenExport(realModule, 'pal_wasm_get_fault_log_count')) {
      const count = callEmscriptenExport(realModule, 'pal_wasm_get_fault_log_count') as number;
      for (let i = 0; i < count; i++) {
        traces.push({
          timestamp: String(callEmscriptenExport(realModule, 'pal_wasm_fault_event_get_timestamp', i)),
          type: callEmscriptenExport(realModule, 'pal_wasm_fault_event_get_type', i),
          pinOrBus: callEmscriptenExport(realModule, 'pal_wasm_fault_event_get_pin_or_bus', i),
          sequence: callEmscriptenExport(realModule, 'pal_wasm_fault_event_get_sequence', i),
        });
      }
    }

    const isFaulted = realModule && hasEmscriptenExport(realModule, 'pal_wasm_is_faulted')
      ? Boolean(callEmscriptenExport(realModule, 'pal_wasm_is_faulted'))
      : false;

    const pwm: Record<number, number> = {};
    for (const src of observedActuatorSources) {
      if (src.transport === 'pwm_channel' && typeof src.transportKey === 'number') {
        if (realModule && hasEmscriptenExport(realModule, 'pal_wasm_get_pwm_duty_percent')) {
          pwm[src.transportKey] = callEmscriptenExport(
            realModule,
            'pal_wasm_get_pwm_duty_percent',
            src.transportKey,
          ) as number;
        }
      }
    }

    const currentUs = simWorker.getBridge().getClockUs().toString();

    self.postMessage({
      type: SimWorkerOutboundType.STATE_UPDATE,
      payload: {
        us: currentUs,
        pinStates,
        oledFb,
        traces,
        isFaulted,
        actuatorOutputs: {
          simTimeUs: currentUs,
          gpio: pinStates,
          pwm,
        },
      },
    } satisfies SimWorkerOutbound);
  }
  catch (err: any) {
    console.error(`[SimLoop Error] ${err.message}`);
    running = false;
    self.postMessage({ type: SimWorkerOutboundType.ERROR, message: err.message } satisfies SimWorkerOutbound);
    return;
  }

  // Schedule next tick (~60Hz UI push rate)
  simTimer = setTimeout(simLoop, SIM_UI_TICK_MS);
}

// Receive messages from UI thread
self.onmessage = async (e: MessageEvent<SimWorkerInbound>) => {
  const { type, payload } = e.data as SimWorkerInbound & { payload?: unknown };

  if (!simWorker && type !== 'INIT') {
    return;
  }

  switch (type) {
    case 'INIT':
      await initSimulator();
      break;

    case 'START':
      if (!running) {
        ensureWasmMainStarted();
        running = true;
        simLoop();
        console.log('[SimWorker] Simulation started');
      }
      break;

    case 'PAUSE':
      running = false;
      if (simTimer) clearTimeout(simTimer);
      console.log('[SimWorker] Simulation paused');
      break;

    case 'RESET':
      running = false;
      if (simTimer) clearTimeout(simTimer);
      simWorker!.handleMessage({ type: 'INIT', id: 0 });
      console.log('[SimWorker] Simulation reset');
      self.postMessage({ type: SimWorkerOutboundType.RESET_DONE } satisfies SimWorkerOutbound);
      break;

    case 'SET_PIN_IDEAL': {
      const { pin, level } = payload;
      simWorker!.handleMessage({ type: 'SET_GPIO_IDEAL', id: 0, pin, level });
      break;
    }

    case 'SET_ULTRASONIC_DISTANCE': {
      const { trigPin, echoPin, distanceCm } = payload as {
        trigPin: number;
        echoPin: number;
        distanceCm: number;
      };
      ultrasonicDistances.set(trigPin, distanceCm);
      ultrasonicDistances.set(echoPin, distanceCm);
      if (realModule && hasEmscriptenExport(realModule, 'pal_wasm_set_ultrasonic_distance')) {
        // echoPin first: C-side dal_ultrasonic reads echo_pin via pal_gpio_pulse_in
        callEmscriptenExport(realModule, 'pal_wasm_set_ultrasonic_distance', echoPin, distanceCm);
        callEmscriptenExport(realModule, 'pal_wasm_set_ultrasonic_distance', trigPin, distanceCm);
      }
      break;
    }

    case 'OBSERVE_PINS': {
      const { pins, oled, actuatorSources } = payload;
      observedPins.clear();
      pins.forEach((p: number) => observedPins.add(p));
      hasOled = oled;
      observedActuatorSources = actuatorSources ?? [];
      break;
    }

    case 'SET_FAULTS': {
      simWorker!.handleMessage({ type: 'SET_FAULTS', id: 0, faults: payload });
      break;
    }

    case 'SET_SPEED': {
      speedMultiplier = payload;
      break;
    }
  }
};
