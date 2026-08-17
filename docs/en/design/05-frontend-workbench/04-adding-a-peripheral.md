# 04. Guide to Adding New Frontend Peripheral Components

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/04-adding-a-peripheral.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `apps/web/src/components/peripherals/` |
| **Related ADRs** | ADR-0046, ADR-0051 |

Step-by-step developer guide on introducing new virtual peripherals into the Workbench.

---

## 1. Core Workflow

1. **Define Schema Metadata**: Pin constraints, electrical defaults, catalog iconography.
2. **Implement UniSim Plugin**: Handle edge events, bus transactions, or ADC physical values.
3. **Build 2D Canvas Component**: Vue 3 / SVG / Wokwi-Element graphical rendering.
4. **Bind 3D Model (Optional)**: GLTF armature animation and collision meshes.
5. **Register in Device Registry & Add Unit Tests**.
