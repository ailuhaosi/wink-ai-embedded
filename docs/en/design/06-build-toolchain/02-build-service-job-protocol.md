# 6.2 Cloud Build Service Job Protocol Specification

<!-- i18n-meta
source: docs/zh/design/06-build-toolchain/02-build-service-job-protocol.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `services/build-server/` |
| **Related ADRs** | ADR-0002, ADR-0028 |

Defines the asynchronous compilation job protocol and status event schema.

---

## 1. Protocol Architecture

```text
Workbench (POST /api/v1/build/jobs)
  ↓ { manifest: wink-app.json, sources: [...] }
Build Server Worker (Docker Container Sandbox)
  ↓ Generates CMake and invokes xtensa-esp32-elf-gcc
  ↓ Emits firmware.bin + build.log + manifest.json
Workbench (WebSocket Realtime Log Streaming & Binary Download)
```
