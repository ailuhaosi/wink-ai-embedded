# Wasm↔JS Bridge ABI Contract

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/10-wasm-js-bridge-abi.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (6 Iron ABI Rules, `wasm_bridge.h` SSOT, safeWrap) |
| Supporting Axis | **Cross-cutting ABI** |

---

## 1. The 6 ABI Rules

1. **Header SSOT**: All `js_pal_*` signatures are declared exclusively in `wasm_bridge.h`.
2. **Pointer Safety**: Zero raw pointers across asynchronous yield points.
3. **safeWrap Exception Handling**: JS exceptions latch into Fault 8003.
4. **Namespace Prefixes**: `pal_wasm_*` for C exports, `js_pal_*` for C imports.
5. **Pass-by-Value**: Scalar values preferred over heap sharing.
6. **Zero Undefined Symbols**: All exports statically linked.
