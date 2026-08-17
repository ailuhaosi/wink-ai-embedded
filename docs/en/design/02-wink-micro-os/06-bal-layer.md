# 06. Business Abstraction Layer (BAL) Design Specification

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/06-bal-layer.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

> **This is the authoritative Living Specification (SSOT) for the BAL layer directory structure, naming rules, dependencies, and CI quality gates.**

---

## 1. System Placement & Layering

```text
App  →  BAL  →  { DAL, runtime }
              ↘ math (Zero DAL/runtime dependency)
```

- BAL Public Headers **FORBID** `#include` of any `pal_*.h` (sole exemption: `pal_log.h` for macros).
- BAL `.c` source files may include PAL for critical sections or timestamps, but PAL types must never leak to public APIs.
- Compile-time Static Dispatch: POD structures + named functional APIs.

---

## 2. 3-Domain Directory Architecture

```text
wink-micro-os/bal/
├── include/
│   ├── wink_bal_opts.h              # Shared scheduling options
│   ├── input/                       # Physical Enhancement: Inputs
│   ├── output/                      # Physical Enhancement: Outputs
│   ├── sensor/                      # Physical Enhancement: Sensors
│   ├── actuator/                    # Physical Enhancement: Actuators (Single device)
│   ├── display/                     # Physical Enhancement: Displays
│   ├── comm/                        # Physical Enhancement: Comm & Telemetry
│   ├── math/                        # Pure math algorithms (PID, Kalman)
│   └── control/                     # Domain control (Closed loops & orchestration)
└── src/                             # Mirrored source directory
```

### 2.1 Domain Responsibilities & Dependency Rules

| Domain | Responsibility | Allowed Dependencies | Forbidden |
|---|---|---|---|
| **Physical Enhancement** | Extends single DAL device behavior (periodic polling, sweeps) | Primary DAL, runtime, `wink_bal_opts` | Cross-device closed-loops |
| **math** | Pure computational algorithms (PID, filters, kinematics) | `wink_status.h`, Standard C | Any `dal_*`, `runtime`, `pal_*` |
| **control** | Closed-loop control targets & multi-actuator orchestration | `math`, multiple DALs, runtime, `wink_bal_opts` | Leaking `pal_*` to public headers |
