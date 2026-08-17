# Peripheral Registry, PinArbiter & Config Plane

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/07-peripheral-registry.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (PinArbiter, Registry, JSON Configs) |
| Supporting Axis | **A (secondary)** |

---

## 1. Mechanisms

- **PinArbiter**: 4-state logic (0, 1, High-Z, Weak-Pull) handles multi-driver pin contention.
- **Peripheral Registry**: Controls virtual device lifecycles (create, wire, step, reset, destroy).
- **JSON Schema Validation**: Validates `wink-app.json` pin maps and peripheral settings.
