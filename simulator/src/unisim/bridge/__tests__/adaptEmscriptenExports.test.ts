import { describe, expect, it, vi } from 'vitest';
import {
  adaptEmscriptenRawModule,
  callEmscriptenExport,
  createEmscriptenExportsAdapter,
  hasEmscriptenExport,
  resolveEmscriptenExport,
} from '../adaptEmscriptenExports';

describe('adaptEmscriptenExports', () => {
  const fakeModule = {
    HEAPU8: new Uint8Array(16),
    _pal_os_get_us: () => 42n,
    _malloc: (n: number) => n,
    _free: () => {},
  };

  it('resolves underscored exports first', () => {
    expect(resolveEmscriptenExport(fakeModule, 'pal_os_get_us')).toBe(fakeModule._pal_os_get_us);
  });

  it('adapts exports through proxy for WasmExports names', () => {
    let module: typeof fakeModule | null = null;
    const exports = createEmscriptenExportsAdapter(() => module);
    expect(() => exports.pal_os_get_us).toThrow(/before instantiation/);
    module = fakeModule;
    expect(exports.pal_os_get_us()).toBe(42n);
  });

  it('detects optional exports', () => {
    expect(hasEmscriptenExport(fakeModule, 'pal_os_get_us')).toBe(true);
    expect(hasEmscriptenExport(fakeModule, 'pal_wasm_get_ssd1306_fb')).toBe(false);
  });

  it('calls exports with correct receiver', () => {
    const spy = vi.fn(function (this: unknown) {
      return this;
    });
    const mod = { _pal_wasm_is_faulted: spy };
    callEmscriptenExport(mod, 'pal_wasm_is_faulted');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.instances[0]).toBe(mod);
  });

  it('builds RawModule from malloc/free aliases', () => {
    const raw = adaptEmscriptenRawModule(fakeModule);
    expect(raw._malloc(8)).toBe(8);
    expect(raw.HEAPU8).toBe(fakeModule.HEAPU8);
  });
});
