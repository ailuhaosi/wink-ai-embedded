# Methodology, Reading Paths & Static Quality Gates Summary

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/01-overview/04-methodology.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / overview) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Governing ADRs | [0002](../../../decisions/unisim/0002-dual-target-compilation.md), [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md), [0025](../../../decisions/core/0025-app-blocking-api-honesty-pragma-convention.md), [0040](../../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md) |

---

## 1. Role-Based Reading Paths

- **App & Low-Code Developers**: [`00-README`](../00-README.md) → [`02-axes-af.md`](./02-axes-af.md) → [`03-production-contract.md`](./03-production-contract.md) → [`08-channel-routing`](../02-mechanisms/08-channel-routing.md) → [`02-consistency-checklist`](../04-assurance/02-consistency-checklist.md).
- **Driver & DAL Developers**: [`08-channel-routing`](../02-mechanisms/08-channel-routing.md) → [`10-wasm-js-bridge-abi`](../02-mechanisms/10-wasm-js-bridge-abi.md) → [`01-consistency-spec`](../04-assurance/01-consistency-spec.md).
- **UniSim Engine Engineers**: [`01-architecture.md`](./01-architecture.md) → [`02-mechanisms/`](../02-mechanisms/00-README.md).

---

## 2. Bypass Discipline

- **PAL is the sole legitimate bypass sink point**: Sinks physical inputs/outputs to PAL targets; DAL/App maintain 100% identical source code.
- **No DAL `#ifdef SIMULATION` branches**: Prevents bypassing conversion and error-recovery code.
- **JSON Gating Fail-Loud**: Undeclared semantic bypasses fail compilation/runtime via [ADR-0040](../../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md).
