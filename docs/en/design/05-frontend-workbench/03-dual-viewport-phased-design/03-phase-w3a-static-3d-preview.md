# W3a Static 3D Preview — Three.js Integration & Scene Rendering

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/03-phase-w3a-static-3d-preview.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W3a |
| Effort Estimate | ~1 day |
| Prerequisites | W2 Binding Model complete |
| Deliverables | `ProductWorld3D.vue`, Three.js scene foundation, OrbitControls, Selection synchronization, Resource lifecycle manager |
| Milestone | M2: Render obstacle avoidance car chassis in 3D $\rightarrow$ OrbitControls rotation $\rightarrow$ Selecting 3D parts syncs with 2D circuit canvas |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §3 Performance Budget |

---

## 1. Goals

1. Integrate Three.js via dynamic `import()` for lazy bundle chunking.
2. Implement base 3D scene (Lights, camera, ground grid, shadows).
3. Materialize 3D primitive geometry models from `mechanical.parts` (Box, Cylinder, Sphere).
4. Integrate OrbitControls and camera angle presets.
5. Raycast click-picking to synchronize selections between 2D circuit and 3D viewports.
6. Enforce GPU memory disposal protocols.

---

## 2. Dynamic Bundle Loading

```typescript
const loadThreeJS = () => import('three');
const loadOrbitControls = () => import('three/addons/controls/OrbitControls.js');
```

- `three` core: ~140KB gzip.
- `OrbitControls`: ~5KB gzip.

---

## 3. Scene Graph Organization & Manifest Scene Builder

```text
Scene
├── Lights (Ambient + Directional + Fill)
├── Ground (Grid + Plane)
├── ProductGroup (Root mount for ManifestSceneBuilder)
│   └── chassis_main (Group: Root part, parentPartId = null)
│       ├── _mesh (Box: Chassis body)
│       ├── wheel_left (Group: Cylinder, parentPartId = chassis_main)
│       ├── wheel_right (Group: Cylinder)
│       └── mount_ultrasonic (Group: Box)
└── SelectionHighlight (Outline mesh overlays)
```

`ManifestSceneBuilder` parses flat `mechanical.parts[]` arrays and constructs the hierarchical parent-child `THREE.Group` scene tree using `parentPartId`.

---

## 4. Built-in Model Library

| Model ID | Geometry Spec | Dimensions (m) | Material / Color |
|---|---|---|---|
| `diff_drive_chassis_v1` | Box | $0.20 \times 0.04 \times 0.15$ | `#3B82F6` Blue |
| `drive_wheel_v1` | Cylinder | Radius: 0.03, Height: 0.015 | `#1E293B` Dark Slate |
| `caster_wheel_v1` | Sphere | Radius: 0.015 | `#64748B` Gray |
| `ultrasonic_mount_v1` | Box | $0.04 \times 0.025 \times 0.02$ | `#22D3EE` Cyan |
| `sensor_enclosure_v1` | Box | $0.06 \times 0.06 \times 0.06$ | `#F59E0B` Amber |
| `env_wall_segment` | Box | $2.0 \times 0.3 \times 0.05$ | `#475569` Slate Wall |
| `env_heat_source` | Sphere | Radius: 0.05 | `#EF4444` Emissive Red |

---

## 5. Camera Angles & Controls

- `Numpad 7`: Top-down view $(0, 1, 0)$
- `Numpad 1`: Front view $(0, 0.2, 0.8)$
- `Numpad 3`: Side view $(0.8, 0.2, 0)$
- `F`: Focus camera on the selected object.
- `Home`: Reset to default perspective $(0.3, 0.4, 0.5)$.

---

## 6. Selection & Dual-Viewport Synchronization

Raycasting detects clicked meshes and resolves parent Groups carrying `userData.partId`. Selections trigger `selectionStore.select()` which simultaneously highlights corresponding 2D circuit devices.

---

## 7. Resource Disposal Protocol

Components intercept `onBeforeUnmount` to recursively traverse the scene tree and invoke `.dispose()` on all geometries, materials, and textures, preventing WebGL context leaks.

---

## 8. WebGL Fallback

When WebGL context creation fails, the viewport falls back gracefully to a 2D top-down SVG rendering of chassis bounding boxes accompanied by a user toast notification.
