# W3a 静态 3D 预览 — Three.js 集成与场景渲染

| 项 | 内容 |
|----|------|
| 阶段 | W3a |
| 预估工期 | ~1 天 |
| 前置依赖 | W2 绑定模型完成 |
| 产出物 | ProductWorld3D.vue、Three.js 场景基础、OrbitControls、选中联动、资源生命周期 |
| 里程碑 | M2 — 避障小车底盘在 3D 中渲染 → 轨道控制旋转观察 → 选中 3D 零件与电路视窗联动 |
| 关联总纲 | [00-master-plan.md](./00-master-plan.md) §3 性能预算 |

---

## 1. 目标

1. 将 Three.js 集成到 Vite 构建系统，动态 `import()` 延迟加载
2. 实现 `ProductWorld3D.vue` 基础场景（灯光 / 相机 / 地面 / 网格）
3. 从 `mechanical.parts` 渲染内置几何体（Box / Cylinder / Sphere）
4. 实现 OrbitControls 相机控制 + 视角预设
5. 实现 3D 对象选取（click pick）→ 双视窗选中联动
6. 建立 Three.js 资源生命周期管理协议

**不在本阶段范围**：Rapier 物理引擎、执行器驱动、传感器射线、爆炸图 UI 与动画（见 §11 扩展点）。

### 1.1 架构原则：复杂度沉淀到框架

W3a 采用 **Manifest 数据驱动 + 框架层渲染** 模式：业务层（模板 patch / Inspector）只声明「有哪些零件、相对谁、在哪」；框架层负责 Three.js 场景树构建、模型解析、坐标叠加与资源生命周期。

| 层 | 职责 | W3a 模块 |
|----|------|----------|
| **数据** | `mechanical.parts[]` 扁平列表 + `parentPartId` 表达装配树 | Manifest V2（W2 SSOT） |
| **解析** | `modelId` → 几何体 / 材质参数 | `ModelResolver`（原 `MODEL_LIBRARY`） |
| **构建** | 扁平 parts → `Object3D` 层级树 | `ManifestSceneBuilder` |
| **控制** | 相机、选中、（未来）爆炸进度 | OrbitControls / Picking / `ExplodeController`（Phase 2） |

> **Schema 纪律**：不引入与 Manifest 平行的独立 JSON 树协议。递归子结构由 `parentPartId` 邻接表表达；爆炸偏移与静态 transform **分离存储**（静态在 Manifest，爆炸默认在 Model Catalog，见 §11）。

---

## 2. Three.js 集成策略

### 2.1 包体积控制

```typescript
// 动态导入，仅在 VITE_ENABLE_PRODUCT_WORLD=true 时加载
const loadThreeJS = () => import('three');
const loadOrbitControls = () => import('three/addons/controls/OrbitControls.js');

// Vite 配置：Three.js 单独 chunk
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

**预期体积**：

| 包 | gzip 大小 | 加载时机 |
|----|-----------|----------|
| `three` (core) | ~140KB | 首次进入 3D 视窗 |
| `OrbitControls` | ~5KB | 同上 |
| Rapier (W3b) | ~450KB | W3b 阶段引入 |

### 2.2 加载状态 UI

```text
Three.js 加载中：
┌─────────────────────────────────┐
│                                 │
│      ⏳ 正在加载 3D 引擎...      │
│      ████████░░░░ 65%           │
│                                 │
└─────────────────────────────────┘
```

加载失败时显示降级视图（2D 俯视简图 + 错误提示）。

---

## 3. 场景图结构

### 3.1 基础场景

```typescript
// components/world/scene-setup.ts

export function createBaseScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0f172a);  // 暗色背景，与 IDE 风格统一
  scene.fog = new THREE.FogExp2(0x0f172a, 0.015);
  
  // ─── 灯光 ───
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
  
  // ─── 地面 ───
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

### 3.2 场景节点组织

