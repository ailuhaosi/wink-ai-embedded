# Hardware Timer Semantics & PWM Soft-Stepping

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/09-timer-and-pwm-semantics.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Partial** (PWM duty Landed, Soft-stepping Partial, Hard ISR Planned) |
| Supporting Axis | **C (primary)** |

---

## 1. Mechanisms

- **PWM Semantic Routing**: `pal_pwm_set_duty()` updates duty cycle in plugins without cycle-level carrier wave simulation.
- **Soft-Stepping**: Approximates hardware timers synchronously within virtual time steps.
- **Resource Mutual Exclusion**: Validates pin and timer hardware channel allocations.
