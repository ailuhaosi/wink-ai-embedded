# 4.2 Project Manifest (wink-app.json) Schema Specification

<!-- i18n-meta
source: docs/zh/design/03-app-codegen/02-project-manifest-schema.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `wink-app.json` |
| **Related ADRs** | ADR-0008, ADR-0034, ADR-0040, ADR-0051 |

Defines the SSOT schema for project topologies, target boards, peripheral wiring, and build configurations.

---

## 1. Top-Level Schema

```json
{
  "$schema": "https://wink-ai.com/schemas/wink-app.v1.json",
  "project": {
    "name": "smart-car",
    "version": "1.0.0",
    "target": "esp32"
  },
  "peripherals": [
    {
      "id": "front_radar",
      "type": "ultrasonic",
      "driver": "dal_ultrasonic",
      "pins": { "trig": 4, "echo": 5 }
    }
  ]
}
```
