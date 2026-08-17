# 04. Cross-Repository Boundary & Confidentiality Contract

<!-- i18n-meta
source: docs/zh/design/01-system-overall/04-cross-repo-boundary-contract.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This document defines the cross-repository physical architecture, data exchange contracts, and **Black-Box Confidentiality Insulation** rules between `wink-ai-embedded` (C kernel & toolchain repo) and the sibling packages in the `wink-ai` main Monorepo (`embedded-frontend`, `unisim`).

---

## 1. Black-Box Confidentiality Insulation Rules

1. **Black-Box Boundary**: For external main repo modules (`embedded-frontend`, `unisim`), this repository's design documents **only specify public capabilities, usage scenarios, and interface DTO / ABI / CLI contracts**.
2. **No Implementation Leaks**: Never document proprietary rendering optimizations or cloud server scheduling logic inside this repo.
3. **Machine-Readable Contracts as SSOT**: Inter-repo collaboration relies solely on versioned schemas (`wink-app.json` Schema, `SimTraceSpecV2`, `wasm_bridge.h` ABI).

---

## 2. Monorepo Package Mapping

```text
Wink-AI Cross-Repository Contract Architecture:

[ External Main Monorepo Packages ] (Black-box dependencies)
├── embedded-frontend                       # Component 1: Embedded Web Workbench UI
│   └── Public Contract: wink-app.json Manifest, Dual-Viewport State DTO
└── unisim                                  # Component 2: UniSim Wasm Simulation Engine
    └── Public Contract: wasm_bridge.h C-ABI, SimTraceSpecV2 Spec

[ This Repo: wink-ai-embedded ] (Open-source / Core C SDK & CLI)
├── wink-tools/                             # Component 3: Unified CLI (wink CLI)
├── wink-micro-os/                          # Component 4: C Embedded SDK Kernel (PAL/DAL/BAL)
└── wink-micro-app/                         # Component 5: Embedded Application Standard
```

---

## 3. The 3 Core Machine-Readable Contracts

### 3.1 Contract 1: Project Manifest SSOT (`wink-app.json`)
* `embedded-frontend`: Exports canvas topologies and properties to `wink-app.json`.
* `wink-tools`: Reads `wink-app.json` and runs `wink gen` to output `app_main.c` & `device_tree.c`.
* `wink-micro-os`: Compiles and executes the resulting C code.

### 3.2 Contract 2: Wasm Simulation Bridge C-ABI (`wasm_bridge.h`)
* Exported: `wink_wasm_init()`, `wink_wasm_step(microseconds)`, `wink_wasm_get_trace_buffer()`.
* Imported: Virtual peripheral hooks injected by `unisim` (`unisim_gpio_write`, `unisim_i2c_transfer`).

### 3.3 Contract 3: Semantic Event Trace Protocol (`SimTraceSpecV2`)
* Structured JSONL / JSON envelopes with microsecond timestamps, device IDs, event types, and payloads for replay and CI assertions.
