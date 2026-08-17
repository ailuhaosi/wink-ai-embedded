# 4.3 AI DSL & Code Generation Pipeline Specification

<!-- i18n-meta
source: docs/zh/design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `wink-tools/codegen/` |
| **Related ADRs** | ADR-0004, ADR-0046, ADR-0051 |

Defines the end-to-end pipeline transforming user intent / state machine DSL into compilable C firmware.

---

## 1. Pipeline Stages

```text
DSL / Canvas JSON
  ↓ Validates pin allocations & capabilities
Device Tree Generation (device_tree.c / device_tree.h)
  ↓ AI State Machine synthesis
App Logic (app_main.c)
  ↓ Static security & AST linting
Wasm Simulation Sandbox Testing
  ↓
Cloud Cross-Compilation (ESP32 / STM32 ELF)
```
