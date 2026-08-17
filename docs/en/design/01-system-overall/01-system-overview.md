# 01. Universal Low-Code AI Embedded Platform: System Architecture Specification

<!-- i18n-meta
source: docs/zh/design/01-system-overall/01-system-overview.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

> **Core Vision**: Wink-AI is a low-code embedded development, behavioral high-fidelity simulation, and physical deployment platform tailored for AI-generated embedded applications. Users drag-and-drop visual components or let AI generate business logic, perform sandbox verification and fault-injection testing in WebAssembly within the browser with Golden Trace consistency tracking, and finally compile and flash firmware to real physical hardware via WebSerial / WebUSB.

---

## 1. Core Pain Points & Solutions

Traditional embedded software development faces severe bottlenecks:

1. **Heavy Hardware Dependencies**: Developers and AI codegen engines must understand registers, pin multiplexing, electrical timings, and vendor SDKs, leading to poor code reuse and difficult automated testing.
2. **Safety Risks in AI-Generated Code**: AI-generated C code may harbor deadlocks, null-pointer dereferences, buffer overflows, or hazardous state machines, making direct flashing to physical devices high risk.
3. **Low Performance in Microscopic Web Simulation**: Cycle-by-cycle waveform emulation for GPIO, I2C, and UART incurs high-frequency JS/Wasm IPC overhead, causing unacceptable browser latency.
4. **Lack of Virtual-to-Physical Consistency Evidence**: Pure visual simulation fails to prove that physical execution matches browser behavior without structured execution traces.
5. **Toolchain Fragmentation**: Users must install ESP-IDF, ARM GCC, USB drivers, and flashing utilities.

**Wink-AI Solutions**:

* **App / BAL / DAL / PAL 4-Layer Decoupling**: Separates application logic, reusable algorithms, device semantics, and platform hardware capabilities.
* **Device Model Registry as Single Source of Truth (SSOT)**: Unifies peripheral models, pin maps, DAL APIs, simulation models, and codegen templates.
* **Data Plane Channel-routed Bypass**: Routes signals via 5 orthogonal channels: Pin-level (Ch 1), PWM Modulation (Ch 1b), Protocol Bus (Ch 2), Analog Signal (Ch 3), and Buffer Payload (Ch 4); bypass sinks entirely to PAL, keeping DAL/App 100% single-source dual-target identical.
* **Safety Sandbox Pipeline**: Safe Codegen, static linting gates, Wasm Worker watchdog, isolated compilation containers, and firmware manifests.
* **Golden Trace Consistency Verification**: Records critical semantic events across simulation and physical MCU runs for regression analysis.

---

## 2. Overall Layered System Architecture

```mermaid
graph TD
    Input[AI / Low-Code Input] --> SafeCodegen[wink CLI Codegen / Static Lint]
    SafeCodegen --> App[Application Logic Layer App]

    Registry[Device Model Registry] --> SafeCodegen
    Registry --> DeviceTree[device_tree Generator]
    Registry --> WebSchema[SchemaForm / Canvas Validation]
    Registry --> SimModel[Simulation / Fault Models]

    App -->|Calls Business Abstraction| BAL[Business Abstraction Layer BAL]
    BAL -->|Device Semantic API| DAL[Device Abstraction Layer DAL]
    DeviceTree --> DAL

    subgraph WinkMicroOS[WinkMicroOS Runtime (Single-Source Dual-Target C Code)]
        BAL
        DAL -->|Bus & System APIs| PAL[Platform Abstraction Layer PAL]
        Trace[Golden Trace Runtime]
    end

    PAL -.->|PAL Wasm Target / Channel Bypass| WasmBridge[Wasm-JS Bridge]
    PAL -.->|Physical Static Binding| Target[Target PAL: ESP32 / STM32]

    subgraph Monorepo[Wink-AI Monorepo Frontend & Sim]
        WasmBridge --> Worker[@wink-ai/unisim Worker]
        Worker --> Watchdog[Watchdog / Resource Limit]
        Worker --> UniSim[UniSim Virtual Peripherals]
        UniSim --> UI[@wink-ai/embedded-frontend Canvas]
    end

    subgraph CloudBuild[wink CLI / Cloud Build]
        BuildContainer[Isolated Build Environment] --> Firmware[Firmware + Manifest + sha256]
    end

    Target --> Hardware[Physical MCU]
    Firmware --> Flash[WebSerial / WebUSB Flash]
    Flash --> Hardware
    Trace --> Compare[Trace Replay / Compare]
```

---

## 3. Cross-Repository 5 Core Pillars Matrix

Per the platform black-box contract isolation rules, external modules (`embedded-frontend` and `unisim`) expose only public contract interfaces and DTOs:

