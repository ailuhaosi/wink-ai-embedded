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
| Deliverables | ProductWorld3D.vue, Three.js scene foundation, OrbitControls, Selection synchronization, Resource lifecycle manager |
| Milestone | M2: Render obstacle avoidance car chassis in 3D $\rightarrow$ OrbitControls rotation inspection $\rightarrow$ Selecting 3D parts syncs with 2D circuit canvas |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §3 Performance Budget |

---

## 1. Goals

1. Integrate Three.js into the Vite build system with dynamic `import()` lazy chunking.
2. Implement base 3D scene in `ProductWorld3D.vue` (Lighting, camera, ground grid, fog).
3. Materialize 3D primitive geometry models from `mechanical.parts` (Box / Cylinder / Sphere).
4. Integrate OrbitControls and camera angle presets.
5. Implement raycast click-picking to synchronize selections across dual viewports.
6. Establish Three.js GPU memory disposal protocols.

**Out of scope for this phase**: Rapier physics engine, actuator dynamics, sensor raycasting, exploded view UI and animations (see §10 extension points).

### 1.1 Architectural Principle: Sink Complexity into the Framework

W3a adopts a **Manifest data-driven + framework-layer rendering** pattern: business layers (template patch / Inspector) only declare "what parts exist, relative to whom, and where"; the framework layer handles Three.js scene tree construction, model resolution, coordinate composition, and resource lifecycles.

| Layer | Responsibility | W3a Module |
|---|---|---|
| **Data** | Flat `mechanical.parts[]` list + `parentPartId` expressing assembly trees | Manifest V2 (W2 SSOT) |
| **Resolution** | `modelId` $\rightarrow$ Geometry / Material specifications | `ModelResolver` (formerly `MODEL_LIBRARY`) |
| **Construction** | Flat parts $\rightarrow$ `Object3D` hierarchical tree | `ManifestSceneBuilder` |
| **Control** | Camera, selection, (future) exploded view progress | OrbitControls / Picking / `ExplodeController` (Phase 2) |

> **Schema Discipline**: Do not introduce independent JSON tree protocols parallel to the Manifest. Recursive sub-structures are expressed via `parentPartId` adjacency lists; exploded offsets and static transforms are **stored separately** (static in Manifest, exploded defaults in Model Catalog, see §10).

---

## 2. Three.js Integration Strategy

### 2.1 Bundle Size Control

```typescript
// Dynamic import, loaded only when VITE_ENABLE_PRODUCT_WORLD=true
const loadThreeJS = () => import('three');
const loadOrbitControls = () => import('three/addons/controls/OrbitControls.js');

// Vite configuration: Three.js separate chunk
// vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
        }
      }
    }
  }
});
```

**Expected Bundle Footprint**:

| Package | gzip Size | Loading Timing |
|---|---|---|
| `three` (core) | ~140KB | First time entering 3D viewport |
| `OrbitControls` | ~5KB | Same as above |
| Rapier (W3b) | ~450KB | Introduced in Phase W3b |

### 2.2 Loading State UI

```text
Three.js Loading:
┌─────────────────────────────────┐
│                                 │
│      ⏳ Loading 3D Engine...    │
│      ████████░░░░ 65%           │
│                                 │
└─────────────────────────────────┘
```

On load failure, displays a graceful fallback view (2D top-down diagram + error toast).

---

## 3. Scene Graph Organization

### 3.1 Base Scene Setup

