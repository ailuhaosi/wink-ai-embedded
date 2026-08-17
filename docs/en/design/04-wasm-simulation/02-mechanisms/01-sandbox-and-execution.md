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
| **Landed** | **Landed** (Worker / Asyncify / INTERACTIVE & HEADLESS / Linker flags); build output paths depend on local emsdk |
| Supporting Axis | **Cross-Cutting** (Host / Execution Modes; Interacts with B/D/E) |
| Associated Code | `wink-micro-os/targets/wasm/`, `wink-micro-os/osal/wasm/pal_osal_wasm.c`, `wink-micro-os/targets/wasm/exported_runtime_functions.json`, `wink-micro-os/targets/wasm/wink_sim_js.js`, `@wink-ai/unisim` (SimWorker / WasmBridge) |
| Last Audit | 2026-08-02 |
| Governing ADRs | [0002](../../../decisions/unisim/0002-dual-target-compilation.md), [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md), [0019](../../../decisions/unisim/0019-wasm-imports-override-and-asyncify-syntax.md), [0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md), [0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| Migrated From | `04-wasm-simulation-2.0/02-sandbox-and-execution.md` |

> This document answers: How Wasm instances are loaded by the host, how blocking calls avoid freezing Workers, how INTERACTIVE and HEADLESS execution modes work, and what the build linker flags are. Virtual clock mechanisms are in [02](./02-virtual-clock.md), scheduler in [03](./03-scheduler-and-concurrency.md), and interrupt polling in [04](./04-interrupt-model.md).

---

## 1. Web Worker Thread Isolation

### 1.1 Why Workers are Mandatory

If embedded C `while(1)` / FreeRTOS-style loops run on the browser UI main thread, they occupy the event loop for extended periods, freezing UI rendering at 60 FPS. The architecture enforces:

- **Dedicated Web Worker** running the Wasm sandbox;
- Main UI thread handles message-driven rendering via `postMessage` (pin states, OLED frames, logs);
- User inputs (buttons, sliders) are also posted into the Worker via messages.

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

Build (under `wink-micro-os/`):

```powershell
# Activate emsdk (PowerShell)
D:\software\embedded\emsdk\emsdk_env.ps1
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm
# Switch App: -DWINK_APP_DIR=<abs path to app dir>
```

Outputs:

- `build-wasm/wink_simulator.wasm`: Single binary (uncompressed);
- `build-wasm/wink_simulator.js`: MODULARIZE glue, `EXPORT_NAME=WasmSandbox` (UMD export), default `js_*` stubs injected by `wink_sim_js.js`.

App injection contract (see `02-wink-micro-os/03-directory-architecture.md`): App CMakeLists exports sources with `set(WINK_APP_SOURCES ... PARENT_SCOPE)`. Wasm provides **one shared binary target** across all App variants (symmetrical with host "one executable per App").

### 1.4 Node-Side Smoke Testing in This Repo

`wink-micro-os/targets/wasm/wink_sim_stub.js` serves as a **compile-time contract check**, not a host replacement:

1. Statically parses `wink_simulator.wasm` `env.js_*` import set, comparing against expected set (drift triggers failure);
2. Loads `wink_simulator.js` inside `worker_threads.Worker`; `onRuntimeInitialized` marks PASS.

Must run inside a Worker: Coexistence of Emscripten 6.x Asyncify unwind→rewind with the Node main event loop starves timers and leads to OOM (empirically tested).

---

## 2. Emscripten Asyncify Coroutine Suspension (ADR-0019)

### 2.1 Problem: Blocking Calls & Event Loops

Blocking calls like `pal_os_sleep_ms(100)` in a single Worker thread would block `onmessage` if implemented via busy-wait. Asyncify suspends the Wasm stack (registers/call frames) at import points, returning control to the event loop, and restores the stack upon expiration to continue execution.

### 2.2 3-Part Contract (Missing Any Part Causes Silent Failure)

The three-part contract established in ADR-0019:

1. **C/Linker side**: `-sASYNCIFY_IMPORTS=[...]` declares which imports are asynchronous yield points (the correct flag is `ASYNCIFY_IMPORTS`, **not** `ASYNCIFY_ONLY`/`ASYNCIFY_ADD`). Currently:
   ```json
   "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"]
   ```
2. **JS Library side (`--js-library`)**: Library functions must **both** return a Promise **and** carry `<symbol>__async: 'auto'` metadata. Emscripten 6.x's `src/jsifier.mjs:482` only wraps `Asyncify.handleAsync` when `__async === 'auto'`; `__async: true` is **ineffective** (Promise discarded, Wasm returns immediately without diagnostics).
3. **Hand-written sleep side**: Use `return new Promise(resolve => scheduleWakeAt(clock.getUs()+..., resolve))`; `resolve`/`wakeUp` must be called exactly once.

> Historical lesson: Older documentation used symbol names like `js_pal_delay_ms`/`js_pal_delay_us`—these have been superseded by `js_pal_os_sleep_ms`/`js_pal_os_busy_wait_us`; clock reads via `js_pal_get_ms/us` have been **removed** (C directly reads `s_virtual_us` memory).

### 2.3 Wrapper Pattern (Default Stubs)

In `wink-micro-os/targets/wasm/wink_sim_js.js`, every `js_*` symbol in `wasm_bridge.h` is a wrapper:

```javascript
function(/*...*/) {
  if (typeof Module.js_pal_gpio_write === 'function') return Module.js_pal_gpio_write.apply(null, arguments);
  /* Default stub */
}
```

- The host (Workbench) does not re-declare symbols in libraries, but assigns `Module.js_pal_gpio_write = fn` in Module factory configuration (recommended, effective before first invocation), or assigns onto the instance after factory creation (must be prior to first Wasm invocation).
- Three verified conclusions under emcc 6.x: (a) Top-level `Module.js_* = fn` alone is ineffective; per-symbol Module lookup wrappers are required; (b) `__async: true` does not trigger automatic wrapping; (c) Wasm symbols can only be overridden, not added—missing `js_*` results in `abort('missing function')`. Order for adding new symbols: Add `wasm_bridge.h` extern → Add `wink_sim_js.js` default wrapper stub → Recompile.

### 2.4 Promise Contract (Mandatory for Frontend Implementers)

Host overrides for `js_pal_os_sleep_ms` / `js_pal_os_busy_wait_us` **must return a Promise**. Synchronous returns cause infinite unwind→rewind loops without diagnostics. The sole type defense is `@wink-ai/unisim`'s `WasmImports` interface annotating these two as `Promise<void>`.

Startup requirements:

1. `return new Promise(...)`, do not bare-return after `setTimeout`;
2. `wakeUp`/`resolve` exactly once;
3. Launch with `Module.callMain()`, **do not** use `Module._main()` (under MODULARIZE+ASYNCIFY, only callMain correctly handles the instrumented main); main is a never-returning scheduling loop, JS must not `await callMain()`;
4. Wasm must be loaded inside a Worker (main thread observed 20s heap exhaustion).

### 2.5 Compiler & Linker Flags (Verified Against Actual Link Command)

Key parameters matching `wink-micro-os/targets/wasm/exported_runtime_functions.json` and actual `link.txt`:

| Parameter | Value | Meaning |
|---|---|---|
| `ASYNCIFY` | 1 | Enables coroutine stack suspension |
| `ASYNCIFY_IMPORTS` | `['js_pal_os_sleep_ms','js_pal_os_busy_wait_us']` | Whitelisted suspension points |
| `ASYNCIFY_STACK_SIZE` | 65536 | Asynchronous stack 64 KiB (initial value, tuned per deepest AI-generated call graph) |
| `WASM_BIGINT` | 1 | uint64 clock ↔ JS bigint ([ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)) |
| `STACK_OVERFLOW_CHECK` | 2 | Stack overflow check (dev/debug) |
| `ASSERTIONS` | 1 | Runtime assertions (dev/debug) |
| `MODULARIZE` / `EXPORT_NAME` | 1 / `WasmSandbox` | UMD factory export |
| `EXPORTED_FUNCTIONS` | `_main`,`_malloc`,`_free` | Explicit exports |
| `EXPORTED_RUNTIME_METHODS` | `ccall`,`cwrap`,`HEAPU8`,`Asyncify`,`callMain` | Runtime methods |
| `ERROR_ON_UNDEFINED_SYMBOLS` | 0 | Undefined symbols do not error (provided by runtime wrappers) |

> Clock reads are zero-JS memory direct reads: `pal_os_get_us/ms()` reads `s_virtual_us`; clock advances via C→JS **export** `pal_wasm_advance_virtual_clock(bigint)`. No JS→C `get_ms/get_us` imports exist.

---

## 3. Execution Modes: INTERACTIVE and HEADLESS (ADR-0042)

### 3.1 Motivation

In INTERACTIVE mode, idle periods yield via `js_pal_os_sleep_ms` Asyncify suspension; during sleep-heavy CI/Node tests, unwind/rewind is extremely slow (10s simulation time takes 5~30s wall-clock time). HEADLESS mode leaps virtual clock directly within the C scheduling loop when all tasks are waiting, bypassing Asyncify and increasing throughput by **100~1000x**.

### 3.2 Two Modes

| Mode | Applicable To | Idle Behavior | External Events | WCET 8002 |
|---|---|---|---|---|
| **INTERACTIVE** (Default) | Browser UI / 3D | Yields via `js_pal_os_sleep_ms` Asyncify; JS advances clock and wakes up | Supports dynamic injection | Enabled (Wall-clock fallback) |
| **HEADLESS** | Node Unit Tests / CI | C main loop leaps `s_virtual_us` directly to `next_wakeup_us` and continues, **Zero Asyncify** | JS main thread blocked; requires preloaded event queue / C-side autonomous physics / time-slicing | **Bypassed** (Instant virtual time jumps; wall-clock comparisons meaningless, avoiding killing Monte Carlo or compute-heavy loops) |

Switching: C→JS exports `pal_wasm_set_sim_mode(mode)` / `pal_wasm_get_sim_mode()` (type `wink_sim_mode_t`). Host side has equivalents in `wink-micro-os/osal/host/pal_osal_host.c`. unisim `WasmExports` types and `ssotAlignment.test.ts` must stay synchronized.

### 3.3 Virtual Clock Single Gate Redline (R-VC-1)

While introducing the second writer in HEADLESS, ADR-0042 refactored ADR-0003's "single write entry" into a **single Gate**:

- Static private function `wink_vclock_advance_internal()` is the **sole assignment point** for `s_virtual_us`;
- Two legitimate callers: (a) Exported `pal_wasm_advance_virtual_clock()` (JS path, INTERACTIVE); (b) Leaps within HEADLESS scheduling loop;
- **No other code may directly write `s_virtual_us`**; `pal_delay_ms/us` is prohibited from stepping (double stepping is a C14-level escape).

### 3.4 HEADLESS Constraints

- The scheduling loop does not yield control; during execution, the JS main thread is blocked, preventing dynamic input injection mid-flight. Tests must: preload event queues, use C-side self-contained physics engines, or execute in time-sliced segments.
- Mandatory unit test: `test_sim_scheduler_headless_jump` (fast virtual clock leaping).

### 3.5 CI and Execution Mode (Contract)

HEADLESS **bypasses Asyncify and WCET**, providing high throughput; however, an entire class of defects (Asyncify stack corruption, yield ordering, Promise contract violations) are **unreproducible** in pure HEADLESS CI.

| Purpose | Mode | Landing |
|---|---|---|
| Throughput / Deterministic algorithms / No-yield compute paths | HEADLESS | Landed usage |
| Yield-heavy / Interleaved sleep / IRQ+Asyncify / Deep call stacks | **At least one suite** must use INTERACTIVE | **Planned** (CI quality gate not yet enforced; review discipline precedes) |

Evidence and Accuracy orthogonality explanations are in [`11-accuracy-observation-lifecycle.md`](./11-accuracy-observation-lifecycle.md). Roadmap: [Review closure C7](../../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md).

---

## 4. Shared Memory & Zero-Copy Data Reading

High-frequency I2C/UART transmissions do not copy bytes, but construct `Uint8Array` views on Wasm linear memory:

```javascript
// write_buf / read_buf are wasm linear memory offsets (pointers)
const writeView = new Uint8Array(Module.HEAPU8.buffer, write_buf, write_len);
bus.write(dev_addr, writeView);          // Synchronous slice in same Worker
const readView  = new Uint8Array(Module.HEAPU8.buffer, read_buf, read_len);
readView.set(responseData);              // Backfill
```

Key points (see [08](./08-channel-routing.md), [10](./10-wasm-js-bridge-abi.md)):

- It is a **synchronous Heap slice in the same Worker** → `I2CBus`/`SPIBus`/`UARTBus` plugin parsers; **not** cross-thread MessageChannel zero-copy;
- Bus transmissions currently carry synchronous semantics (Phase 3 will introduce asynchronous DMA windows, see C8);
- During Asyncify sleeping windows, `HEAPU8` views may point to stale content—reading/writing heap during sleeping windows is prohibited ([10 ABI #6](./10-wasm-js-bridge-abi.md)).

---

## 5. STRICT_NONBLOCKING Build Implementation (How to Do)

> **Why** (discipline motivation, pragma classification, business callback bans) see [`../01-overview/04-methodology.md` §4](../01-overview/04-methodology.md#4-strict_nonblocking-and-bringup-isolation). **Scheduler-side** WCET / LIGHT context assertions / `app_loop` discipline see [`./03-scheduler-and-concurrency.md` §8](./03-scheduler-and-concurrency.md#8-strict_nonblocking-compile-time-gate-adr-0025). Specification basis: [ADR-0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md).

### 5.1 CMake Default & Escape Hatch

`wink-micro-os/CMakeLists.txt` defaults strict nonblocking for **`wink_simulator` App source files** (`WINK_APP_SOURCES`):

```cmake
# ADR-0017/0025 Stage 5: sim target defaults to STRICT_NONBLOCKING=1 for
# app source files. PAL sources are NOT affected (they implement the
# blocking APIs). Escape hatch: -DWINK_STRICT_NONBLOCKING=0.
set(WINK_STRICT_NONBLOCKING 1 CACHE STRING "Enable strict nonblocking for app sources")
if(WINK_STRICT_NONBLOCKING)
    set_source_files_properties(${WINK_APP_SOURCES} PROPERTIES
        COMPILE_DEFINITIONS WINK_STRICT_NONBLOCKING=1)
endif()
```

Key points:

- **Scope**: App business sources only; PAL/DAL implementation layers are **unaffected** (they must implement blocking API bodies for physical hardware builds).
- **Link-time fail-fast**: Under `-DWINK_STRICT_NONBLOCKING=1`, `WINK_BLOCKING` APIs (such as blocking `dal_ultrasonic_read`) **disappear** behind `#ifndef WINK_STRICT_NONBLOCKING` in headers; App misuses trigger **undefined reference**, rather than silently running under Asyncify.
- **Escape hatch**: Pass `-DWINK_STRICT_NONBLOCKING=0` during configuration to disable (for bringup debugging, transitional unit tests, etc.); simulation and CI primary paths **must not** disable by default.

### 5.2 Bringup / Selftest Isolation

Blocking auxiliary tools reside in `wink-micro-os/runtime/selftest/`, with declarations and implementations wrapped by `#ifndef WINK_STRICT_NONBLOCKING` at file level (e.g. `wink_sim_ultrasonic_echo.h`). Under strict mode:

- Selftest bodies are **not compiled into** `wink_simulator`;
- Externally exposed stubs return `WINK_ERR_UNSUPPORTED`, preventing blocking code from entering the simulation sandbox;
- Bringup instruments (GPIO short tests, ultrasonic echo loopback, etc.) **must not** be placed in `samples/common/` or App source trees.

### 5.3 Boundaries with Asyncify & HEADLESS

STRICT_NONBLOCKING is a **compile-time** defense, orthogonal to §2 Asyncify suspension and §3 HEADLESS fast-forwarding:

- Legitimate idle paths: `pal_os_sleep_ms` → Asyncify (INTERACTIVE) or scheduler virtual clock jumps (HEADLESS);
- Illegal paths: App/BAL directly calling `WINK_BLOCKING` DAL APIs → Link failure under strict builds, rather than relying on Asyncify to make blocking calls "appear to work".
