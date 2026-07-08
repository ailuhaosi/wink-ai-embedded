/**
 * ssotAlignment.test.ts — Guards the boundary between wasm_bridge.h (C SSOT)
 * and the TS interfaces WasmImports / WasmExports.
 *
 * Rationale: WasmImports (Task 2) and WasmExports (Task 6) declare the JS side
 * of the ABI. wasm_bridge.h declares the C side. If a symbol is added to only
 * one side, `wink_sim_stub.js` catches it at wasm-link time (stray import), but
 * that's a runtime signal — this test fails at Jest time so a PR that only
 * touches TS can't land in a state where it silently missed a header addition.
 *
 * Two-layer alignment:
 *   1. Symbol names — Object.keys() vs. header extern name set
 *   2. Signatures   — hand-maintained EXPECTED_SIGNATURES vs. header-parsed
 *                     normalized signature strings. Catches "same name, diff
 *                     types" (e.g. float duty -> uint8_t duty_permil).
 *
 * Parser limitations:
 * - Regex matches the extern NAME + opening '(' on the same line. The return
 *   type and parameter list may span multiple lines (wasm_bridge.h's
 *   pal_i2c_transfer and pal_wasm_set_pin_power_model already do). To collect
 *   the full signature we consume through the matching close paren, then
 *   normalize whitespace.
 * - There is no `#if` conditional-symbol whitelist — none of the current
 *   externs sit behind #ifdef. If that changes, extend the parser to strip
 *   inactive #if branches first.
 * - Backup assertion (`test 'both multi-line externs are captured'`) fails
 *   loudly if a future refactor breaks the multi-line capture path.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { WasmImports } from '../types/wasm/imports';
import type { WasmExports } from '../types/wasm/exports';

const HEADER_PATH = path.resolve(
  __dirname,
  '../../../../wink-micro-os/targets/wasm/wasm_bridge.h',
);

// Locates the START of an extern declaration: the return-type-and-name prefix
// followed by '('. Return type and args may then span multiple lines until the
// matching close paren.
const EXTERN_START_RE = /\bextern\s+([\w\s\*]+?)\s+(\w+)\s*\(/g;

interface ParsedExtern {
  name: string;
  signature: string; // normalized "returnType(argType, argType, ...)"
}

/** Extract every extern declaration with a normalized signature. */
function parseExterns(header: string): Map<string, string> {
  // Strip line and block comments up-front so they can't confuse the regex.
  const stripped = header
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  const results = new Map<string, string>();
  EXTERN_START_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EXTERN_START_RE.exec(stripped)) !== null) {
    const retRaw = m[1];
    const name = m[2];
    // From m.index + m[0].length, consume until matching close paren.
    let depth = 1;
    let i = EXTERN_START_RE.lastIndex;
    while (i < stripped.length && depth > 0) {
      const ch = stripped[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
      if (depth === 0) break;
    }
    const argsRaw = stripped.slice(EXTERN_START_RE.lastIndex, i - 1);
    results.set(name, normalizeSignature(retRaw, argsRaw));
  }
  return results;
}

function normalizeSignature(retRaw: string, argsRaw: string): string {
  const ret = normalizeType(retRaw);
  const args = argsRaw
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && a !== 'void')
    // drop the argument NAME (last identifier); keep the type only.
    // Match either: "type name" (space between) or "type*name" (pointer immediately before name).
    .map((a) => a.replace(/(\*?)\s*\w+\s*$/, '$1').trim())
    .map(normalizeType);
  return `${ret}(${args.join(',')})`;
}

function normalizeType(t: string): string {
  return t
    .replace(/\bconst\b/g, '')
    .replace(/\bstruct\b/g, '')
    .replace(/\bEMSCRIPTEN_KEEPALIVE\b/g, '')
    .replace(/\s*\*\s*/g, '*')
    .replace(/\s+/g, ' ')
    .trim();
}

// Hand-maintained expected signatures — kept ALONGSIDE the TS interface so a
// TS-only signature change fails this test until the header (or the map) is
// updated to match. Updating the map without updating the header is caught
// against the header-parsed set below.
const EXPECTED_IMPORT_SIGNATURES: Record<keyof WasmImports, string> = {
  js_pal_gpio_write: 'void(uint16_t,bool)',
  js_pal_gpio_read: 'bool(uint16_t)',
  js_pal_pwm_set_duty: 'void(uint8_t,float)',
  js_pal_i2c_transfer: 'bool(uint8_t,uint16_t,uint8_t*,uint32_t,uint8_t*,uint32_t)',
  js_pal_register_interrupt: 'void(uint16_t,uint32_t,uint32_t)',
  js_pal_deregister_interrupt: 'void(uint16_t)',
  js_pal_poll_interrupt: 'bool(uint32_t*,uint32_t*)',
  js_pal_os_sleep_ms: 'void(uint32_t)',
  js_pal_os_busy_wait_us: 'void(uint32_t)',
  js_pal_log: 'void(uint8_t,char*)',
  js_sim_trigger_ultrasonic: 'void(uint16_t)',
  js_sim_measure_echo_pulse_us: 'uint32_t(uint16_t)',
};