```typescript
// components/world/scene-setup.ts

export function createBaseScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);  // Dark theme aligned with IDE styling
  scene.fog = new THREE.FogExp2(0x0f172a, 0.015);
  
  // ─── Lighting ───
  const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
  scene.add(ambientLight);
  
  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(5, 10, 7);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.set(1024, 1024);
  scene.add(directionalLight);
  
  const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3);
  fillLight.position.set(-5, 3, -5);
  scene.add(fillLight);
  
  // ─── Ground ───
  const gridHelper = new THREE.GridHelper(10, 40, 0x334155, 0x1e293b);
  scene.add(gridHelper);
  
  const groundGeometry = new THREE.PlaneGeometry(10, 10);
  const groundMaterial = new THREE.MeshStandardMaterial({ 
    color: 0x1e293b, 
    roughness: 0.9,
    transparent: true,
    opacity: 0.8
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.userData.isGround = true;
  scene.add(ground);
  
  return { scene, ambientLight, directionalLight, fillLight, ground };
}
```

### 3.2 Scene Node Structure

```text
Scene
├── Lights (ambient + directional + fill)
├── Ground (grid + plane)
├── ProductGroup          ← ManifestSceneBuilder root mount point
│   └── chassis_main      (Group — Root part, parentPartId = null)
│       ├── _mesh         (Box — Chassis body)
│       ├── wheel_left    (Group -> Cylinder, parentPartId = chassis_main)
│       ├── wheel_right   (Group -> Cylinder)
│       └── mount_ultrasonic (Group -> Box)
├── EnvironmentGroup      ← environment.props rendered here (W4)
│   └── (empty in W3a)
├── DebugGroup           ← Raycast helpers (W3c)
│   └── (empty in W3a)
└── SelectionHighlight   ← Selected object outline overlays
```

### 3.3 Manifest-Driven Scene Builder

W2 `mechanical.parts` is a **flat array** + optional `parentPartId` (see [02-phase-w2-binding-model.md](./02-phase-w2-binding-model.md) §2.1). The framework materializes this into a Three.js parent-child tree, aligning with exploded view needs for recursive sub-structures and local coordinate composition.

```typescript
// components/world/manifest-scene-builder.ts

export interface PartNodeUserData {
  partId: string;
  domain: 'mechanical';
  modelId: string;
  /** Assembled state local coordinate snapshot (exploded baseline) */
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
  originalScale: THREE.Vector3;
  /** Phase 2: From ModelDefinition.explodeDefaults, overridable at part level */
  explodeConfig?: ExplodeConfig;
}

export interface ExplodeConfig {
  axis: THREE.Vector3;   // Normalized direction vector in parent local space
  distance: number;      // Maximum displacement (m)
}

export class ManifestSceneBuilder {
  private partNodes = new Map<string, THREE.Group>();

  build(parts: MechanicalPart[], productGroup: THREE.Group): void {
    this.partNodes.clear();
    productGroup.clear();

    // Pass 1: Create Group + Mesh for each part
    for (const part of parts) {
      const node = this.createPartNode(part);
      this.partNodes.set(part.partId, node);
    }

    // Pass 2: Attach to parentPartId tree; root items attach to ProductGroup
    for (const part of parts) {
      const node = this.partNodes.get(part.partId)!;
      const parent = part.parentPartId
        ? this.partNodes.get(part.parentPartId)
        : productGroup;
      if (part.parentPartId && !parent) {
        console.warn(`Unknown parentPartId: ${part.parentPartId}, hoisting to root`);
        productGroup.add(node);
        continue;
      }
      parent!.add(node);
    }
  }

  private createPartNode(part: MechanicalPart): THREE.Group {
    const group = new THREE.Group();
    group.name = part.partId;
    applyTransform(group, part.transform);

    const mesh = createMeshFromModel(part.modelId); // ModelResolver
    mesh.name = '_mesh';
    group.add(mesh);

    group.userData = {
      partId: part.partId,
      domain: 'mechanical',
      modelId: part.modelId,
      originalPosition: group.position.clone(),
      originalRotation: group.rotation.clone(),
      originalScale: group.scale.clone(),
      explodeConfig: resolveExplodeDefaults(part.modelId), // W3a: Optional, defaults to undefined
    } satisfies PartNodeUserData;

    return group;
  }
}
```

