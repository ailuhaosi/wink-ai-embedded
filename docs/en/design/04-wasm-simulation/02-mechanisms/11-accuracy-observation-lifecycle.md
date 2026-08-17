# Accuracy Modes, Observability Plane & Lifecycle

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/11-accuracy-observation-lifecycle.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | Accuracy Mode types and defaults are **Partial**; Observability suite is **Partial**; Reset and cold/warm boot semantics are **Partial** |
| Supporting Axis | **F (secondary)** — Observability/evidence/reset; **B (secondary)** — `timing` mode and timebase |
| Associated Code | `@wink-ai/unisim` (Accuracy & Observability Suite: PrecisionLevel, PinTracer, VcdExporter, SessionRecorder, DebugController, BusAnalyzer, SimWorker), `wink-micro-os/targets/wasm/` (`pal_wasm_reset_physical`) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0003, 0019, 0042 |
| Migrated From | `04-wasm-simulation-2.0/15-accuracy-observation-lifecycle.md` |

> This document is the **authoritative SSOT** for: (1) Accuracy Modes; (2) Observability planes & evidence validity; (3) Lifecycle & reset semantics.

---

## 1. Accuracy Modes (Fidelity Claim Classification) — SSOT

### 1.1 Definitions (Orthogonal to Execution Modes)

| Name | Values | Question Addressed |
|---|---|---|
| **Accuracy Mode** | `behavioral` \| `timing` \| `cycle` | What level of fidelity this run is **permitted to claim** |
| **Execution Mode** | `INTERACTIVE` \| `HEADLESS` ([ADR-0042](../../../decisions/unisim/0042-sim-execution-modes.md)) | Whether idle yields via Asyncify; supports dynamic injection |

TypeScript SSOT: Defined in `@wink-ai/unisim` (`DEFAULT_PRECISION.level = 'timing'`).

### 1.2 Allowed vs Prohibited Evidence Scope

| Mode | Permitted as Evidence | **Prohibited** as Evidence | Status |
|---|---|---|---|
| **behavioral** | L1 state machine, L2 payload / StateChannel, duty cycle observation | Edge IRQ sequences, pulse captures, debounce timing, critical section windows | Landed |
| **timing** | L2 edge causality + bounded L3 pulse width & timeout approximations (C2) | Cycle-accurate electrical signals, preemptive nesting | Partial |
| **cycle** | Planned: Cycle-accurate bus waveforms | — | Planned |

**Product Release Gates**:
- "High consistency for pulse devices" **must** execute under `timing` mode over physical edge paths;
- `behavioral` test passes **cannot** be cited as timing/interrupt consistency evidence;
- Trace and VCD exports must embed the active Accuracy Mode in their metadata.

### 1.3 Configuration & Propagation Contracts

- Engine defaults to `timing` mode;
- Worker `INIT` configuration messages pass `accuracyMode`;
- CI Tier 1 pulse/timing regression tests mandate `timing` mode.

---

## 2. Observability Plane

### 2.1 Components & Responsibilities

| Component | Description (`@wink-ai/unisim`) | Purpose | Status |
|---|---|---|---|
| `PinTracer` | Pin State Tracer | Records pin transition histories | Partial |
| `VcdExporter` | Waveform Exporter | Generates standard VCD waveform files | Partial |
| `SessionRecorder` | Session Recorder | Records and replays sessions (captures PRNG seeds) | Partial |
| `DebugController` | Debug Controller | Breakpoint and step control | Partial |
| `BusAnalyzer` | Bus Packet Analyzer | Captures I2C/SPI/UART protocol packets | Partial |
| Fault Ring Buffer | C `pal_wasm_physical` + Getters | Causal audit log of physical faults | Landed |
| `displays[]` / channels | Worker $\rightarrow$ UI Channels | OLED frames and semantic channel telemetry | Landed ~ Partial |

### 2.2 Evidence Validity Rules

| Observable Asset | Under `behavioral` Mode | Under `timing` Mode |
|---|---|---|
| StateChannel / Duty / Framebuffers | Valid for L1/L2 logic sign-off | Valid for L1/L2 logic sign-off |
| Pin Timestamps / VCD Edge Deltas | **Invalid** as pulse/IRQ oracle | Valid within Tolerance Band as C2 evidence |
| Bus Payload Buffers | Valid (Transactional) | Valid (Transactional) |
| Fault Logs / WCET 8002 | Valid | Valid |

---

## 3. Lifecycle & Reset Semantics

### 3.1 Sandbox Instance Boundaries

| Level | Semantics |
|---|---|
| Worker Process | Hot-reusable; does **not** represent an MCU cold boot |
| Wasm Instance | `instantiate` $\rightarrow$ `callMain` $\rightarrow$ Scheduler; destroyed on `stop` |
| Physical / Fault State | `pal_wasm_reset_physical()` clears faults, PRNG, pin states, and latches |
| Device Models | `pal_wasm_sim_reset_all_devices()` clears device slots |
| Application State | Static BSS data; hot re-use without rebuilding Wasm retains global states (C13) |

### 3.2 Recommended Reset Sequence

```text
1. Stop scheduler / discard unresolved Promises (Prevents hanging Asyncify yields)
2. pal_wasm_reset_physical()          # Clears fault latches
3. pal_wasm_sim_reset_all_devices()
4. VirtualClock.reset()               # Synchronizes JS and C clocks
5. Optional: Send re-INIT message, re-register from device tree
6. True Cold-Boot: Destroy and re-instantiate Wasm sandbox
```

### 3.3 Multi-Board Topology Scenarios

- **MVP Scope**: 1 SimWorker = 1 Wasm Sandbox = 1 Logical MCU Board.
- Multi-board schematics in `sim-project.json` simulate topology, while running independent firmware instances per board is Planned.

---

## 4. Cross-Axis Verification Mapping

| Claim | Minimum Required Configuration |
|---|---|
| UI Canvas LED Logic Correct | Axis A + `behavioral` mode |
| Ultrasonic Pulse Width Consistent | Axes A + B + `timing` mode + edge injection |
| FOC Control Deterministic | Axes B + C soft-stepping + plant dynamics |
| "Clean State After Reset" | Full reset sequence or fresh Wasm sandbox (C13) |

---

## 5. Related Documents

- [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md) — Execution Modes
- [`02-virtual-clock.md`](./02-virtual-clock.md) / [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md) — Clocks & Timers
- [`05-memory-and-faults.md`](./05-memory-and-faults.md) — Faults & Reset
- [`08-channel-routing.md`](./08-channel-routing.md) — Channels & Accuracy Scope
- [`10-wasm-js-bridge-abi.md`](./10-wasm-js-bridge-abi.md) — ABI #6 / HEAPU8
- [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) — Axes A~F Definitions
- [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) — Scenario Testability Matrix