const EXPECTED_EXPORT_SIGNATURES: Record<keyof WasmExports, string> = {
  pal_wasm_advance_virtual_clock: 'void(uint64_t)',
  pal_os_get_us: 'uint64_t()',
  pal_wasm_is_clock_warning_fired: 'bool()',
  pal_wasm_get_virtual_clock_us: 'uint64_t()',
  pal_wasm_set_bounce_us: 'void(uint32_t)',
  pal_wasm_set_warmup_us: 'void(uint32_t)',
  pal_wasm_set_sample_interval_us: 'void(uint32_t)',
  pal_wasm_set_adc_noise_v: 'void(float)',
  pal_wasm_set_rc_tau_s: 'void(float)',
  pal_wasm_set_i2c_drop_permil: 'void(uint16_t)',
  pal_wasm_set_prng_seed: 'void(uint32_t)',
  pal_wasm_reset_physical: 'void()',
  pal_wasm_get_prng_state: 'uint32_t()',
  pal_os_get_ms: 'uint64_t()',
  pal_wasm_gpio_read: 'bool(uint16_t)',
  // NOTE: pal_wasm_i2c_transfer is the JS-facing bool wrapper (pointers as raw ABI).
  // See Global Constraint "pal_i2c_transfer wrapping" and Task 6 §Step 1 doc for
  // the _malloc/_free marshalling in WasmPhysicalBridge.
  pal_wasm_i2c_transfer: 'bool(uint8_t,uint16_t,uint8_t*,uint32_t,uint8_t*,uint32_t)',
  pal_wasm_get_fault_log_count: 'uint32_t()',
  pal_wasm_reset_fault_log: 'void()',
  pal_wasm_fault_event_get_timestamp: 'uint64_t(uint32_t)',
  pal_wasm_fault_event_get_type: 'uint8_t(uint32_t)',
  pal_wasm_fault_event_get_pin_or_bus: 'uint16_t(uint32_t)',
  pal_wasm_fault_event_get_sequence: 'uint32_t(uint32_t)',
  pal_wasm_is_faulted: 'bool()',
  // Note: C-side decl is `const char*`; the header parser strips the `const` qualifier.
  pal_wasm_host_fault: 'void(uint32_t,char*)',
  pal_wasm_set_pin_power_model: 'wink_status_t(uint8_t,wasm_pin_power_model_t*)',
  pal_wasm_get_total_energy_mj: 'uint64_t()',
  pal_wasm_sim_reset_all_devices: 'void()',
  pal_wasm_get_ssd1306_fb: 'uint8_t*(uint32_t*,uint32_t*)',
  pal_wasm_get_servo_angle: 'float(uint8_t)',
  pal_wasm_set_ultrasonic_distance: 'void(uint8_t,float)',
  pal_wasm_set_gpio_input: 'void(uint8_t,bool)',
  pal_wasm_get_gpio_output: 'bool(uint8_t)',
};

describe('SSOT alignment: wasm_bridge.h <-> WasmImports/WasmExports', () => {
  const headerText = fs.readFileSync(HEADER_PATH, 'utf8');
  const headerExterns = parseExterns(headerText);
  const headerImports = new Map(
    [...headerExterns].filter(([k]) => k.startsWith('js_')),
  );
  const headerExports = new Map(
    [...headerExterns].filter(([k]) => k.startsWith('pal_')),
  );

  test('parser regression guard: multi-line externs are captured', () => {
    // These two are explicitly multi-line in the current header. If the parser
    // regresses and misses either, this fails BEFORE the more general checks
    // do — clearer diagnostic than a downstream "missing symbol" error.
    expect(headerExterns.has('js_pal_i2c_transfer')).toBe(true);
    expect(headerExterns.has('pal_wasm_set_pin_power_model')).toBe(true);
  });

  test('parser sanity: found some symbols', () => {
    expect(headerImports.size).toBeGreaterThan(0);
    expect(headerExports.size).toBeGreaterThan(0);
  });

  test('WasmImports keyof matches wasm_bridge.h js_* extern set', () => {
    const tsKeys = new Set(Object.keys(EXPECTED_IMPORT_SIGNATURES));
    const missingInTs = [...headerImports.keys()].filter((s) => !tsKeys.has(s));
    const strayInTs = [...tsKeys].filter((s) => !headerImports.has(s));
    expect({ missingInTs, strayInTs }).toEqual({ missingInTs: [], strayInTs: [] });
  });

  test('WasmExports keyof matches wasm_bridge.h pal_* extern set', () => {
    const tsKeys = new Set(Object.keys(EXPECTED_EXPORT_SIGNATURES));
    const missingInTs = [...headerExports.keys()].filter((s) => !tsKeys.has(s));
    const strayInTs = [...tsKeys].filter((s) => !headerExports.has(s));
    expect({ missingInTs, strayInTs }).toEqual({ missingInTs: [], strayInTs: [] });
  });

  test('WasmImports signatures match wasm_bridge.h (return type + arg types)', () => {
    const diffs: Array<{ name: string; expected: string; actual: string }> = [];
    for (const [name, expected] of Object.entries(EXPECTED_IMPORT_SIGNATURES)) {
      const actual = headerImports.get(name);
      if (actual !== expected) {
        diffs.push({ name, expected, actual: actual ?? '<missing>' });
      }
    }
    expect(diffs).toEqual([]);
  });

  test('WasmExports signatures match wasm_bridge.h (return type + arg types)', () => {
    const diffs: Array<{ name: string; expected: string; actual: string }> = [];
    for (const [name, expected] of Object.entries(EXPECTED_EXPORT_SIGNATURES)) {
      const actual = headerExports.get(name);
      if (actual !== expected) {
        diffs.push({ name, expected, actual: actual ?? '<missing>' });
      }
    }
    expect(diffs).toEqual([]);
  });
});