```text
Scene
├── Lights (ambient + directional + fill)
├── Ground (grid + plane)
├── ProductGroup          ← ManifestSceneBuilder 根挂载点
│   └── chassis_main      (Group — 根零件，无 parentPartId)
│       ├── _mesh         (Box — 底盘本体)
│       ├── wheel_left    (Group → Cylinder，parentPartId=chassis_main)
│       ├── wheel_right   (Group → Cylinder)
│       └── mount_ultrasonic (Group → Box)
├── EnvironmentGroup      ← environment.props 渲染到这里（W4）
│   └── (empty in W3a)
├── DebugGroup           ← 射线辅助等（W3c）
│   └── (empty in W3a)
└── SelectionHighlight   ← 选中对象描边
```

### 3.3 Manifest 驱动的场景构建器

W2 的 `mechanical.parts` 为**扁平数组** + 可选 `parentPartId`（见 [02-phase-w2-binding-model.md](./02-phase-w2-binding-model.md) §2.1）。框架层将其 materialize 为 Three.js 父子树——这与爆炸图平台「递归子结构 + 局部坐标叠加」的需求一致，且避免双份 Schema。

```typescript
// components/world/manifest-scene-builder.ts

export interface PartNodeUserData {
  partId: string;
  domain: 'mechanical';
  modelId: string;
  /** 装配态局部坐标快照（爆炸动画基准） */
  originalPosition: THREE.Vector3;
  originalRotation: THREE.Euler;
  originalScale: THREE.Vector3;
  /** Phase 2：来自 ModelDefinition.explodeDefaults，可被 part 级覆盖 */
  explodeConfig?: ExplodeConfig;
}

export interface ExplodeConfig {
  axis: THREE.Vector3;   // 归一化方向，父局部空间
  distance: number;      // 最大偏移（m）
}

export class ManifestSceneBuilder {
  private partNodes = new Map<string, THREE.Group>();

  build(parts: MechanicalPart[], productGroup: THREE.Group): void {
    this.partNodes.clear();
    productGroup.clear();

    // Pass 1：为每个 part 创建 Group + Mesh
    for (const part of parts) {
      const node = this.createPartNode(part);
      this.partNodes.set(part.partId, node);
    }

    // Pass 2：按 parentPartId 挂树；无 parent 挂 ProductGroup
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
      explodeConfig: resolveExplodeDefaults(part.modelId), // W3a: 可选，默认 undefined
    } satisfies PartNodeUserData;

    return group;
  }
}
```

**坐标叠加纪律**（与总纲 §13 一致）：

| 项 | 约定 |
|----|------|
| 世界系 | Three.js 右手系，Y 向上，单位 **m** |
| 零件 transform | 相对 **父零件 Group** 的局部 TRS |
| 根零件 | 无 `parentPartId` → 挂 `ProductGroup`，transform 相对产品原点 |
| 子零件运动 | W3b 关节驱动时只改子 Group 局部 transform；父节点爆炸/平移时子节点自动叠加 |

**增量更新**：`parentPartId` 变更视为 **reparent**——从旧父移除、挂到新父、重算 `originalPosition` 快照，而非全量 rebuild（见 §7.2）。

---

## 4. 内置模型库

### 4.1 W3a 阶段模型（纯几何体）

每个 `modelId` 对应一组几何体参数：

