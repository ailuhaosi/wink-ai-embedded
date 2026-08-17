# WinkMicroOS Runtime Architecture Specification (DAL & PAL)

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This directory contains the detailed architecture and interface specifications for the **WinkMicroOS** runtime kernel. WinkMicroOS is the foundational bedrock of the platform, decoupling business logic from target microcontroller electrical buses to enable single-source dual-target compilation across host/Wasm and physical hardware targets.

---

## 📂 Module Design Specifications

*   **[01-dal-device-abstraction.md](./01-dal-device-abstraction.md) - Device Abstraction Layer (DAL) & Static DeviceTree Generation**
    *   Semantic wrappers for sensors and actuators, compile-time dispatch between physical drivers and Wasm bypass, and static C devicetree generation.
*   **[02-pal-platform-abstraction.md](./02-pal-platform-abstraction.md) - Platform Abstraction Layer (PAL) API Specification**
    *   Cross-platform hardware bus interfaces (GPIO, PWM, I2C, SPI, ADC) and OSAL wrappers (tasks, mutexes, timers, delays).
*   **[03-directory-architecture.md](./03-directory-architecture.md) - Kernel Directory & Dependency Architecture**
    *   Ports & Adapters kernel structure (`pal` INTERFACE, `dal`, `runtime`, `trace` peers, `targets`), CMake target graph, and anti-leak rules.
*   **[04-runtime-and-trace.md](./04-runtime-and-trace.md) - Runtime Lifecycle & Golden Trace Contract**
    *   Callback-injected main event loop (`wink_app_callbacks_t`), tick scheduling, fault tracing, and target entry wiring.
*   **[05-hardware-and-fidelity-testing-guide.md](./05-hardware-and-fidelity-testing-guide.md) - Hardware Smoke & Fidelity Testing Guide**
*   **[06-bal-layer.md](./06-bal-layer.md) - Business Abstraction Layer (BAL) Specification ★ SSOT**
    *   3 Orthogonal Domains: Physical Enhancement, `math/` (pure algorithms), and `control/` (closed-loop orchestration).

---

## 📐 Layering & Dataflow Diagram

```text
       [ App (AI Generated) / BAL (Kernel Static Lib) ]
                    │ (Invokes Device Semantics / Registers Callbacks)
                    ▼
     ┌───────────────────────────────┐
     │  runtime (Main Loop) + trace  │ ◄── First-class Peer Layers
     └───────────────┬───────────────┘
                    │ (Invokes DAL)
                    ▼
     ┌───────────────────────────────┐
     │ Device Abstraction Layer (DAL)│ ◄── SIMULATION Channel Bypass ──► [ Web Virtual UI ]
     └───────────────┬───────────────┘
                    │ (Invokes Bus & OSAL APIs)
                    ▼
     ┌───────────────────────────────┐
     │Platform Abstraction Layer(PAL)│   ← INTERFACE Contract
     └───────┬───────────────┬───────┘
             ▼               ▼ (CMake Static Binding Routing)
       [ targets/ (HAL) ]      [ osal/ (OS) ]     (targets/<plat> × osal/<variant>)
```

WinkMicroOS Design Philosophy: **Confine low-level hardware complexity to platform-specific drivers (validated via strict test suites and compile-time branching), while exposing clean physical world semantics to the application layer.**
