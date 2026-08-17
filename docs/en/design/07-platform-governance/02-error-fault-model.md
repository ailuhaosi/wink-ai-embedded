# 7.2 Unified Error Code Architecture & 3-Phase Fault Model

<!-- i18n-meta
source: docs/zh/design/07-platform-governance/02-error-fault-model.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `wink_status.h` |
| **Related ADRs** | ADR-0024, ADR-0045 |

Defines global `wink_status_t` error codes and the 3-phase fault recovery model (Detect → Latch → Safe-Off).

---

## 1. Error Code Partitions

- `0` (`WINK_OK`): Success.
- `1~99`: General OS errors (Invalid Args, OOM, Timeout, Busy).
- `100~199`: PAL bus & hardware errors.
- `200~299`: DAL peripheral driver errors.
- `8000~8999`: WebAssembly simulation & host boundary errors.
