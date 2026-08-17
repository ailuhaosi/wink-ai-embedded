# Simulation Roadmap & Quality Governance

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/04-assurance/03-roadmap-and-governance.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / assurance) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Role | Quality Gates, CI Automation, and Golden Trace Governance |

---

## 1. Quality Gate Phases

- **Phase 1 (MVP Baseline)**: Basic Pin/PWM/I2C channels, cooperative virtual-core scheduler, heap quota faults.
- **Phase 2 (Protocol Parity)**: I2C transaction analysis, Phase 0 IRQ polling queue, safe-off enforcement.
- **Phase 3 (High-Fidelity Closed-Loop)**: Bidirectional Step-Lock pipelines, deterministic PRNGs, VCD waveform exports.
