# Tier Ⅱa Engine Mechanisms (mechanisms)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/00-README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Tier | Ⅱa Implementation SSOT |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Role | Explains implementation mechanics subsystem by subsystem |

## Layer Hierarchy (Bottom-Up)

```text
1 Execution Environment / Sandbox → 01-sandbox-and-execution
2 Timebase                        → 02-virtual-clock
3 Concurrency & Scheduler         → 03-scheduler-and-concurrency
4 Interrupts                      → 04-interrupt-model
5 Faults & Resource Limits        → 05-memory-and-faults
6 Physical Degradation & Faults   → 06-physical-degradation
7 Peripheral Config Plane         → 07-peripheral-registry
8 Peripheral Data Plane Channels  → 08-channel-routing
9 Hardware Timer Semantics        → 09-timer-and-pwm-semantics
10 Host Bridge ABI                → 10-wasm-js-bridge-abi
11 Observability & Lifecycle      → 11-accuracy-observation-lifecycle
12 Closed-Loop Parity             → 12-bidirectional-high-fidelity-closed-loop
```

## Files in this Directory

| File | Primary Axis |
|---|---|
| [01-sandbox-and-execution.md](./01-sandbox-and-execution.md) | Cross-cutting; STRICT implementation |
| [02-virtual-clock.md](./02-virtual-clock.md) | Axis B primary |
| [03-scheduler-and-concurrency.md](./03-scheduler-and-concurrency.md) | Axis E primary |
| [04-interrupt-model.md](./04-interrupt-model.md) | Axis D primary |
| [05-memory-and-faults.md](./05-memory-and-faults.md) | Axis F primary |
| [06-physical-degradation.md](./06-physical-degradation.md) | Axis A/F secondary |
| [07-peripheral-registry.md](./07-peripheral-registry.md) | Axis A secondary |
| [08-channel-routing.md](./08-channel-routing.md) | Axis A primary |
| [09-timer-and-pwm-semantics.md](./09-timer-and-pwm-semantics.md) | Axis C primary |
| [10-wasm-js-bridge-abi.md](./10-wasm-js-bridge-abi.md) | Cross-cutting ABI |
| [11-accuracy-observation-lifecycle.md](./11-accuracy-observation-lifecycle.md) | Axis F secondary |
| [12-bidirectional-high-fidelity-closed-loop.md](./12-bidirectional-high-fidelity-closed-loop.md) | Axis A/B/E primary |