**Coordinate Composition Rules** (consistent with Master Plan §13):

| Item | Convention |
|---|---|
| World Space | Three.js right-handed coordinate system, Y Upward, unit **m** |
| Part transform | Local TRS relative to **parent Part Group** |
| Root Part | Without `parentPartId` $\rightarrow$ mounts to `ProductGroup`, transform relative to product origin |
| Child Part Motion | W3b joint driving modifies child Group local transform only; parent explosions/translations automatically compose onto children |

**Incremental Updates**: `parentPartId` mutations trigger **reparenting**—detach from old parent, attach to new parent, and recompute `originalPosition` snapshots without full rebuilds (see §7.2).

---

## 4. Built-in Model Library

### 4.1 W3a Primitive Geometry Models

Each `modelId` maps to geometric parameters:

```typescript
// components/world/model-library.ts

export interface ModelDefinition {
  modelId: string;
  displayName: string;
  geometry: GeometrySpec;
  defaultMaterial: MaterialSpec;
  defaultTransform?: Partial<Transform3D>;
  /** Phase 2 Exploded Views: Catalog-level default expansion axis/distance */
  explodeDefaults?: ExplodeConfig;
}

type GeometrySpec = 
  | { type: 'box'; width: number; height: number; depth: number }
  | { type: 'cylinder'; radius: number; height: number; segments?: number }
  | { type: 'sphere'; radius: number }
  | { type: 'compound'; children: { geometry: GeometrySpec; offset: Vector3 }[] };

const MODEL_LIBRARY: Record<string, ModelDefinition> = {
  'diff_drive_chassis_v1': {
    modelId: 'diff_drive_chassis_v1',
    displayName: 'Differential Chassis',
    geometry: { type: 'box', width: 0.20, height: 0.04, depth: 0.15 },
    defaultMaterial: { color: 0x3B82F6, metalness: 0.3, roughness: 0.7 },
  },
  'drive_wheel_v1': {
    modelId: 'drive_wheel_v1',
    displayName: 'Drive Wheel',
    geometry: { type: 'cylinder', radius: 0.03, height: 0.015 },
    defaultMaterial: { color: 0x1e293b, metalness: 0.1, roughness: 0.9 },
    explodeDefaults: { axis: { x: -1, y: 0, z: 0 }, distance: 0.08 }, // Phase 2 reserved
  },
  'caster_wheel_v1': {
    modelId: 'caster_wheel_v1',
    displayName: 'Caster Wheel',
    geometry: { type: 'sphere', radius: 0.015 },
    defaultMaterial: { color: 0x64748b, metalness: 0.5, roughness: 0.5 },
  },
  'ultrasonic_mount_v1': {
    modelId: 'ultrasonic_mount_v1',
    displayName: 'Ultrasonic Mount',
    geometry: { type: 'box', width: 0.04, height: 0.025, depth: 0.02 },
    defaultMaterial: { color: 0x22d3ee, metalness: 0.2, roughness: 0.6 },
  },
  'sensor_enclosure_v1': {
    modelId: 'sensor_enclosure_v1',
    displayName: 'Sensor Enclosure',
    geometry: { type: 'box', width: 0.06, height: 0.06, depth: 0.06 },
    defaultMaterial: { color: 0xf59e0b, metalness: 0.2, roughness: 0.7 },
  },
  'env_wall_segment': {
    modelId: 'env_wall_segment',
    displayName: 'Wall Segment',
    geometry: { type: 'box', width: 2.0, height: 0.3, depth: 0.05 },
    defaultMaterial: { color: 0x475569, metalness: 0.1, roughness: 0.9 },
  },
  'env_heat_source': {
    modelId: 'env_heat_source',
    displayName: 'Heat Source',
    geometry: { type: 'sphere', radius: 0.05 },
    defaultMaterial: { color: 0xef4444, emissive: 0xff4400, emissiveIntensity: 2.0 },
  },
};
```

