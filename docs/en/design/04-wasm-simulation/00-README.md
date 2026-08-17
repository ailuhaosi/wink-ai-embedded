# Wasm Simulation & Frontend Runtime Engine (UniSim) — 3.0 SSOT

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/00-README.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Field | Content |
|---|---|
| Doc Level | ① Design Specification (Path: `docs/en/design/04-wasm-simulation/`) |
| **Doc Status** | **Active** (Switched on 2026-08-02; Active SSOT entry point for Wasm simulation) |
| Related ADRs | 0002, 0003, 0009, 0013, 0014, 0019, 0025, 0040, 0042, 0045, 0047 |
| Related Code | `wink-micro-os/osal/wasm/`, `wink-micro-os/targets/{wasm,common}/`, `@wink-ai/unisim` TS SDK Contract |
| Last Audit | 2026-08-11 Amend (PWM Channel 1b reclassification, IRQ/DMA/Timer control planes) |

> **Active Entry Point**: UniSim 3.0 is the active Single Source of Truth (SSOT) for WebAssembly embedded simulation.

---

## 0. UniSim 3.0 Four-Tier Architecture

| Tier | Directory | Scope & Responsibilities | Depth |
|---|---|---|---|
| **Ⅰ Overview** | [`01-overview/`](./01-overview/) | Concepts, architecture, methodology, production contracts, glossary | Medium |
| **Ⅱa Mechanisms** | [`02-mechanisms/`](./02-mechanisms/) | Engine subsystem implementations (Sandbox, Clock, Dispatch, Channels) | **Heavy (Implementation SSOT)** |
| **Ⅱb Fidelity Axes** | [`03-axes/`](./03-axes/) | A~F orthogonal fidelity axes guarantees and upper bounds | Thin |
| **Ⅲ Assurance** | [`04-assurance/`](./04-assurance/) | Verification contracts, state matrix, maturity levels, CI regression | Medium |

---

## 1. Directory Tree Structure

```text
04-wasm-simulation/
├── 00-README.md                          ← This file: Master entry & SSOT rules
├── 01-overview/                          ← Ⅰ Macro Overview (Architecture / Axes / Glossary)
├── 02-mechanisms/                        ← Ⅱa Engine Mechanisms (Sandbox / Clock / IRQ / Channels)
├── 03-axes/                              ← Ⅱb Fidelity Axes (A~F orthogonal fidelity bounds)
└── 04-assurance/                         ← Ⅲ Assurance & Governance (Contracts / State Matrix / CI)
```
