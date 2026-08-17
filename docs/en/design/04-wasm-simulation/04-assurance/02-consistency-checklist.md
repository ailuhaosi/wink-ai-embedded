# Simulation Consistency Checklist

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/04-assurance/02-consistency-checklist.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / assurance) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Role | Canonical ✅/🟡/❌/🚫 Verification Matrix |

---

## 1. Status Legend

- **✅ Verified**: Fully verified and passing in automated CI pipelines.
- **🟡 Partial**: Partially covered or subject to accuracy mode limits.
- **❌ Untested / Failed**: Not yet covered or failing.
- **🚫 Non-Goal (HIL Exclusive)**: Out of simulation scope; mandatory physical hardware/HIL test.
