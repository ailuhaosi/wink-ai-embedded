# 4.8 Simulation Consistency Checklist (UniSim 1.0 Archived)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/08-simulation-consistency-checklist.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Date | 2026-07-31 |
| Document Level | ① Design Specification (`04-wasm-simulation/`) |
| Status | **Archived** (Superseded by UniSim 3.0 `04-assurance/02-consistency-checklist.md`) |
| Associated Documents | [05-simulation-consistency-and-fidelity-spec.md](./05-simulation-consistency-and-fidelity-spec.md), [ADR-0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md) |

> **Archival Note**: This document serves as the historical testability matrix index for UniSim 1.0. For the active SSOT checklist, refer to [UniSim 3.0 04-assurance/02-consistency-checklist.md](../04-assurance/02-consistency-checklist.md).

---

## 0. Conventions & SSOT Division

### 0.1 Support Symbols
- ✅ **Supported**: Core scenario verified.
- 🟡 **Partially Supported**: Partial coverage or approximation.
- ❌ **Unsupported**: Currently unverified.
- 🚫 **Intentionally Unmodeled**: Outside product boundaries.
- — **N/A**: Path unexposed.

### 0.2 Solution Types
- **A**: Constrained Code (lint / compiler / schema gates)
- **B**: Engine Modeling (Virtual clock, single-source drivers, chaos)
- **C**: Observability Gates (Sanitizers, soft WDT, shadow memory)
- **Hardware**: Hardware / HIL validation

---

## 1. High-Level Matrix (C1~C25)

| ID | Category | Status | Primary Solution | Phase / Scope | Priority |
|---|---|---|---|---|---|
| C1 | Business Causality & State Machines | ✅ | B (+A) | Baseline | High |
| C2 | Virtual Microsecond Logic Timing | ✅ | B | Phase 1 | High |
| C3 | Shared State Race Conditions | ❌ | B+C | Phase 4 | **Highest** |
| C4 | Critical Sections & Interrupts | 🟡 | B+C | Phase 4 | **Highest** |
| C5 | Blocking / Starvation / WDT | 🟡 | A+B+C | Phase 4 Prerequisite | High |
| C6 | Stack / Heap / Memory Safety | ✅ | A+C | Phase 2 | High |
| C7 | Bus Protocols / CRC | 🟡 | B+A | Phase 3 | Medium-High |
| C8 | DMA / Asynchronous Windows | ❌ | B | Phase 3 | Medium |
| C9 | Multi-Core SMP | ❌ | B Approx / Hardware | ADR-0014 | High |
| C10 | Fast-Loop ISR / FOC | 🟡 | B Approx / HIL | ADR-0047 | Medium-High |
| C11 | Electrical / Analog | 🚫 | B Tabular | ADR-0003 | Context-dependent |
| C12 | CPU / ABI Instruction Level | ❌ | C Dual-Track | Phase 5 | Low |
| C13 | Lifecycle / Reset | 🟡 | B+C | Phase 1 Polish | **Highest** |
| C14 | Fast-Forward / Co-Sim Stepping | 🟡 | B+C | Phase 1+ | **Highest** |
| C15 | Host↔Wasm Boundary | 🟡 | A+C | Baseline | **Highest** |
| C16 | OS Synchronization Primitives | 🟡 | B+A | Phase 4 Prerequisite | **Highest** |
| C17 | Peripheral Resource Conflicts | 🟡 | A+C | Continuous | High |
| C18 | Bus Fault State Machines | ❌ | B | Phase 3 Expansion | Medium-High |
| C19 | DMA / Buffer Lifecycles | ❌ | B+C | Phase 3 Expansion | Medium |
| C20 | Callback Reentrancy / Bottom-Halves | 🟡 | A+C | Phase 4 | High |
| C21 | Time & Counter Wrap-Around | 🟡 | A+C | Continuous | High |
| C22 | Power / Low-Power / Clocks | 🚫 | Hardware | Non-Goal | Medium |
| C23 | Persistence / NVS | 🟡 | B | As-needed | Medium |
| C24 | Cache / DMA RAM | 🚫 | Hardware / C12 | Non-Goal | Medium |
| C25 | Floating-Point / Numerics | 🟡 | C | Phase 2 | Medium |

---

## 2. Granular Scenario Quick Reference

- **C1.1 Single-Source State Transitions**: ✅ [05 §C1.1](./05-simulation-consistency-and-fidelity-spec.md#c11-同源-appbal-状态迁移)
- **C1.2 Bypass Narrowing**: 🟡 [05 §C1.2](./05-simulation-consistency-and-fidelity-spec.md#c12-dal-bypass--ifdef-simulation-收窄)
- **C1.3 Fault / Timeout Paths**: ✅ [05 §C1.3](./05-simulation-consistency-and-fidelity-spec.md#c13-故障--超时--断线异常路径)
- **C2.1 Sleep Fast-Forwarding**: ✅ [05 §C2.1](./05-simulation-consistency-and-fidelity-spec.md#c21-sleep--定时唤醒快进)
- **C2.2 Pulse-In Zero-Yield**: ✅ [05 §C2.2](./05-simulation-consistency-and-fidelity-spec.md#c22-脉宽测量零-yield-环回)
- **C3.1 Task↔Task Lock-Free Sharing**: ❌ [05 §C3.1](./05-simulation-consistency-and-fidelity-spec.md#c31-无锁共享读写tasktask)
- **C4.1 Critical Section Guardrails**: 🟡 [05 §C4.1](./05-simulation-consistency-and-fidelity-spec.md#c41-临界区门禁enterexit)
- **C5.1 STRICT_NONBLOCKING**: ✅ [05 §C5.1](./05-simulation-consistency-and-fidelity-spec.md#c51-strict_nonblocking-编译期隐藏阻塞-api)
- **C6.1 Static Heap Quota**: ✅ [05 §C6.1](./05-simulation-consistency-and-fidelity-spec.md#c61-静态堆配额耗尽)
- **C7.3 JSON Semantic Gate**: ✅ [05 §C7.3](./05-simulation-consistency-and-fidelity-spec.md#c73-json-语义仿真门禁)
- **C13.1 Cold Boot Reset**: 🟡 [05 §C13.1](./05-simulation-consistency-and-fidelity-spec.md#c131-冷启动bss--静态初值--外设默认电平)
- **C14.1 Single Gate Rule**: 🟡 [05 §C14.1](./05-simulation-consistency-and-fidelity-spec.md#c141-时钟单一写入--禁止双重步进)
- **C15.2 Polling Model IRQs**: ✅ [05 §C15.2](./05-simulation-consistency-and-fidelity-spec.md#c152-中断-pushpoll--重入)

---

## 3. Explicitly Excluded Scopes

1. SPICE / Power Integrity simulation (C11)
2. Cycle-accurate Xtensa/RISC-V CPU microarchitectures (C12)
3. ESP32 dual-core cache coherency (C9/C24)
4. Dynamic hardware clock tree gating (C17.3/C22)
5. Deep sleep current decay and transient waveforms (C22)
6. Physical flash endurance wear leveling (C23)
7. Substituting simulation for certified EMC / Functional Safety compliance
