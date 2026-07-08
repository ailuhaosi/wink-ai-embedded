import { SimWorker } from '@unisim/worker/SimWorker';

// Redirect standard console logging to postMessage so the UI can capture it
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;
const originalDebug = console.debug;

function sendLogToUI(level: 'log' | 'warn' | 'error' | 'info' | 'debug', msg: string) {
  self.postMessage({
    type: 'LOG',
    payload: { level, message: msg, timestamp: Date.now() }
  });
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

// @ts-ignore
import WasmSandbox from '../../../build-wasm/wink_simulator.js';

let simWorker: SimWorker | null = null;
let running = false;
let simTimer: any = null;
let speedMultiplier = 1; // 1x speed: step 1000us per 1ms real-time
const STEP_US = 1000n; // 1ms virtual step

const observedPins = new Set<number>();
let hasOled = false;
const ultrasonicDistances = new Map<number, number>();

// Proxies for deferred initialization of exports and module
let realExports: any = null;
let realModule: any = null;

const exportsProxy = new Proxy({} as any, {
  get(_target, prop) {
    if (!realExports) {
      throw new Error(`Wasm exports accessed before instantiation completed!`);
    }
    return realExports[prop];
  }
});

const moduleProxy = new Proxy({} as any, {
  get(_target, prop) {
    if (!realModule) {
      throw new Error(`Wasm module accessed before instantiation completed!`);
    }
    if (prop === 'HEAPU8') return realModule.HEAPU8;
    return realModule[prop];
  }
});

// Load the WASM sandbox and initialize the SimWorker
async function initSimulator() {
  try {
    console.log('[SimWorker] Loading Emscripten glue...');
    if (!WasmSandbox) {
      throw new Error('WasmSandbox factory function not found in import.');
    }
    
    console.log('[SimWorker] Instantiating SimWorker...');
    simWorker = new SimWorker({
      exports: exportsProxy,
      rawModule: moduleProxy,
      injectGpioIdeal: (pin, level) => {
        if (realExports && realExports.pal_wasm_set_gpio_input) {
          realExports.pal_wasm_set_gpio_input(pin, level);
        }
      },
      ultrasonicEchoUs: (pin) => {
        const dist = ultrasonicDistances.get(pin) ?? 10.0;
        return dist * 58; // 58us per cm
      }
    });
    
    // Get the imports configuration from the worker
    const imports = simWorker.buildWasmImports();
    
    const moduleConfig = {
      ...imports,
      locateFile: (path: string) => {
        if (path.endsWith('.wasm')) {
          return '/wasm/wink_simulator.wasm';
        }
        return path;
      },
      preRun: [(mod: any) => {
        realModule = mod;
      }]
    };
    
    console.log('[SimWorker] Instantiating WASM sandbox...');
    const Module = await WasmSandbox(moduleConfig);
    
    realExports = Module;
    if (!realModule) {
      realModule = Module;
    }
    
    // Initialize the simulator (sends INIT command internally)
    simWorker.handleMessage({ type: 'INIT', id: 0 });
    console.log('[SimWorker] WASM simulation sandbox initialized successfully!');
    
    self.postMessage({ type: 'INIT_DONE' });
  } catch (err: any) {
    console.error(`[SimWorker] Initialization failed: ${err.message}`);
    self.postMessage({ type: 'ERROR', message: err.message });
  }
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
    if (hasOled && realExports && realExports.pal_wasm_get_ssd1306_fb) {
      const wPtr = realModule._malloc(4);
      const hPtr = realModule._malloc(4);
      try {
        const fbPtr = realExports.pal_wasm_get_ssd1306_fb(wPtr, hPtr);
        if (fbPtr) {
          const width = new Uint32Array(realModule.HEAPU8.buffer, wPtr, 1)[0];
          const height = new Uint32Array(realModule.HEAPU8.buffer, hPtr, 1)[0];
          const fbSize = (width * height) / 8;
          oledFb = new Uint8Array(realModule.HEAPU8.buffer, fbPtr, fbSize).slice();
        }
      } finally {
        realModule._free(wPtr);
        realModule._free(hPtr);
      }
    }
    
    // Get trace/fault log list
    const traces: any[] = [];
    if (realExports && realExports.pal_wasm_get_fault_log_count) {
      const count = realExports.pal_wasm_get_fault_log_count();
      for (let i = 0; i < count; i++) {
        traces.push({
          timestamp: realExports.pal_wasm_fault_event_get_timestamp(i).toString(),
          type: realExports.pal_wasm_fault_event_get_type(i),
          pinOrBus: realExports.pal_wasm_fault_event_get_pin_or_bus(i),
          sequence: realExports.pal_wasm_fault_event_get_sequence(i)
        });
      }
    }
    
    const currentUs = simWorker.getBridge().getClockUs().toString();
    const isFaulted = realExports ? realExports.pal_wasm_is_faulted() : false;
    
    self.postMessage({
      type: 'STATE_UPDATE',
      payload: {
        us: currentUs,
        pinStates,
        oledFb,
        traces,
        isFaulted
      }
    });
  } catch (err: any) {
    console.error(`[SimLoop Error] ${err.message}`);
    running = false;
    self.postMessage({ type: 'ERROR', message: err.message });
    return;
  }
  
  // Schedule next tick (16ms targeting ~60Hz update rate)
  simTimer = setTimeout(simLoop, 16);
}

// Receive messages from UI thread
self.onmessage = async (e: MessageEvent<any>) => {
  const { type, payload } = e.data;
  
  if (!simWorker && type !== 'INIT') {
    return;
  }
  
  switch (type) {
    case 'INIT':
      await initSimulator();
      break;
      
    case 'START':
      if (!running) {
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
      self.postMessage({ type: 'RESET_DONE' });
      break;
      
    case 'SET_PIN_IDEAL': {
      const { pin, level } = payload;
      simWorker!.handleMessage({ type: 'SET_GPIO_IDEAL', id: 0, pin, level });
      break;
    }
      
    case 'SET_ULTRASONIC_DISTANCE': {
      const { pin, distanceCm } = payload;
      ultrasonicDistances.set(pin, distanceCm);
      if (realExports && realExports.pal_wasm_set_ultrasonic_distance) {
        realExports.pal_wasm_set_ultrasonic_distance(pin, distanceCm);
      }
      break;
    }
      
    case 'OBSERVE_PINS': {
      const { pins, oled } = payload;
      observedPins.clear();
      pins.forEach((p: number) => observedPins.add(p));
      hasOled = oled;
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
