# 3.3 Directory Architecture & Single-Source Code Organization

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/03-directory-architecture.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `wink-micro-os/` Root Repository Architecture |
| **Related ADRs** | ADR-0002, ADR-0028, ADR-0046 |

Defines the directory layout and dual-target build organization for WinkMicroOS.

---

## 1. Directory Tree

```text
wink-micro-os/
├── dal/              # Device Abstraction Layer drivers
├── bal/              # Business Algorithm Layer (math / control / physical)
├── pal/              # Platform Abstraction headers
├── osal/             # OSAL implementations (host / wasm / esp32)
├── targets/          # Target platform adapters (wasm / esp32 / native host)
└── runtime/          # Schedulers and lifecycle runners
```
