# 03. Product User Journey, Information Architecture & Experience Design

<!-- i18n-meta
source: docs/zh/design/01-system-overall/03-product-user-journey.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

This specification defines the core user journeys, page information architecture, decision gates, and failure recovery experiences from a Product Manager's perspective.

---

## 1. Product Statement & Core Value Propositions

> **Wink-AI** is a safe embedded development platform that enables users to generate business logic via AI or visual blocks, verify it via high-fidelity in-browser simulation, and flash it to real MCUs with one click.

Core Value Propositions:
1. **Safety First**: AI-generated C code is sandboxed and verified through fault injection before flashing.
2. **Zero Toolchain Friction**: Users don't need to configure complex cross-compilers locally.
3. **Rapid Closed-Loop**: Canvas wiring, simulation, compilation, and flashing occur in a unified browser flow.
4. **Single-Source Parity**: The exact same application logic runs across simulation and physical hardware.
5. **Traceable Consistency**: Golden Trace streams prove behavior matches across virtual and physical worlds.

---

## 2. Information Architecture

```text
Embedded Workbench (Dual-Viewport: design / simulate / diagnose modes)
├── Top Bar (Board selector, Mode switcher, Safety Level S0~S4)
├─ Center Workspace (Dual-Viewport Split View)
│   ├── Viewport A: 2D Circuit Canvas (HCTR wiring, pin checks)
│   └── Viewport B: 3D Product World (Three.js/WebGL mechanical physics)
├── Right Panel (Property Inspector SchemaForm, Bindings, Fault Injection)
├── Left Drawer (Device Catalog, AI Assistant / State Machine Editor)
└── Bottom Console (Golden Trace timeline, diagnostics, WebSerial/WebUSB Flash Wizard)
```

---

## 3. End-to-End User Journey

```text
Select Template -> Open Canvas -> Configure Peripherals -> Generate App Logic -> Static Safety Gates -> Run Wasm Simulation -> Fault Testing -> Cloud Compilation -> WebSerial Flash -> Verify Physical Trace
```