### 4.2 Model Rendering Flow

W3a **no longer** attaches Meshes directly to `ProductGroup`; everything passes through `ManifestSceneBuilder` to produce a **Group (Part Node) + Mesh (Visual Body)** structure. Picking and highlights target the **Group** (`userData.partId`), while Mesh handles geometry.

```typescript
function createMeshFromModel(modelId: string): THREE.Mesh {
  const modelDef = MODEL_LIBRARY[modelId];
  if (!modelDef) {
    console.warn(`Unknown model: ${modelId}, using fallback box`);
    // fallback: 0.05m gray cube
  }
  const geometry = createGeometry(modelDef?.geometry ?? FALLBACK_BOX);
  const material = new THREE.MeshStandardMaterial(modelDef?.defaultMaterial ?? FALLBACK_MAT);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}
```

### 4.3 Asset Strategy: Parametric Assembly vs External glTF

| Dimension | W3a–MVP (**Parametric Assembly**) | Phase 2 (**glTF External Models**) |
|---|---|---|
| Source | Built-in `MODEL_LIBRARY` primitives + `compound` compositions | Artist glTF/FBX URLs or bundled assets |
| Parsing Focus | **Coordinate assembly**, `parentPartId` tree, colliders & binding semantics | **Asset loading** + optional mesh subtree mapping |
| Applicable Scope | Educational templates, AI-generated projects, rapid iteration | High-fidelity product appearance, complex organic surfaces |
| Binding Link | `partId` $\leftrightarrow$ `bindings` (Semantic SSOT) | Same as left; independent of internal glTF node names |
| W3a Impl | ✅ | Interface stub only |

**Conclusion**: Wink prioritizes **Manifest-driven procedural assembly**; glTF serves as a visual enhancement layer without altering Manifest tree topologies.

### 4.4 glTF Extension Point (Phase 2)

```typescript
// ModelResolver extension: Not implemented in W3a
export async function loadGLTFModel(url: string): Promise<THREE.Group> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}
```

---

## 5. Camera Angles & Controls

### 5.1 OrbitControls Configuration

```typescript
function setupCamera(container: HTMLElement) {
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 100);
  camera.position.set(0.3, 0.4, 0.5);
  camera.lookAt(0, 0, 0);
  
  const controls = new OrbitControls(camera, container);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.1;
  controls.maxDistance = 5;
  controls.maxPolarAngle = Math.PI * 0.85; // Prevents camera from passing beneath the ground
  controls.target.set(0, 0.05, 0);  // Targets slightly above chassis center
  
  return { camera, controls };
}
```

### 5.2 Camera Angle Presets

| Shortcut / Button | Viewpoint | Camera Position | LookAt |
|---|---|---|---|
| `Numpad 7` / Top Button | Top-Down | (0, 1, 0) | (0, 0, 0) |
| `Numpad 1` / Front Button | Front | (0, 0.2, 0.8) | (0, 0.05, 0) |
| `Numpad 3` / Side Button | Right Side | (0.8, 0.2, 0) | (0, 0.05, 0) |
| `F` | Focus Selection | Auto-computed | Selected object center |
| `Home` | Reset Default | (0.3, 0.4, 0.5) | (0, 0.05, 0) |

Perspective switches animate with `300ms ease-out` transitions.

---

## 6. Selection & Dual-Viewport Synchronization

### 6.1 Raycast Click-Picking

```typescript
function setupPicking(scene: THREE.Scene, camera: THREE.Camera, container: HTMLElement) {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  
  container.addEventListener('click', (event) => {
    const rect = container.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(productGroup.children, true);
    
    if (intersects.length > 0) {
      // Find ancestor Group with partId starting from hit Mesh
      const picked = findPickableAncestor(intersects[0].object);
      if (picked?.userData.partId) {
        selectionStore.select({
          domain: picked.userData.domain,
          componentId: picked.userData.partId,
          sourceViewport: 'world',
        });
      }
    } else {
      selectionStore.clearSelection();
    }
  });
}
```