```typescript
// components/world/model-library.ts

export interface ModelDefinition {
  modelId: string;
  displayName: string;
  geometry: GeometrySpec;
  defaultMaterial: MaterialSpec;
  defaultTransform?: Partial<Transform3D>;
  /** Phase 2 爆炸图：Catalog 级默认扩散方向/距离 */
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
    displayName: '差速底盘',
    geometry: { type: 'box', width: 0.20, height: 0.04, depth: 0.15 },
    defaultMaterial: { color: 0x3B82F6, metalness: 0.3, roughness: 0.7 },
  },
  'drive_wheel_v1': {
    modelId: 'drive_wheel_v1',
    displayName: '驱动轮',
    geometry: { type: 'cylinder', radius: 0.03, height: 0.015 },
    defaultMaterial: { color: 0x1e293b, metalness: 0.1, roughness: 0.9 },
    explodeDefaults: { axis: { x: -1, y: 0, z: 0 }, distance: 0.08 }, // Phase 2 预留
  },
  'caster_wheel_v1': {
    modelId: 'caster_wheel_v1',
    displayName: '万向轮',
    geometry: { type: 'sphere', radius: 0.015 },
    defaultMaterial: { color: 0x64748b, metalness: 0.5, roughness: 0.5 },
  },
  'ultrasonic_mount_v1': {
    modelId: 'ultrasonic_mount_v1',
    displayName: '超声支架',
    geometry: { type: 'box', width: 0.04, height: 0.025, depth: 0.02 },
    defaultMaterial: { color: 0x22d3ee, metalness: 0.2, roughness: 0.6 },
  },
  'sensor_enclosure_v1': {
    modelId: 'sensor_enclosure_v1',
    displayName: '传感器舱',
    geometry: { type: 'box', width: 0.06, height: 0.06, depth: 0.06 },
    defaultMaterial: { color: 0xf59e0b, metalness: 0.2, roughness: 0.7 },
  },
  'env_wall_segment': {
    modelId: 'env_wall_segment',
    displayName: '墙壁',
    geometry: { type: 'box', width: 2.0, height: 0.3, depth: 0.05 },
    defaultMaterial: { color: 0x475569, metalness: 0.1, roughness: 0.9 },
  },
  'env_heat_source': {
    modelId: 'env_heat_source',
    displayName: '火源',
    geometry: { type: 'sphere', radius: 0.05 },
    defaultMaterial: { color: 0xef4444, emissive: 0xff4400, emissiveIntensity: 2.0 },
  },
};
```

### 4.2 模型渲染流程

W3a **不再**将 Mesh 直接挂到 `ProductGroup`；统一经 `ManifestSceneBuilder` 产出 **Group（零件节点）+ Mesh（视觉体）** 结构。Picking 与高亮目标为 **Group**（`userData.partId`），Mesh 仅负责几何。

```typescript
function createMeshFromModel(modelId: string): THREE.Mesh {
  const modelDef = MODEL_LIBRARY[modelId];
  if (!modelDef) {
    console.warn(`Unknown model: ${modelId}, using fallback box`);
    // fallback: 0.05m 灰色立方体
  }
  const geometry = createGeometry(modelDef?.geometry ?? FALLBACK_BOX);
  const material = new THREE.MeshStandardMaterial(modelDef?.defaultMaterial ?? FALLBACK_MAT);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  return mesh;
}
```

### 4.3 资产策略：参数化装配 vs 外部 glTF

| 维度 | W3a–MVP（**参数化装配**） | Phase 2（**glTF 外模**） |
|------|---------------------------|---------------------------|
| 来源 | `MODEL_LIBRARY` 内置几何体 + `compound` 组合 | 美术 glTF/FBX URL 或打包资产 |
| 解析重心 | **坐标系组装**、`parentPartId` 树、碰撞体与 binding 语义 | **资产加载** + 可选 mesh 子树映射 |
| 适用场景 | 教育模板、AI 生成项目、快速迭代 | 高保真产品外观、复杂曲面 |
| 绑定关联 | `partId` ↔ `bindings`（语义 SSOT） | 同上；不依赖 glTF 内部节点名 |
| W3a 实现 | ✅ | 仅接口 stub |

**结论**：Wink 业务以 **Manifest 驱动的程序化装配** 为主路径；glTF 是视觉增强层，不改变 Manifest 树结构。若未来导入完整 glTF，也应在加载后**挂到已有 part Group** 下，而非让 Manifest 迁就模型内部层级。

### 4.4 glTF 扩展点（Phase 2）

```typescript
// ModelResolver 扩展：W3a 不实现
export async function loadGLTFModel(url: string): Promise<THREE.Group> {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}
```

---

## 5. 相机与控制

