/**
 * installUnisimBridge — apply a WasmImports object onto an Emscripten Module.
 *
 * wink_sim_js.js (ADR-0019 wrapper mode, shipped Task 0) checks
 * `Module.js_xxx` on every wasm import call and delegates when set. This
 * function performs that assignment for every field in one shot, in a way
 * TypeScript can verify: because it iterates over `Object.keys(imports)`
 * (which at runtime are the 13 members produced by createUnisimImports),
 * a missing member is a type error at the createUnisimImports layer, not
 * here — this function is the "just wire it" layer.
 *
 * Timing: ADR-0019 requires this be called BEFORE the wasm first invokes
 * any wrapped import. Both factory-config and post-factory application are
 * valid (see wink_sim_js.js header). This function does post-factory.
 */
import type { WasmImports } from '../types/wasm/imports';

/**
 * Minimal Module shape we depend on. Emscripten Module has many more
 * properties (HEAPU8, _malloc, etc.); we only need to assign onto it.
 * Using an index signature keeps typing loose enough that the caller
 * can pass a real Emscripten Module without a cast.
 */
export interface EmscriptenModuleLike {
  [key: string]: unknown;
}

export function installUnisimBridge(module: EmscriptenModuleLike, imports: WasmImports): void {
  // Object.keys over the imports narrows to string; casting to keyof
  // WasmImports lets us index-typedly assign. This is safe because
  // createUnisimImports produced the object with exactly those keys.
  for (const key of Object.keys(imports) as Array<keyof WasmImports>) {
    module[key] = imports[key];
  }
}