### 6.2 Selection Highlight Overlay

```typescript
// Outline highlight effect
function highlightPartNode(node: THREE.Group, state: 'selected' | 'binding-group' | 'none') {
  const mesh = node.getObjectByName('_mesh') as THREE.Mesh | undefined;
  if (!mesh) return;
  // Remove existing outline
  const existingOutline = mesh.getObjectByName('_outline');
  if (existingOutline) mesh.remove(existingOutline);
  
  if (state === 'none') return;
  
  const outlineGeometry = mesh.geometry.clone();
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: state === 'selected' ? 0x3B82F6 : 0x60A5FA,
    side: THREE.BackSide,
    transparent: true,
    opacity: state === 'selected' ? 0.6 : 0.3,
  });
  
  const outline = new THREE.Mesh(outlineGeometry, outlineMaterial);
  outline.name = '_outline';
  outline.scale.multiplyScalar(1.08);
  mesh.add(outline);
}
```

### 6.3 Dual-Viewport Synchronization

```typescript
// Watch selection mutations in selection.store.ts
watch(() => selectionStore.current, (sel) => {
  if (!sel) {
    clearAllHighlights();
    return;
  }
  
  if (sel.sourceViewport === 'circuit') {
    // Selected from circuit -> find bound mechanical part in 3D and highlight
    const bindings = findBindingsByDevice(sel.componentId);
    bindings.forEach(b => {
      const node = findPartNodeByPartId(b.mechanicalPartId);
      if (node) highlightPartNode(node, 'binding-group');
    });
  }
  
  if (sel.sourceViewport === 'world') {
    // Selected from 3D -> highlight corresponding device in circuit canvas
    const bindings = findBindingsByPart(sel.componentId);
    bindings.forEach(b => {
      circuitCanvasRef.value?.highlightDevice(b.deviceComponentId);
    });
  }
});
```

---

## 7. Resource Lifecycle Management

### 7.1 Disposal Protocol

```typescript
// ProductWorld3D.vue
onBeforeUnmount(() => {
  disposeSceneResources(scene);
  renderer.dispose();
  controls.dispose();
  cancelAnimationFrame(animationFrameId);
});

function disposeSceneResources(obj: THREE.Object3D) {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach(m => disposeMaterial(m));
      } else {
        disposeMaterial(child.material);
      }
    }
  });
}

function disposeMaterial(material: THREE.Material) {
  material.dispose();
  // Release textures if present
  for (const key of Object.keys(material)) {
    const value = (material as any)[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
}
```

### 7.2 Incremental Updates on Manifest Mutations

```typescript
// Watch mechanical.parts mutations
watch(() => projectStore.manifest.mechanical?.parts, (newParts, oldParts) => {
  const diff = computePartsDiff(oldParts ?? [], newParts ?? []);
  
  // Dispose removed parts
  for (const removed of diff.removed) {
    const node = partNodeRegistry.get(removed.partId);
    if (node) {
      disposeSceneResources(node);
      node.removeFromParent();
      partNodeRegistry.delete(removed.partId);
    }
  }
  
  // Add new parts via SceneBuilder
  for (const added of diff.added) {
    sceneBuilder.addPart(added);
  }
  
  // Apply transform/reparent updates
  for (const updated of diff.updated) {
    if (updated.fields.includes('parentPartId')) {
      sceneBuilder.reparent(updated.partId, updated.parentPartId);
    }
    if (updated.fields.includes('transform')) {
      sceneBuilder.applyTransform(updated.partId, updated.transform);
    }
  }
}, { deep: true });
```

---

## 8. WebGL Fallback Strategy

