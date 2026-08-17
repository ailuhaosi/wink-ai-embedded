# 05. Embedded Frontend Workbench Architecture Specification

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/01-frontend-workbench-architecture.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This document specifies the frontend architecture, viewport layouts, state management models, and cross-repo boundaries for the Wink-AI Embedded Workbench.

---

## 1. Design Goals

1. **Professional IDE Experience**: Unified interface for circuit topology wiring, logic editing, Wasm simulation, fault injection, tracing, and flashing.
2. **Clear Safety Gates**: Progressive workflow progression through S0–S4 safety states.
3. **Pluggable Architecture**: Runs as an isolated Vue application or mounts lazily into the host platform.
4. **Runtime Insulation**: Decouples Wasm Workers, trace ring-buffers, and simulation bridges from UI rendering threads.
5. **Testability**: Independent unit tests for core state machines, manifest schemas, pin validation, and trace comparisons.

---

## 2. Layout & Information Architecture

Professional 3-column + bottom console layout:

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top Bar: Project / Target / Safety Level / Consistency / Build Status │
├───────────────┬───────────────────────────────────┬──────────────────┤
│ Left Panel    │ Center Workspace                  │ Right Panel      │
│ - Templates   │ - Circuit Canvas (2D)             │ - Properties     │
│ - Board Lib   │ - Product World (3D)              │ - Diagnostics    │
│ - Peripherals │ - Logic State Machine             │ - Fault Inject   │
│ - AI Assistant│ - Generated C Preview             │ - Build & Flash  │
├───────────────┴───────────────────────────────────┴──────────────────┤
│ Bottom Console: Trace / Logs / Static Check / Build Output / AI Fix    │
└──────────────────────────────────────────────────────────────────────┘
```
