# Wasm Sandbox, Worker Isolation, Asyncify & Execution Modes

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/01-sandbox-and-execution.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Landed** (Worker / Asyncify / INTERACTIVE & HEADLESS / Linker flags) |
| Supporting Axis | **Cross-Cutting** (Host / Execution Modes; Interacts with B/D/E) |
| Associated Code | `wink-micro-os/targets/wasm/`, `wink-micro-os/osal/wasm/pal_osal_wasm.c`, `wink-micro-os/targets/wasm/exported_runtime_functions.json`, `wink-micro-os/targets/wasm/wink_sim_js.js`, `@wink-ai/unisim` (SimWorker / WasmBridge) |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0002](../../../decisions/unisim/0002-dual-target-compilation.md), [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md), [0019](../../../decisions/unisim/0019-wasm-imports-override-and-asyncify-syntax.md), [0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| Migrated From | `04-wasm-simulation-2.0/02-sandbox-and-execution.md` |

> This document defines how Wasm sandboxes are hosted, how blocking delays yield without freezing workers, how INTERACTIVE and HEADLESS modes function, and link-time configurations.

---

## 1. Web Worker Thread Isolation

### 1.1 Why Workers are Mandatory

If embedded C `while(1)` event loops run on the browser UI thread, they starve the event loop, freezing UI rendering at 60 FPS. The architecture enforces:
- **Dedicated Web Worker** hosting the Wasm sandbox;
- Main UI thread processes message-driven rendering via `postMessage` (pin states, OLED buffers, logs);
- User interactions (buttons, sliders) post messages into the Worker.

### 1.2 Lifecycle Data Flow

```text
(1) UI postMessage {type:'start', wasmBytes}
(2) Worker WebAssembly.instantiate()
(3) Module.callMain() → main() → Scheduler Init → App Loop
        │ C calls pal_gpio_write
(4) Worker postMessage {type:'pin_write', pin, lvl} → UI updates
(5) User clicks virtual button → UI postMessage {type:'pin_input', pin, lvl}
(6) Worker writes virtual pin state (PinArbiter / InterruptQueue)
(7) {type:'pause'}  → Suspends Wasm coroutine
(8) {type:'resume'} → Resumes
(9) {type:'stop'}   → Destroys instance + Worker
```

### 1.3 Binary Output & App Injection

Build command (in `wink-micro-os/`):

```powershell
# Activate emsdk (PowerShell)
D:\software\embedded\emsdk\emsdk_env.ps1
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm
# Switch App: -DWINK_APP_DIR=<abs path to app dir>
```

Outputs:
- `build-wasm/wink_simulator.wasm`: Single uncompressed binary;
- `build-wasm/wink_simulator.js`: MODULARIZE glue exporting `EXPORT_NAME=WasmSandbox` (UMD export), with default stubs injected via `wink_sim_js.js`.

App injection: App `CMakeLists.txt` exports sources via `set(WINK_APP_SOURCES ... PARENT_SCOPE)`.

### 1.4 Node Smoke Testing

`wink-micro-os/targets/wasm/wink_sim_stub.js` serves as a **compile-time contract check**:
1. Statically inspects `wink_simulator.wasm` `env.js_*` imports against expected sets (drifts trigger failure);
2. Loads `wink_simulator.js` inside `worker_threads.Worker`; `onRuntimeInitialized` marks PASS.

---

## 2. Emscripten Asyncify Coroutine Suspension (ADR-0019)

### 2.1 Problem: Blocking Delays & Event Loops

Blocking delays (`pal_os_sleep_ms(100)`) in a single-threaded Worker block `onmessage` handling if implemented as busy-waits. Asyncify suspends the Wasm stack (registers/call frames) at import points, yielding control to the JavaScript event loop, and resumes execution upon expiration.

### 2.2 3-Part Contract

1. **C / Linker**: Declares asynchronous yield points via `-sASYNCIFY_IMPORTS=[...]`:
   ```json
   "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"]
   ```
2. **JS Library (`--js-library`)**: Library functions must **both** return a Promise **and** carry `<symbol>__async: 'auto'` metadata. Emscripten 6.x only wraps `Asyncify.handleAsync` when `__async === 'auto'`.
3. **Sleep Implementation**: `return new Promise(resolve => scheduleWakeAt(clock.getUs()+..., resolve))`; `resolve`/`wakeUp` must be called exactly once.

### 2.3 Wrapper Pattern (Default Stubs)

Symbols in `wink-micro-os/targets/wasm/wink_sim_js.js` follow the wrapper pattern:

```javascript
function(/*...*/) {
  if (typeof Module.js_pal_gpio_write === 'function') return Module.js_pal_gpio_write.apply(null, arguments);
  /* Default stub */
}
```

### 2.4 Promise Contract

Host overrides for `js_pal_os_sleep_ms` / `js_pal_os_busy_wait_us` **must return a Promise**. Synchronous returns cause infinite unwind/rewind loops.

Execution mandates:
1. `return new Promise(...)`;
2. Resolve exactly once;
3. Launch with `Module.callMain()`, never `Module._main()`;
4. Always host Wasm inside Workers.

### 2.5 Compiler & Linker Flags

Key parameters in `wink-micro-os/targets/wasm/exported_runtime_functions.json`:

| Parameter | Value | Meaning |
|---|---|---|
| `ASYNCIFY` | 1 | Enables coroutine stack suspension |
| `ASYNCIFY_IMPORTS` | `['js_pal_os_sleep_ms','js_pal_os_busy_wait_us']` | Whitelisted suspension points |
| `ASYNCIFY_STACK_SIZE` | 65536 | Asynchronous stack buffer (64 KiB) |
| `WASM_BIGINT` | 1 | uint64 timestamps $\leftrightarrow$ JS BigInt ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)) |
| `STACK_OVERFLOW_CHECK` | 2 | Stack overflow detection (dev/debug) |
| `ASSERTIONS` | 1 | Runtime assertions (dev/debug) |
| `MODULARIZE` / `EXPORT_NAME` | 1 / `WasmSandbox` | UMD module export |
| `EXPORTED_FUNCTIONS` | `_main`,`_malloc`,`_free` | Exported symbols |
| `EXPORTED_RUNTIME_METHODS` | `ccall`,`cwrap`,`HEAPU8`,`Asyncify`,`callMain` | Runtime helpers |
| `ERROR_ON_UNDEFINED_SYMBOLS` | 0 | Unresolved symbols handled by runtime wrappers |