| Detection | Fallback Strategy |
|---|---|
| `WebGLRenderingContext` absent | Renders 2D top-down SVG diagram |
| `WebGL2` unsupported but `WebGL1` available | Reduces shadow map quality + disables fog |
| GPU driver blacklisted | Same as WebGL1 fallback |
| Rendering framerate continuously < 20fps | Toast notice + suggests disabling shadows |

```typescript
function detectWebGLCapabilities(): 'webgl2' | 'webgl1' | 'none' {
  const canvas = document.createElement('canvas');
  if (canvas.getContext('webgl2')) return 'webgl2';
  if (canvas.getContext('webgl')) return 'webgl1';
  return 'none';
}
```

---

## 9. Render Loop (W3a Simplified)

```typescript
// W3a: No physics, render + controls only
function startRenderLoop() {
  const clock = new THREE.Clock();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    controls.update();  // OrbitControls damping
    
    // Visibility check: skip rendering when tab is hidden
    if (document.hidden) return;
    
    renderer.render(scene, camera);
  }
  
  animate();
}
```

---

## 10. Exploded View Extension Points (Phase 2 Reserved)

**Static transforms decouple from exploded displacements**, interpolating between assembled and disassembled states via `setExplodeProgress(0..1)`. W3a captures `originalPosition` snapshots in `PartNodeUserData`; UI sliders and animations are deferred to Phase 2.

### 10.1 Exploded Algorithm (Parent Local Space)

Three.js parent-child hierarchy guarantees: when a parent Group displaces, child nodes automatically compose; child nodes only append offsets within their **own local space**.

```typescript
// components/world/explode-controller.ts — Phase 2 Implementation

export class ExplodeController {
  setExplodeProgress(root: THREE.Object3D, progress: number): void {
    root.traverse((node) => {
      const ud = node.userData as PartNodeUserData;
      if (!ud?.originalPosition || !ud.explodeConfig) return;

      const { axis, distance } = ud.explodeConfig;
      const offset = axis.clone().normalize().multiplyScalar(distance * progress);

      node.position.copy(ud.originalPosition).add(offset);
    });
  }
}
```

### 10.2 Configuration Hierarchy

| Priority | Source | Description |
|---|---|---|
| 1 | `ModelDefinition.explodeDefaults` | Catalog-level (e.g. drive wheel defaults to -X 8cm) |
| 2 | `mechanical.parts[].explodeOverride?` | **Phase 2 Optional** Manifest field |
| 3 | Root Node | `distance: 0`, does not disperse |

---

## 11. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | Three.js lazy loads dynamically; initial bundle free of 3D assets | Bundle Analyzer |
| A2 | Obstacle car chassis + wheels + ultrasonic mount render properly in 3D | Visual |
| A2b | Child parts (wheels) position correctly relative to chassis (`parentPartId` tree) | Moving chassis moves wheels; local offset edits update properly |
| A3 | OrbitControls rotation / zoom / pan perform smoothly | Manual |
| A4 | Perspective preset buttons and shortcuts switch views smoothly | Manual |
| A5 | Clicking 3D part $\rightarrow$ Right panel switches to Mechanical Tab $\rightarrow$ Circuit highlights | Manual |
| A6 | Clicking circuit device $\rightarrow$ Bound 3D part highlights | Manual |
| A7 | GPU memory and resources release cleanly on component unmount | Chrome DevTools Memory |
| A8 | Adding/removing parts or changing `parentPartId` updates incrementally | Manual |
| A8b | `partNodeRegistry` keys by `partId` (Group), not Mesh | Code Review |
| A9 | WebGL absence triggers graceful 2D fallback view | Simulated (`getContext` returns null) |
| A10 | Hidden tab suspends rendering loop | Chrome Performance |

---

*Document Revision History:*

- 2026-07-09: Initial creation.
- 2026-07-10: Review revisions—§1.1 framework layering; §3.3 `ManifestSceneBuilder` + `parentPartId` tree; §4.3 asset strategy; §10 exploded view extension points; Acceptance A2b/A8b.
