# Accuracy Mode, Observability Plane & Lifecycle

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
| **Landed** | Accuracy Mode types and defaults are **Partial** (in TS; CI evidence chain pending reinforcement); Observability component code is **Partial**; Cold/warm boot and reset semantics are **Partial** (mechanisms exist, dedicated contract here) |
| Supporting Axis | **F (secondary)** — Observability/evidence/reset cross-cutting; **B (secondary)** — `timing` Mode and timebase cross-claims |
| Associated Code | `@wink-ai/unisim` (Accuracy & Observability Suite: PrecisionLevel, PinTracer, VcdExporter, SessionRecorder, DebugController, BusAnalyzer, SimWorker), `wink-micro-os/targets/wasm/` (`pal_wasm_reset_physical`) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0003, 0019, 0042 |
| Migrated From | `04-wasm-simulation-2.0/15-accuracy-observation-lifecycle.md` |

> This document is the **comprehensive SSOT** for the following three areas: (1) Accuracy Mode; (2) Observability plane and evidence validity; (3) Lifecycle and reset. It closes evidence and reset cross-cutting concerns for Axes A~F at the **documentation layer**. Axis definitions reside only in [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md). Channel selection gate summaries reside in [`08-channel-routing.md`](./08-channel-routing.md) (**must not** expand into a second copy of Accuracy text).

---

## 1. Accuracy Mode (Fidelity Claim Classification) — SSOT

### 1.1 Definitions (Orthogonal to Execution Modes)

| Name | Values | Question Addressed |
|---|---|---|
| **Accuracy Mode** | `behavioral` \| `timing` \| `cycle` | What level of fidelity this run is **permitted to claim** |
| **Execution Mode** | `INTERACTIVE` \| `HEADLESS` ([ADR-0042](../../../decisions/unisim/0042-sim-execution-modes.md)) | Whether idle yields via Asyncify; whether dynamic injection is supported |

The two combine independently. Example: `HEADLESS` + `timing` is used for CI pulse width regression; `INTERACTIVE` + `behavioral` is used for canvas demonstrations.

- The **full text** of Accuracy Mode resides in this document only; product selection summaries $\rightarrow$ [`08-channel-routing.md`](./08-channel-routing.md) §1.3.
- Execution Mode behavior and startup contracts $\rightarrow$ [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md).
- **Forbidden**: Redefining Axes A~F in this document; **Forbidden**: Duplicating long production criteria text ($\rightarrow$ [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md)).

TypeScript SSOT: Type definitions in `@wink-ai/unisim` (`AccuracyMode` / `PrecisionLevel`; `DEFAULT_PRECISION.level = 'timing'`).

### 1.2 Allowed vs Prohibited Evidence Scope

| Mode | Permitted as Evidence | **Prohibited** as Evidence | Landing |
|---|---|---|---|
| **behavioral** | L1 state machine, L2 payload / StateChannel, duty cycle observation | Edge IRQ sequences, pulse captures, debounce timing, critical section insertion windows | Landed (Plugins may skip edge-level updates) |
| **timing** | L2 edge causality + virtual clock pulse width / timeout approximations (C2) | Cycle/electrical level conclusions, preemptive nesting | Partial (Main path exists; gates not fully in CI) |
| **cycle** | Planned: I2C SCL/SDA edge emission, etc. | — | Planned (Phase 4; SPI/UART cycle later) |

**Product Release Gates (Consistent with [`08-channel-routing.md`](./08-channel-routing.md) §1.3 summary)**:

- Claiming "high consistency for pulse devices (ultrasonics, etc.)" $\rightarrow$ **must** execute under `timing` (or higher) and follow physical edge paths.
- Green lights under `behavioral` **must not** be written into release notes as timing/interrupt consistency evidence.
- Trace / VCD export artifacts must annotate the active Accuracy Mode at that time; missing annotations can only serve as debug references, not as oracles.

### 1.3 Configuration & Propagation Contracts

| Step | Convention |
|---|---|
| Default | Engine defaults to `timing` (consistent with `DEFAULT_PRECISION`); demo UI may explicitly degrade to `behavioral` |
| Entering Worker | `INIT` / configuration messages carry `accuracyMode` (field name per implementation); SimWorker writes into PluginContext / Bus `setAccuracyMode` |
| Modifying at Runtime | Permitted; must clear or sectionally annotate observation buffers to prevent mixed-mode Traces |
| CI | Tier 1 pulse width/debounce test cases fix `timing`; logic-only test cases allow `behavioral`; **Additionally**: yield-heavy subset must use INTERACTIVE (see [`01` §3.5](./01-sandbox-and-execution.md), landing **Planned**) |

Landing Gaps (Honest notation): Whether frontend/CI **enforces** verification that "test case tags $\subset$ running Mode" remains Partial—governed by review and manual cross-checking against [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) until fully automated.

**Cross-Cutting with ISR Latency**: When default scheduler tick $\approx 10\text{ms}$, high-baud async UART RX **must not** claim interrupt consistency under `timing` (see [`04` §8](./04-interrupt-model.md)).

---

## 2. Observability Plane

### 2.1 Components and Responsibilities