| Module Name | Repository Path | Black-Box Role | Usage & Invocations | Interface Contract Form | Isolation Boundary |
|---|---|---|---|---|---|
| **`embedded-frontend`** | Monorepo<br>`wink-ai/packages/embedded-frontend/` | Embedded Web Workbench UI: 2D circuit canvas, 3D mechanical rendering, Pinia store | Developer browser interaction, or embedded via iframe | `wink-app.json` Manifest, `SimTraceSpecV2`, WebSocket/Wasm DTO | Black-Box Contract: UI interaction & manifest schemas |
| **`unisim`** | Monorepo<br>`wink-ai/packages/unisim/` | Unified WebAssembly behavioral high-fidelity simulation engine: microsecond `VirtualClock`, 4-state logic (0/1/Z/X) | Instantiated in Web Worker by frontend, or run headless via `wink test` CLI | `SimWorker` protocol, Wasm-JS Bridge C-ABI (`wasm_bridge.h`) | Black-Box Contract: Wasm engine lifecycle & ABI specs |
| **`wink-tools`** | This Repo<br>`wink-ai-embedded/wink-tools/` | Unified CLI toolchain: code generation (`wink gen`), static linting (`wink lint`), testing (`wink test`), cloud/local building (`wink build`) | Developer terminal execution, CI/CD pipelines, build worker automation | `wink <verb>` verbs, JSON Telemetry envelopes | Open-source CLI in Python with model YAMLs |
| **`wink-micro-os`** | This Repo<br>`wink-ai-embedded/wink-micro-os/` | C embedded SDK kernel: PAL/DAL/BAL abstractions, cooperative runtime scheduler, `wink_status_t` error codes | Linked by `wink-micro-app`, built for ESP32/STM32 or Wasm | C public headers (`pal.h`/`dal_*.h`), CMake targets | Open-source C SDK kernel |
| **`wink-micro-app`** | This Repo<br>`wink-ai-embedded/wink-micro-app/` | Embedded project standard: Manifest (`wink-app.json`), App C code (`app_main.c`), generated `device_tree.c` | Top-level input for simulation and compilation | `wink-app.json` Schema v1/v2, `app_init`/`app_loop` lifecycle | Open-source project templates & samples |

---

## 4. Layer Responsibilities

| Layer | Core Responsibilities | Key Artifacts | Target Audience |
|---|---|---|---|
| AI/Low-Code | Generate intent, state machines, topology | DSL, Blockly, App draft | End users, AI agents |
| App | Describe state machines without hardware bus logic | `app_init/app_loop/app_on_fault` | App developers |
| BAL | Encapsulate physical enhancement, math algorithms, and closed-loop control | `wink_bal_opts.h`, `wink_xxx_*` | Algorithm engineers |
| DAL | Provide semantic device APIs, hiding registers and timing | `dal_xxx_read/set` | Driver maintainers |
| PAL | Abstract GPIO / PWM / I2C / SPI / ADC / OSAL | `pal_hal.h`, `pal_osal.h` | Platform adapters |
| Runtime | Cooperative main loop & App lifecycle callbacks | `wink_runtime_run`, `wink_app_callbacks_t` | Platform & app developers |
| Trace | Golden Trace fault and event recording | `wink_trace_fault` | Test engineers |
| Device Model Registry | Unified metadata for peripherals, boards, simulation | JSON Schema, model catalog | Architects |
| UniSim | Virtual peripherals, canvas, protocol parsing, fault injection | TS runtime, SchemaForm | Frontend engineers |
| Cloud Build | Isolated build container, caching, manifest signing | `.bin/.hex`, build log | DevOps engineers |

---

## 5. Dual-Mode Execution Mechanisms

### 5.1 Web Simulation Mode
1. Platform performs static analysis on generated App code.
2. Device Model Registry generates `device_tree.c/h`, simulation descriptors, and fault models.
3. App, BAL, DAL, and PAL Wasm target compile to `wasm32`.
4. Web Worker executes Wasm binary while main thread renders UI.
5. Asyncify handles non-blocking delays (`pal_delay_ms`); watchdog guards against infinite loops.
6. UniSim communicates via 5 data-plane channels and PAL physical source bypass.
7. Execution logs are captured into Golden Trace for assertions and replay.

### 5.2 Physical Deployment Mode
1. After simulation passes, user selects target MCU board (e.g., ESP32 DevKit V1).
2. Cloud build service invokes containerized toolchain.
3. GCC compiles and links App, BAL, DAL, Target PAL, and device tree into final binary.
4. Returns `.bin`, sha256 checksum, manifest, and build logs.
5. Browser invokes WebSerial/WebUSB with user authorization to flash device.
6. Physical MCU runs WinkMicroOS and streams execution trace via UART for golden comparison.

---

## 6. Simulation Fidelity Boundaries

Wink-AI targets **behavioral high-fidelity simulation**, rather than full analog/electrical SPICE emulation.

| Fidelity Level | MVP Target | Description |
|---|---|---|
| Behavioral Simulation | Yes | Validates state machines, sensor values, actuator commands |
| Protocol-Level Simulation | Yes | Validates I2C / UART / SPI payload interactions |
| Logic Level Simulation | Partial | Supports LED, Button, simple GPIO levels |
| Electrical / SPICE Emulation | No | Does not simulate impedance, noise, or power integrity |
| Instruction-Level Emulation | No | Does not run cycle-accurate QEMU / AVR core emulators |

---

## 7. AI-MCU Distributed Heterogeneous Architecture (Brain & Cerebellum)

To power complex intelligent hardware, the platform decouples high-level decision-making from low-level real-time control:

* **AI Decision Layer (Brain - Cerebrum)**: Runs on high-compute hosts (Linux / Cortex-A / NPU / Cloud), handling vision (YOLO), voice recognition, and LLM planning.
* **Real-Time Control Layer (Cerebellum - WinkMicroOS)**: Runs on deterministic MCUs (Cortex-M / ESP32), executing hard real-time PID loops, sensor sampling, safety state machines, and hardware watchdog timers.
