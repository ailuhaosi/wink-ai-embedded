# 4.1 Wasm Sandbox Lifecycle, Web Worker Isolation & Asyncify Scheduling

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

In a web simulation environment, running embedded C main loops and task schedulers safely, efficiently, and without UI stuttering is a fundamental architectural challenge. This document analyzes the Wasm simulation sandbox lifecycle, Web Worker thread isolation, and asynchronous scheduling based on Emscripten Asyncify and Wasm Table function pointer routing.

---

## 1. Web Worker Thread Isolation Design

### 1.1 Why Web Workers Are Mandatory
Embedded C main loops typically consist of non-terminating `while(1)` constructs or preemptive loops managed by an RTOS scheduler.
- Running WebAssembly directly on the browser's main UI thread exhausts CPU resources immediately, preventing the browser from processing user interactions and freezing rendering.
- **Solution**: The platform utilizes a dedicated **Web Worker** background thread to host the Wasm sandbox, communicating with the main Vue 3 UI thread via asynchronous `postMessage` channels to maintain 60 FPS UI performance.

### 1.2 Thread Interaction Architecture & Lifecycle Data Flow

```text
  [ Frontend UI Main Thread (Vue 3) ]           [ Web Worker Wasm Sandbox Thread ]
             │                                                 │
             │ ─── 1. POST: { type: 'start', wasmBytes } ───►  │
             │                                                 ├─ 2. WebAssembly.instantiate()
             │                                                 ├─ 3. Invoke main() -> Init OSAL scheduler
             │                                                 │
             │                                                 │ (C firmware calls pal_gpio_write)
             │ ◄── 4. POST: { type: 'pin_write', pin, lvl } ───┤
             │                                                 │
      (User clicks virtual button)                             │
             │ ─── 5. POST: { type: 'pin_input', pin, lvl } ──►│
             │                                                 ├─ 6. Update virtual pin state
             │                                                 │
             │ ─── 7. POST: { type: 'pause' } ──────────────►  ├─ 8. Suspend Wasm scheduler fiber
             │ ─── 9. POST: { type: 'stop' } ───────────────►  └─ 10. Destroy Wasm instance & Worker
```

### 1.3 Wasm Binary Build & App Injection Path

From the `wink-micro-os/` root:

```bash
# Activate emsdk environment
& 'D:\software\embedded\emsdk\emsdk_env.ps1'

# Build default sample App
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm
cmake --build build-wasm

# Build custom App variant
emcmake cmake -S . -B build-wasm -DTARGET_PLATFORM=wasm \
    -DWINK_APP_DIR=<absolute-path-to-app>
```

**Artifacts**:
- `build-wasm/wink_simulator.wasm` — Uncompressed binary loaded by the Web Worker.
- `build-wasm/wink_simulator.js` — Modularized glue code (`WasmSandbox` UMD export) containing default `js_*` stubs.

---

## 2. Emscripten Asyncify Coroutine Suspension Mechanism

### 2.1 Blocking Delay Hazards
Embedded code contains frequent blocking calls (e.g., `pal_delay_ms(100)`). Spinning in a tight loop inside a single-threaded Worker prevents processing incoming `onmessage` events.

### 2.2 Asyncify Solution
Asyncify rewinds and unwinds the Wasm call stack when invoking asynchronous JavaScript APIs (such as `setTimeout` or `Promise`), yielding control back to the browser event loop.

#### 2.2.1 C Bridge Declarations (`pal_hal_wasm.c`)
```c
#include "pal_osal.h"

extern void js_pal_delay_ms(uint32_t ms);

void pal_delay_ms(uint32_t ms) {
    js_pal_delay_ms(ms);
}
```

#### 2.2.2 JS-Side Asynchronous Interception (Inside Worker)

```typescript
const module = await WasmSandbox({
  js_pal_gpio_write: (pin: number, level: boolean) => {
    self.postMessage({ type: 'pin_write', pin, level });
  },
  js_pal_i2c_transfer: (port, addr, wbuf, wlen, rbuf, rlen) => {
    return dispatchI2c(port, addr, wbuf, wlen, rbuf, rlen);
  },
});
```

**Asyncify Promise Contract**: Host overrides of `js_pal_os_sleep_ms` or `js_pal_os_busy_wait_us` **must return a Promise**. Returning synchronous values throws Asyncify into infinite unwind/rewind loops.

```typescript
// ✅ Correct
Module.js_pal_os_sleep_ms = (ms: number): Promise<void> => {
  return new Promise((resolve) => {
    scheduleWakeAt(clock.getUs() + BigInt(ms) * 1000n, resolve);
  });
};
```

---

## 3. Shared Memory & Zero-Copy Data Transfers

In high-throughput scenarios (such as I2C display refreshes), serialization overhead is eliminated by directly inspecting the **Wasm linear memory buffer (`wasmInstance.exports.memory.buffer`)**:

```typescript
function js_pal_i2c_transfer(
  port: number,
  dev_addr: number,
  write_buf_ptr: number,
  write_len: number,
  read_buf_ptr: number,
  read_len: number
): boolean {
  const wasmMemory = wasmInstance.exports.memory.buffer;
  
  if (write_len > 0 && write_buf_ptr !== 0) {
    const writeData = new Uint8Array(wasmMemory, write_buf_ptr, write_len);
    virtualI2CBus.write(dev_addr, writeData);
  }
  
  if (read_len > 0 && read_buf_ptr !== 0) {
    const responseData = virtualI2CBus.read(dev_addr, read_len);
    const readView = new Uint8Array(wasmMemory, read_buf_ptr, read_len);
    readView.set(responseData);
  }
  
  return true;
}
```

---

## 4. Hardware Interrupt Routing via Wasm Table Function Pointers (Poll Model)

Wasm safety constraints prohibit direct execution of arbitrary memory addresses from JavaScript; interrupt routing is mediated via Wasm Table indices.

### 4.1 Wasm Table Index Mapping

```text
  [ Wasm Table (Function Pointer Vector) ]
  ┌───────┬──────────────────────────┐
  │ Index │ C Interrupt Handler      │
  ├───────┼──────────────────────────┤
  │   0   │ NULL                     │
  │   1   │ my_button_press_handler  │ ◄── Registered callback index 1
  │   2   │ sensor_data_ready_isr    │
  └───────┴──────────────────────────┘
```

### 4.2 3-Step Poll Model

1. **C Registration**: `pal_gpio_enable_interrupt` casts function pointers to Table indices and passes them to `js_pal_register_interrupt`.
2. **JS Enqueueing**: Arriving GPIO events push `{ callbackIndex, argPtr }` onto a pending FIFO queue.
3. **Wasm Polling at Tick Boundaries**: `wink_runtime_run` drains all pending interrupts before calling `delay` and suspending via Asyncify.

```c
void pal_wasm_dispatch_pending_interrupts(void) {
    uint32_t callback_index, arg_ptr;
    while (js_pal_poll_interrupt(&callback_index, &arg_ptr)) {
        pal_gpio_isr_t isr = (pal_gpio_isr_t)(uintptr_t)callback_index;
        if (isr != NULL) { isr((void *)(uintptr_t)arg_ptr); }
    }
}
```

---

## 5. Cooperative Multitasking Scheduler & Single-Core Simulation

- **Fiber Contexts**: Allocates dedicated execution stacks using `<emscripten/fiber.h>` on Wasm and Win32 Fibers on Host.
- **Deterministic Round-Robin**: Resolves ready-state scheduling ties using seeded PRNGs for bit-exact CI reproducibility.
- **3-Phase GC**: Safely cleans up terminated fibers after switching back to the main scheduler thread.