| Component | Logical Function Description (`@wink-ai/unisim`) | Purpose | Landing |
|---|---|---|---|
| PinTracer | Pin State Tracer | Records pin transition histories | Partial |
| VcdExporter | Waveform Exporter | Generates standard VCD waveform files | Partial |
| SessionRecorder | Session Recorder | Session recording / replay (including PRNG state) | Partial |
| DebugController | Debug Controller | Breakpoint / step control plane | Partial |
| BusAnalyzer | Bus Packet Analyzer | Captures I2C/SPI/UART protocol transactions | Partial |
| Fault Audit Ring | C `pal_wasm_physical` + field getters | Causal chain of degradation events | Landed |
| `displays[]` / pluginChannels | Worker $\rightarrow$ UI | OLED frames, semantic channel observation | Landed ~ Partial |

### 2.2 Evidence Validity Rules

| Observable Asset | Under `behavioral` Mode | Under `timing` Mode |
|---|---|---|
| StateChannel / duty / framebuffer | Usable for L1/L2 logic sign-off | Same as left |
| Pin edge timestamps / VCD edge deltas | **Invalid** as pulse/IRQ oracle | Usable within Tolerance Band as C2 evidence |
| Bus payload content | Usable (Transactional level) | Usable; bit timing remains non-goal |
| Fault log / 8002 WCET | Usable (Fault and wall-clock fallback) | Same as left; note HEADLESS bypasses WCET |

**Redline**: The observability plane does not substitute for scenario statuses in [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md); scenarios marked 🚫 in the checklist must not be promoted to release-consistent even if they "look correct" in VCD waveforms.

### 2.3 Trace Contracts

- DAL/PAL do not emit business Traces directly; `pal.transfer` style summaries are recorded by the Worker upon `js_pal_*` returns (see [`08-channel-routing.md`](./08-channel-routing.md)).
- Prohibited from reading stale `HEAPU8` memory as observation snapshots during Asyncify sleeping states ([`10-wasm-js-bridge-abi.md`](./10-wasm-js-bridge-abi.md) ABI #6).

---

## 3. Lifecycle and Reset

### 3.1 Instance Boundaries

| Level | Meaning |
|---|---|
| Worker Process | Hot-reusable; does **not** equal an MCU cold boot |
| Wasm Instance | `instantiate` $\rightarrow$ `callMain` $\rightarrow$ scheduling loop; destroyed on `stop` |
| Physical / Fault State | `pal_wasm_reset_physical()` clears faults/PRNG/per-pin ctx/fault domains/latches |
| Device Models | `pal_wasm_sim_reset_all_devices()` resets virtual device slots |
| Application Logic | App static/BSS data; hot reuse of Worker without rebuilding Wasm may retain global states (C13) |

### 3.2 Recommended Reset Sequence (Simulation Side)

```text
1. Stop scheduler / discard unresolved Promises (Prevents hanging Asyncify yields)
2. pal_wasm_reset_physical()          # Clears fault latches
3. pal_wasm_sim_reset_all_devices()
4. VirtualClock.reset()               # Synchronizes JS and C clocks (reset_physical path convention)
5. Optional: Send re-INIT message, re-register from device tree
6. True Cold-Boot: Destroy and re-instantiate Wasm sandbox (Recommended for release regressions)
```

Fault / `reset_physical` details in [`05-memory-and-faults.md`](./05-memory-and-faults.md).

### 3.3 Cold Boot vs Hot Reuse

| Goal | Approach | Landing |
|---|---|---|
| CI "Power-On Default" | New Wasm instance per test case, or documented full reset sequence + assertion of zero residue | Partial (Practices vary across suites) |
| UI Fast Rerun | Allows hot reset; must not claim coverage of C13 cold boot | Landed usage |
| NVS / Flash Behavior | See C23; Wasm storage is mostly no-op / RAM | Per scenario |

**Fail-Loud Direction (Planned)**: If the hot reuse path skips `reset_physical` and proceeds directly to `start`, it should warn or reject—currently not enforced.

### 3.4 Multi-Board / Multi-Wasm (Closing Gray Areas)

- **MVP Contract**: 1 SimWorker = 1 Wasm Instance = 1 Logical Board.
- Multi `boards` in `sim-project.json`: Schematics/topology can be multi-board; **independent firmware instances for secondary boards** is Planned (not a current engine commitment).
- Inter-board UART / wires: Approximated within a single instance using bus/pin models; cross-Wasm clock domain alignment is undefined.

---

## 4. Cross-Reference with Axes A~F / Assurance

| Claim | Minimum Required Configuration |
|---|---|
| Canvas LED logic correct | Axis A + `behavioral` suffices |
| Ultrasonic pulse width consistent | A + B + **timing** + edge path (not Deprecated shortcut) |
| FOC algorithm reproducible | B + C soft stepping + plant; hard real-time $\rightarrow$ HIL (Timer semantics see [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)) |
| "Zero dirty state after reset" | §3 full reset or fresh instance; check C13 |

Scenario contracts and testability statuses $\rightarrow$ [`../04-assurance/01-consistency-spec.md`](../04-assurance/01-consistency-spec.md), [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md).

---

## 5. Related Documents

- [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md) — Execution Mode  
- [`02-virtual-clock.md`](./02-virtual-clock.md) / [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md) — Time & Timers  
- [`05-memory-and-faults.md`](./05-memory-and-faults.md) — Fault / reset_physical  
- [`08-channel-routing.md`](./08-channel-routing.md) — Channels & Accuracy Gate Summary  
- [`10-wasm-js-bridge-abi.md`](./10-wasm-js-bridge-abi.md) — ABI #6 / HEAPU8  
- [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) — Axes A~F Definitions  
- [`../04-assurance/02-consistency-checklist.md`](../04-assurance/02-consistency-checklist.md) — Scenario Testability
