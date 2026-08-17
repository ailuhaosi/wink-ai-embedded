# Production Scope & Fidelity Boundaries

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/01-overview/03-production-contract.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / overview) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Governing ADR | [ADR-0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md) |

---

## 1. Production Statement (Completeness ≠ Parity)

Implementing axes A~F **does not equal** "Simulation ≡ Physical MCU" or "Skip hardware validation before release".

| Claim | With A~F Fully Landed |
|---|---|
| Simulation serves as high-confidence behavioral pre-flight in CI | **Approachable** |
| Simulation substitutes for hardware HIL release approval | **No** |
| Simulation guarantees bit/microsecond-level identity with MCU | **Never promised** |

---

## 2. Behavioral Boundaries

### 2.1 Verifiable
- Business state machines
- Sensor/actuator semantics via single-source PAL paths
- I2C / UART payload transactions
- Timeouts, disconnects, and error recovery
- Logical timing sequences under virtual clock

### 2.2 Non-Verifiable (or Weak Approximations)
- Hard real-time sub-microsecond latency
- Hardware interrupt preemption and nested ISR priorities
- Chip-level hardware timers and FOC hard ISRs
- True SMP multi-core race conditions
- Analog SPICE electrical behaviors
