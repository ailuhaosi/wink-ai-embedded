# ⚡ 5-Minute Getting Started Guide

<!-- i18n-meta
source: docs/zh/design/00-quick-start/01-5min-getting-started.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This guide helps new developers and AI agents quickly set up the local environment, launch the `wink-micro-os` WebAssembly simulation, and run their first closed-loop demo.

---

## 1. Prerequisites

Before starting, ensure the following toolchains are installed on your host machine:

* **Node.js**: `>= 18.0.0`
* **Python**: `>= 3.9` (used for running documentation and governance test suites)
* **CMake & GCC / Clang**: (Optional, for compiling native MCU C kernel unit tests)
* **Emscripten (emsdk)**: (Optional, for compiling `wink-micro-os` to `wasm32`)

---

## 2. 5-Minute Quick Run: First Wasm Simulation Demo

### Step 1: Install Dependencies & Check Plans
```bash
# Enter workspace
cd wink-ai-embedded

# Inspect implementation plans and active development items
python docs/implementation-plans/scripts/list_plans.py
```

### Step 2: Load Sample Manifest (`wink-app.json`)
The platform uses a Single Source of Truth (SSOT) configuration manifest to drive virtual peripheral topology. You can find standard manifests under `examples/`:

```json
{
  "schemaVersion": 2,
  "name": "hello_blink",
  "target_board": "esp32_devkitc",
  "tick_ms": 10,
  "devices": [
    {
      "id": "led_1",
      "model": "gpio_led",
      "pin_map": { "pin": 2 }
    }
  ]
}
```

### Step 3: Launch Wasm Simulation & Online Tracing
* Load the exported Wasm module (`wink_micro_os.wasm`) inside the Workbench frontend.
* Observe the `SimTraceSpecV2` event stream in the console:
  ```text
  [TRACE] 00:00:00.010000 | GPIO_SET | pin: 2 | value: 1
  [TRACE] 00:00:00.510000 | GPIO_SET | pin: 2 | value: 0
  ```

---

## 3. Development Navigation Links

* **Modifying C Kernel DAL/PAL** ➔ Refer to [02-wink-micro-os Specification](../02-wink-micro-os/README.md)
* **Wasm Bridge ABI & Simulation Contract** ➔ Refer to [04-wasm-simulation Specification](../04-wasm-simulation/00-README.md)
* **AI Agent Instructions** ➔ Refer to [docs/AGENTS.md](../../AGENTS.md)
