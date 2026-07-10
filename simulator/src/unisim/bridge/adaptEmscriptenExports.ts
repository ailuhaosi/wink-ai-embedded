import type { WasmExports } from '../types/wasm/exports';
import type { RawModule } from '../worker/WasmPhysicalBridge';

export type EmscriptenModuleLike = Record<string, unknown>;

/**
 * Resolve an Emscripten MODULARIZE export by name.
 * Glue exposes most KEEPALIVE symbols on Module as `_name` (e.g. `_pal_os_get_us`),
 * while UniSim's WasmExports contract uses unprefixed names (`pal_os_get_us`).
 */
export function resolveEmscriptenExport(
  module: EmscriptenModuleLike,
  name: string,
): unknown {
  const underscored = module[`_${name}`];
  if (underscored !== undefined) return underscored;
  return module[name];
}

export function hasEmscriptenExport(module: EmscriptenModuleLike, name: string): boolean {
  return typeof resolveEmscriptenExport(module, name) === 'function';
}

/** Lazy Proxy: safe to pass to SimWorker before wasm instantiation completes. */
export function createEmscriptenExportsAdapter(
  getModule: () => EmscriptenModuleLike | null,
): WasmExports {
  return new Proxy({} as WasmExports, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      const module = getModule();
      if (!module) {
        throw new Error(`Wasm exports accessed before instantiation completed (${prop})`);
      }
      const resolved = resolveEmscriptenExport(module, prop);
      if (typeof resolved === 'function') {
        return resolved.bind(module);
      }
      if (resolved === undefined) {
        throw new TypeError(`Missing wasm export: ${prop}`);
      }
      return resolved;
    },
  });
}

export function adaptEmscriptenRawModule(module: EmscriptenModuleLike): RawModule {
  const malloc = resolveEmscriptenExport(module, 'malloc');
  const free = resolveEmscriptenExport(module, 'free');
  const heap = module.HEAPU8;

  if (typeof malloc !== 'function' || typeof free !== 'function') {
    throw new TypeError(
      'Emscripten module missing _malloc/_free on Module; rebuild wasm with EXPORTED_RUNTIME_METHODS including _malloc,_free',
    );
  }
  if (!(heap instanceof Uint8Array)) {
    throw new TypeError('Emscripten module missing HEAPU8');
  }
  return {
    _malloc: malloc as RawModule['_malloc'],
    _free: free as RawModule['_free'],
    HEAPU8: heap,
  };
}

export function callEmscriptenExport(
  module: EmscriptenModuleLike,
  name: string,
  ...args: unknown[]
): unknown {
  const fn = resolveEmscriptenExport(module, name);
  if (typeof fn !== 'function') {
    throw new TypeError(`Wasm export "${name}" is not a function`);
  }
  return fn.apply(module, args);
}