---

## 3. Execution Modes: INTERACTIVE & HEADLESS (ADR-0042)

### 3.1 Motivation

In INTERACTIVE mode, idle periods yield via `js_pal_os_sleep_ms` through Asyncify, incurring unwind/rewind overhead in automated CI tests. In HEADLESS mode, the C scheduler loop advances virtual time directly without Asyncify, improving throughput by **100–1000x**.

### 3.2 Mode Comparison

| Mode | Target Use Case | Idle Behavior | External Events | WCET 8002 |
|---|---|---|---|---|
| **INTERACTIVE** (Default) | Browser UI / 3D Canvas | Yields via `js_pal_os_sleep_ms` Asyncify; JS advances clock | Supports dynamic injection | Enabled (Wallclock fallback) |
| **HEADLESS** | Node Unit Tests / CI | C loop skips `s_virtual_us` directly to `next_wakeup_us`; **Zero Asyncify** | JS thread blocked; requires preloaded queues | **Bypassed** (Instant jumps; prevents false kills on compute) |

Switching: Exported C APIs `pal_wasm_set_sim_mode(mode)` / `pal_wasm_get_sim_mode()`.

### 3.3 Virtual Clock Single Gate Rule (R-VC-1)

Static internal function `wink_vclock_advance_internal()` is the **sole assignment point** for `s_virtual_us`, called exclusively by:
1. Exported `pal_wasm_advance_virtual_clock()` (JS path in INTERACTIVE mode);
2. HEADLESS scheduler jump logic.

Direct writes to `s_virtual_us` from other paths are strictly forbidden.

---

## 4. Shared Memory & Zero-Copy Data Reading

High-speed I2C/UART transmissions construct `Uint8Array` views directly over Wasm linear memory:

```javascript
const writeView = new Uint8Array(Module.HEAPU8.buffer, write_buf, write_len);
bus.write(dev_addr, writeView);
const readView  = new Uint8Array(Module.HEAPU8.buffer, read_buf, read_len);
readView.set(responseData);
```

---

## 5. STRICT_NONBLOCKING Build Implementation

### 5.1 CMake Default & Escape Hatch

`wink-micro-os/CMakeLists.txt` enforces strict non-blocking flags on App sources (`WINK_APP_SOURCES`):

```cmake
set(WINK_STRICT_NONBLOCKING 1 CACHE STRING "Enable strict nonblocking for app sources")
if(WINK_STRICT_NONBLOCKING)
    set_source_files_properties(${WINK_APP_SOURCES} PROPERTIES
        COMPILE_DEFINITIONS WINK_STRICT_NONBLOCKING=1)
endif()
```

- **Scope**: Applied to App sources only; PAL/DAL implementations are unaffected.
- **Link-Time Fail-Fast**: Functions declared with `WINK_BLOCKING` disappear behind `#ifndef WINK_STRICT_NONBLOCKING`, causing illegal calls in App code to fail with **undefined reference**.

### 5.2 Bringup / Selftest Isolation

Blocking test tools reside in `wink-micro-os/runtime/selftest/`, isolated behind `#ifndef WINK_STRICT_NONBLOCKING`. Under strict builds, stubs return `WINK_ERR_UNSUPPORTED`.

### 5.3 Boundaries with Asyncify & HEADLESS

- Legitimate idle: `pal_os_sleep_ms` $\rightarrow$ Asyncify (INTERACTIVE) or direct virtual clock stepping (HEADLESS);
- Illegal blocking: Direct calls to `WINK_BLOCKING` DAL APIs fail at link time.
