# 03. Application Layer (App) Runtime & Safe Codegen Specification

<!-- i18n-meta
source: docs/zh/design/03-app-codegen/01-app-business-logic.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

In low-code and AI-assisted development scenarios, system design focuses on **shielding developers and AI agents from register-level intricacies, allowing full concentration on control algorithms and business state machines**.

This document specifies the **Application Layer (App)** runtime standards, automated C code generation contracts, and hardware-decoupled execution models.

---

## 1. Core Responsibilities & Architectural Constraints

### 1.1 Core Responsibilities
* **Business Workflow Scheduling**: Orchestrates device workflows, BAL algorithm invocations, event handlers, and multi-device interaction rules.
* **State Machine Lifecycle Management**: Coordinates initialization, main loop execution, exception suspension, and fail-safe recovery.
* **HMI / Cloud Telemetry**: Ingests parameters from web panels and streams telemetry packets upward.

### 1.2 Architectural Constraints
1. **No Hardware Headers**: App code MUST NOT `#include "pal_hal.h"` or invoke low-level bus APIs like `pal_gpio_write` / `pal_i2c_transfer`.
2. **No Hardcoded Pinouts**: Pin and bus assignments are strictly delegated to the static devicetree (`device_tree.c`). App code only receives named instance pointers (e.g., `&front_radar`).
3. **Semantic Interfaces Only**: All hardware interaction occurs via semantic DAL functions (e.g., `dal_ultrasonic_read`) or BAL services (e.g., `bal_pid_compute`).
4. **Single-Source Dual-Target Portability**: The same C code compiles identically to `wasm32` sandboxes and physical MCU binaries.

---

## 2. Low-Code / AI Codegen Structure

```text
generated_app/
├── app_config.h              # Business parameters and macros
├── device_tree.h             # Generated device handle declarations
├── device_tree.c             # Static devicetree pin/bus allocations
└── app_main.c                # Core application state machine (App)
```

### 2.1 App Lifecycle Contract

```c
/**
 * @brief System initialization entry point (invoked once after OS bootstrap)
 */
void app_init(void);

/**
 * @brief Periodic main loop callback (invoked periodically by cooperative scheduler)
 */
void app_loop(void);

/**
 * @brief Fault handler callback (invoked upon hardware/communication error detection)
 */
void app_on_fault(uint32_t fault_code);
```
