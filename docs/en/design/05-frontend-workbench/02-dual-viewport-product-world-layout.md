# 02. Dual-Viewport Product World Layout & Interactive Sync

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/02-dual-viewport-product-world-layout.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `apps/web/src/views/workbench/` |
| **Related ADRs** | ADR-0003, ADR-0009 |

Defines the split-screen synchronization between the 2D Circuit Canvas and the 3D Product World viewports.

---

## 1. Dual-Viewport Architecture

- **Viewport A (2D Circuit Canvas)**: Device wiring, pin allocation, electrical rule validation.
- **Viewport B (3D Product World)**: Three.js/WebGL mechanical models, raycaster collisions, physical kinematics.
- **State Synchronization**: Electrical pin events in Viewport A drive Viewport B 3D models; physical quantities from Viewport B are injected into simulation plugins.
