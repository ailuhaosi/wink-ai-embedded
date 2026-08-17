# Physical Degradation & Fault Injection Mechanism

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/06-physical-degradation.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Debounce, RC filter, Packet drops, PRNG) |
| Supporting Axis | **A/F (secondary)** |

---

## 1. Physical Degradation Algorithms

- **Deterministic PRNG**: Seeded LCG ensures noise and packet loss sequences are 100% reproducible across CI runs.
- **Signal Filtering & Bouncing**: Emulates switch contact bounces, ADC thermal noise, and sensor warmups.
- **Bus Fault Injections**: Supports simulated NACKs, byte drops, and timeouts on I2C/SPI/UART.
