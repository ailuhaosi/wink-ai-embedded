# 4.5 Simulation Consistency & Fidelity Specification (UniSim 1.0 Archived)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/05-simulation-consistency-and-fidelity-spec.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Date | 2026-07-31 |
| Document Level | ① Design Specification (`04-wasm-simulation/`) |
| Status | **Archived** (Superseded by UniSim 3.0 `04-assurance/01-consistency-spec.md`) |
| Associated ADRs | 0003, 0009, 0013, 0014, 0019, 0025, 0040, 0042, 0045, 0047 |

> **Archival Note**: This document serves as the historical SSOT for UniSim 1.0 simulation consistency principles and C1~C25 scenario specifications. For current active specifications, refer to [UniSim 3.0 04-assurance/01-consistency-spec.md](../04-assurance/01-consistency-spec.md).

---

## 0. Role & Division of Responsibility

| Document | Core Question | Detailed Scope | Prohibited Duplicate |
|---|---|---|---|
| **This Spec (05)** | Underlying consistency principles; C1~C25 problem, solution, oracle | Virtual clock, Co-Sim, C1~C25 contracts | Status matrix (✅/🟡/❌/🚫 owned by 08) |
| **[08 Checklist](./08-simulation-consistency-checklist.md)** | "Can scenario X be verified right now?" | C1~C25 testability status matrix | Detailed technical narrative |

### 0.1 5-Field Sub-Scenario Template
- **Problem**: Hardware bug patterns.
- **Hardware vs Simulation**: Root cause of simulation escapes.
- **Assurance Solution**: A Rule / B Modeling / C Gate / Hardware.
- **Acceptance Oracle**: Measurable assertion criteria.
- **Boundary**: Intentionally unmodeled domains.

### 0.2 Standard Acceptance Oracle Vocabulary
- **Fail-Fast / Fail-Loud**: Compile-time or boot-time blocking.
- **Fault**: Runtime kernel fault isolation.
- **Bit-Identical / Golden Trace**: 100% bit-exact parity.
- **Tolerance Band**: Bounded physical tolerances.
- **Hardware / HIL Exclusive**: Excluded from simulation scope.

### 0.3 Solution Taxonomy & 3 Lines of Defense
- 1st Line: Static Gating (**A**)
- Simulation Engine Base (**B**)
- 2nd Line: Dynamic Traps (**C**)
- 3rd Line: Hardware Sign-off (**Hardware / HIL**)

### 0.4 Production Scope & Inevitable Divergences
- **Goal**: High-confidence behavioral pre-check for CI and low-code flows.
- **Non-Goal**: Complete replacement of hardware HIL or bit-exact cycle emulation.

---

## 1. Core Consistency Principles

1. **Virtual Microsecond Clock SSOT**: `s_virtual_us` is the single source of time. Delay functions must never actively step clocks.
2. **Control & Physical Domain Co-Simulation**: 3-domain model: 100% single-source C firmware $\leftrightarrow$ Domain-neutral platform OS $\leftrightarrow$ Autonomous physics plugins.
3. **Zero-Yield Synchronous Event Fast-Forwarding**: Pin Event Queues eliminate Asyncify suspension overhead during pulse measurement.

---

## 2. Scenario Consistency Specifications (C1~C25 Overview)

- **C1 — Business Causality & State Machines**: Dual-target compilation, DAL bypass narrowing, fault injection.
- **C2 — Virtual Microsecond Logic Timing**: Sleep fast-forwarding, zero-yield pulse-in, deterministic filtering.
- **C3 — Shared State Race Conditions**: Chaotic PRNG scheduler, shadow memory TSan.
- **C4 — Critical Sections & Interrupt Preemption**: Enter/exit state machine assertions, polling dispatch.
- **C5 — Blocking / Starvation / Watchdogs**: `-DWINK_STRICT_NONBLOCKING=1`, virtual soft WDT.
- **C6 — Stack / Heap / Memory Safety**: Fixed heap capping (ADR-0045), host ASan/UBSan.
- **C7 — Bus Protocols / CRC**: Single-source framing, bad CRC injection, JSON semantic gates.
- **C8 — DMA / Bus Asynchronous Windows**: Coarse-grained transfer yields, completion interrupts.
- **C9 — Multi-Core SMP Concurrency**: Single virtual core (ADR-0014); hardware exclusive.
- **C10 — Fast-Loop ISR (FOC / Hardware Timers)**: Deterministic soft-stepping (ADR-0047); HIL exclusive for hard real-time.
- **C11 — Electrical / Analog Characteristics**: Tabular degradation models; SPICE is non-goal.
- **C12 — CPU / ABI Instruction Level**: Fast-track Wasm daily builds; nightly dual-track binaries.
- **C13 — Lifecycle / Reset / Boot Sequences**: `pal_wasm_reset_physical()` initialization, reset reason injection.
- **C14 — Fast-Forward / Co-Sim Stepping**: Clock Single Gate, step-lock synchronization.
- **C15 — Host↔Wasm Boundary Integrity**: Asyncify contracts, reentrant push ban, BigInt ABI.
- **C16 — OS Synchronization Primitives**: Mutex/queue compatibility matrices.
- **C17 — Peripheral Conflicts / Clocks**: Pin-mux and timer resource conflict assertions.
- **C18 — Bus Fault State Machines**: I2C NACK/stretch, UART framing errors, SPI mode checking.
- **C19 — DMA / Buffer Lifecycles**: Buffer mutation detection during active transfers.
- **C20 — Callback Reentrancy / Bottom-Halves**: Blocking call detection inside callbacks.
- **C21 — Time & Counter Wrap-Around**: uint32 tick rollover assertions.
- **C22 — Power / Low-Power / Clock Gating**: Hardware / HIL exclusive.
- **C23 — Persistence / NVS / Wear**: Injected power cut write tearing tests.
- **C24 — Caches / Memory Attributes / DMA RAM**: Memory partition tags; hardware verified.
- **C25 — Floating-Point / Numerics & UB**: UBSan host testing, Tolerance Band golden traces.
