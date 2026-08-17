# 3.5 Hardware & Simulation Fidelity Testing Guide

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/05-hardware-and-fidelity-testing-guide.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `tests/` / HIL Test Suite |
| **Related ADRs** | ADR-0003, ADR-0009, ADR-0024 |

Guides developers on verifying consistency between physical microcontrollers and the WebAssembly simulation environment.

---

## 1. The 4-Tier Test Pyramid

1. **L0 Static Checks**: AST & Clang-Tidy syntax/type enforcement.
2. **L1 Wasm/Host Unit Tests**: Deterministic state machine verification.
3. **L2 Co-Simulation Integration Tests**: Bidirectional closed-loop tests with physical plugins.
4. **L3 Physical Hardware / HIL**: Hardware-in-the-loop electrical & hard interrupt testing.
