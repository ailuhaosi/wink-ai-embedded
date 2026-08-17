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
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Worker / Asyncify / INTERACTIVE·HEADLESS / Link flags) |
| Supporting Axis | **Cross-cutting** (Host & Execution Modes) |

---

## 1. Web Worker Thread Isolation

Embedded C `while(1)` loops run in a dedicated Web Worker, while the main thread renders asynchronously via `postMessage`.

```text
(1) UI postMessage {type:'start', wasmBytes}
(2) Worker WebAssembly.instantiate()
(3) Module.callMain() → Scheduler Init → App Loop
(4) Worker postMessage {type:'pin_write'} → UI Update
(5) User presses button → UI postMessage {type:'pin_input'}
(6) Worker updates PinArbiter / InterruptQueue
```

---

## 2. Execution Modes

| Mode | Characteristics | Typical Usage |
|---|---|---|
| `INTERACTIVE` | Render throttling, Asyncify coroutine suspension | Interactive 2D/3D Canvas |
| `HEADLESS` | Zero-yield fast-forwarding, direct virtual time jumping | CI Automated Suites, Batch Tests |