### 5.1 OrbitControls 配置

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
  controls.maxPolarAngle = Math.PI * 0.85; // 不让相机穿过地面
  controls.target.set(0, 0.05, 0);  // 默认看向底盘中心偏上
  
  return { camera, controls };
}
```

### 5.2 视角预设

| 快捷键 / 按钮 | 视角 | Camera Position | LookAt |
|---------------|------|-----------------|--------|
| `Numpad 7` / 俯视按钮 | 俯视 | (0, 1, 0) | (0,0,0) |
| `Numpad 1` / 正视按钮 | 正面 | (0, 0.2, 0.8) | (0,0.05,0) |
| `Numpad 3` / 侧视按钮 | 右侧 | (0.8, 0.2, 0) | (0,0.05,0) |
| `F` | 聚焦选中 | 自动计算 | 选中对象中心 |
| `Home` | 重置默认 | (0.3, 0.4, 0.5) | (0,0.05,0) |

视角切换使用 `300ms ease-out` 动画（Tween camera position + target）。

---

## 6. 选中与联动

### 6.1 Raycaster 点击拾取

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
      // 从命中 Mesh 向上找到带 partId 的 Group 祖先
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

### 6.2 选中高亮效果

```typescript
// 选中描边效果（使用 outline pass 或简单的缩放 wireframe）
function highlightPartNode(node: THREE.Group, state: 'selected' | 'binding-group' | 'none') {
  const mesh = node.getObjectByName('_mesh') as THREE.Mesh | undefined;
  if (!mesh) return;
  // 移除旧高亮
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

### 6.3 双视窗联动

```typescript
// 在 selection.store.ts 中监听选中变化
watch(() => selectionStore.current, (sel) => {
  if (!sel) {
    // 清除所有高亮
    clearAllHighlights();
    return;
  }
  
  if (sel.sourceViewport === 'circuit') {
    // 从电路视窗选中 → 在 3D 中找到对应绑定的机械件并高亮
    const bindings = findBindingsByDevice(sel.componentId);
    bindings.forEach(b => {
      const node = findPartNodeByPartId(b.mechanicalPartId);
      if (node) highlightPartNode(node, 'binding-group');
    });
  }
  
  if (sel.sourceViewport === 'world') {
    // 从 3D 选中 → 在电路视窗中高亮对应 device
    const bindings = findBindingsByPart(sel.componentId);
    bindings.forEach(b => {
      circuitCanvasRef.value?.highlightDevice(b.deviceComponentId);
    });
  }
});
```

---

## 7. 资源生命周期管理

### 7.1 Dispose 协议

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
  // 释放纹理（如果有）
  for (const key of Object.keys(material)) {
    const value = (material as any)[key];
    if (value instanceof THREE.Texture) {
      value.dispose();
    }
  }
}
```

### 7.2 Manifest 变更时的增量更新

```typescript
// 监听 mechanical.parts 变化
watch(() => projectStore.manifest.mechanical?.parts, (newParts, oldParts) => {
  const diff = computePartsDiff(oldParts ?? [], newParts ?? []);
  
  // 删除移除的零件（并 dispose）
  for (const removed of diff.removed) {
    const node = partNodeRegistry.get(removed.partId);
    if (node) {
      disposeSceneResources(node);
      node.removeFromParent();
      partNodeRegistry.delete(removed.partId);
    }
  }
  
  // 添加新零件（经 SceneBuilder 单节点创建 + 挂树）
  for (const added of diff.added) {
    sceneBuilder.addPart(added);
  }
  
  // transform 变更
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

## 8. WebGL 降级策略

| 检测 | 降级方案 |
|------|----------|
| `WebGLRenderingContext` 不存在 | 显示 2D 俯视简图（SVG 矩形表示零件） |
| `WebGL2` 不支持但 `WebGL1` 可用 | 降低阴影质量 + 禁用 fog |
| GPU 驱动黑名单 | 同 WebGL1 降级 |
| 渲染帧率持续 < 20fps | Toast 提示 + 建议关闭阴影 |

```typescript
function detectWebGLCapabilities(): 'webgl2' | 'webgl1' | 'none' {
  const canvas = document.createElement('canvas');
  if (canvas.getContext('webgl2')) return 'webgl2';
  if (canvas.getContext('webgl')) return 'webgl1';
  return 'none';
}
```

---

## 9. 渲染循环（W3a 简化版）

```typescript
// W3a: 无物理，仅渲染 + 控制
function startRenderLoop() {
  const clock = new THREE.Clock();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    controls.update();  // OrbitControls damping
    
    // 可见性检查：标签页不可见时跳过渲染
    if (document.hidden) return;
    
    renderer.render(scene, camera);
  }
  
  animate();
}
```

W3b 阶段会在此循环中加入 Rapier 物理步进和 EnvState.tick()。

---

## 10. 爆炸图扩展点（Phase 2，W3a 仅预留）

设计模式与通用爆炸图平台一致：**静态 transform 与爆炸偏移解耦**，通过 `setExplodeProgress(0..1)` 在装配态与分解态间插值。W3a 在 `PartNodeUserData` 写入 `originalPosition` 快照并可选挂载 `explodeConfig`；UI 滑块与动画循环推迟至 Phase 2（总纲 §12）。

### 10.1 爆炸算法（父局部空间）

Three.js 父子嵌套保证：父 Group 爆炸位移时，子节点自动叠加；子节点只需在**自身局部空间**追加偏移。

```typescript
// components/world/explode-controller.ts — Phase 2 实现

export class ExplodeController {
  setExplodeProgress(root: THREE.Object3D, progress: number): void {
    root.traverse((node) => {
      const ud = node.userData as PartNodeUserData;
      if (!ud?.originalPosition || !ud.explodeConfig) return;

      const { axis, distance } = ud.explodeConfig;
      const offset = axis.clone().normalize().multiplyScalar(distance * progress);

      node.position.copy(ud.originalPosition).add(offset);
      // rotation/scale 保持装配态；Phase 2 可按需扩展
    });
  }
}
```

### 10.2 配置来源（不新增 Manifest 字段）

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | `ModelDefinition.explodeDefaults` | Catalog 级，如驱动轮默认向 -X 扩散 8cm |
| 2 | `mechanical.parts[].explodeOverride?` | **Phase 2 可选** Manifest 字段；W6 schema 回写时追加 |
| 3 | 根节点 | `distance: 0`，不参与扩散 |

> W3a 验收不要求爆炸 UI；仅要求 `originalPosition` 在 reparent / transform 编辑后正确刷新。

---

## 11. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | Three.js 动态加载成功，首屏不包含 3D 代码 | 构建产物分析 |
| A2 | 避障小车底盘 + 轮子 + 超声支架在 3D 中正确渲染 | 视觉 |
| A2b | 子零件（轮子）transform 相对底盘局部坐标正确（`parentPartId` 树） | 移动底盘时轮子跟随；Inspector 改轮子局部 offset 生效 |
| A3 | OrbitControls 旋转/缩放/平移流畅 | 手动 |
| A4 | 视角预设按钮 / 快捷键正常切换 | 手动 |
| A5 | 点击 3D 零件 → 右栏切至 Mechanical Tab → 电路视窗联动高亮 | 手动 |
| A6 | 点击电路外设 → 3D 中关联零件高亮（通过 binding） | 手动 |
| A7 | 组件卸载后 GPU 资源正确释放 | Chrome DevTools Memory |
| A8 | Manifest 添加/删除/`parentPartId` 变更 → 3D 增量更新（非全量重建） | 手动 |
| A8b | `partNodeRegistry` 键为 `partId`（Group），非 Mesh | 代码审查 |
| A9 | WebGL 不可用时显示降级视图 | 模拟（canvas.getContext 返回 null） |
| A10 | 标签页不可见时停止渲染 | Chrome Performance |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-10：评审扩展——§1.1 框架分层；§3.3 `ManifestSceneBuilder` + `parentPartId` 装配树；§4.3 资产策略；§10 爆炸图 Phase 2 扩展点；验收 A2b/A8b。
