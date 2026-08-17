# W4 环境交互 — 火源温场 + 环境道具 + 模板

| 项 | 内容 |
|----|------|
| 阶段 | W4 |
| 预估工期 | ~1.5 天 |
| 前置依赖 | W3c 传感器桥接完成 |
| 产出物 | 火源道具、温场模型、环境道具运行时编辑、EnvironmentInspector、tpl_temp_alarm |
| 里程碑 | M5 — 拖拽火源靠近传感器 → DHT 温度升高 → App 报警 → LED 亮 |
| 关联上游 | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8.3、[00-master-plan.md](./00-master-plan.md) §10 |

---

## 1.1 阻塞：DHT ideal 温度注入 Wasm（W4 Spike）

Phase C **无** DHT 温度桥接。W4 编码前须完成 spike 并择一路径写入下表：

| 方案 | 做法 | 优点 | 缺点 |
|------|------|------|------|
| **A（推荐）** | 扩展 Worker：`dhtIdealTempC: Map<componentId, number>` + SimWorker 注入 PAL / DAL stub | 与超声 Map 模式一致 | 需 Wasm 侧读点 |
| **B** | 新增 `js_sim_set_dht_temperature_c(componentKey, tempC)` import | 语义清晰 | 需改 emscripten 胶水 |
| **C** | 暂用 ADC 电压模拟温度（过渡） | 零 Wasm 改动 | 误导用户，仅 demo |

**W4 数据流（方案 A）**：

```text
EnvStateManager.computeTemperature(binding)
  → setIdealInputs({ sensors: [{ bindingId: 'bind_dht_temp', value: 52.3, unit: 'celsius' }] })
  → Worker: dhtIdealTempC.set(deviceComponentId, value)
  → SimWorker / PAL: 退化（noise, warmup）→ DAL dht_read()
```

**验收**：拖拽火源前后，Wasm 内 App 读到的温度变化（日志或 OLED/trace 可观测）。

---

## 1. 目标

1. 实现火源道具 3D 渲染（发光体 + 粒子效果）+ Transform Gizmo 拖拽
2. 实现温场距离衰减计算模型，支持多热源叠加
3. 实现温度传感器绑定 `temperature_field_sample`
4. 环境道具在 simulate 模式下**可拖拽编辑**（运行时调场景）
5. 构建 EnvironmentInspector 面板
6. 完成温感报警模板 `tpl_temp_alarm` 端到端闭环

---

## 2. 火源道具

### 2.1 3D 渲染

```typescript
// components/world/env-objects/HeatSource.ts

export function createHeatSourceMesh(prop: EnvironmentProp): THREE.Group {
  const group = new THREE.Group();
  group.name = prop.propId;
  group.userData = { propId: prop.propId, domain: 'environment' };
  
  // 核心发光球
  const coreGeometry = new THREE.SphereGeometry(0.05, 16, 16);
  const coreMaterial = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xff4400,
    emissiveIntensity: 2.0,
    transparent: true,
    opacity: 0.9,
  });
  const core = new THREE.Mesh(coreGeometry, coreMaterial);
  group.add(core);
  
  // 外发光圈（表示温场范围）
  const radius = prop.properties?.falloffRadiusM ?? 1.5;
  const fieldGeometry = new THREE.RingGeometry(0, radius, 64);
  const fieldMaterial = new THREE.MeshBasicMaterial({
    color: 0xff4400,
    transparent: true,
    opacity: 0.08,
    side: THREE.DoubleSide,
  });
  const field = new THREE.Mesh(fieldGeometry, fieldMaterial);
  field.rotation.x = -Math.PI / 2;
  field.name = '_field_ring';
  group.add(field);
  
  // 点光源（视觉效果）
  const light = new THREE.PointLight(0xff4400, 1, radius * 2);
  light.name = '_point_light';
  group.add(light);
  
  // 应用 Transform
  const pos = prop.transform.position;
  group.position.set(pos.x, pos.y, pos.z);
  
  return group;
}
```

### 2.2 粒子效果（可选增强）

```typescript
// 简单粒子模拟热气上升（50 个粒子，低开销）
export function createHeatParticles(prop: EnvironmentProp): THREE.Points {
  const count = 50;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  
  for (let i = 0; i < count; i++) {
    // 在火源周围随机分布
    positions[i * 3] = (Math.random() - 0.5) * 0.1;
    positions[i * 3 + 1] = Math.random() * 0.3;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 0.1;
    // 向上漂浮
    velocities[i * 3 + 1] = 0.05 + Math.random() * 0.1;
  }
  
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  
  const material = new THREE.PointsMaterial({
    color: 0xff6600,
    size: 0.01,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
  });
  
  const points = new THREE.Points(geometry, material);
  points.name = '_particles';
  return points;
}

// 每帧更新粒子位置
export function updateHeatParticles(points: THREE.Points, dt: number) {
  const positions = points.geometry.attributes.position.array as Float32Array;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i + 1] += 0.05 * dt; // 上升
    if (positions[i + 1] > 0.5) {
      positions[i + 1] = 0; // 重置
    }
  }
  points.geometry.attributes.position.needsUpdate = true;
}
```

---

## 3. 温场模型

### 3.1 距离衰减计算

```typescript
// components/world/env-objects/TemperatureField.ts

export interface TemperatureResult {
  temperatureC: number;
  dominantSourceId: string | null;  // 最近的热源
  distanceM: number;                // 到最近热源的距离
}

export function sampleTemperature(
  sensorWorldPosition: THREE.Vector3,
  environment: EnvironmentSection,
): TemperatureResult {
  // 1. 获取 ambient 基线温度
  const ambientField = environment.fields.find(f => f.type === 'uniform_temperature');
  let temperature = ambientField?.valueC ?? 25;  // 默认 25°C（SSOT: valueC）
  let closestSource: string | null = null;
  let closestDistance = Infinity;
  
  // 2. 叠加所有点热源
  for (const prop of environment.props) {
    if (prop.modelId !== 'env_heat_source') continue;
    
    const coreTemp = (prop.properties?.coreTemperatureC as number) ?? 80;
    const falloffRadius = (prop.properties?.falloffRadiusM as number) ?? 1.5;
    
    const sourcePos = new THREE.Vector3(
      prop.transform.position.x,
      prop.transform.position.y,
      prop.transform.position.z
    );
    
    const distance = sensorWorldPosition.distanceTo(sourcePos);
    
    if (distance < closestDistance) {
      closestDistance = distance;
      closestSource = prop.propId;
    }
    
    if (distance < falloffRadius) {
      // 二次衰减：T = ambient + (core - ambient) * (1 - d/R)²
      const normalizedDist = distance / falloffRadius;
      const attenuation = Math.pow(1 - normalizedDist, 2);
      const contribution = (coreTemp - (ambientField?.valueC ?? 25)) * attenuation;
      temperature += contribution;
    }
  }
  
  return {
    temperatureC: Math.round(temperature * 10) / 10,  // 精度 0.1°C
    dominantSourceId: closestSource,
    distanceM: closestDistance,
  };
}
```

### 3.2 多热源叠加规则

| 场景 | 行为 |
|------|------|
| 单热源 | 直接二次衰减 |
| 多热源 | 各热源贡献**叠加**到 ambient 基线上 |
| 传感器在热源内 | `temperature = coreTemp`（距离 0） |
| 传感器超出所有热源范围 | `temperature = ambient` |
| 无 ambient field | 默认 25°C |

### 3.3 温场可视化

在 3D 中使用半透明同心圆表示温度等值线：

```typescript
function createTemperatureContours(prop: EnvironmentProp): THREE.Group {
  const group = new THREE.Group();
  const coreTemp = (prop.properties?.coreTemperatureC as number) ?? 80;
  const radius = (prop.properties?.falloffRadiusM as number) ?? 1.5;
  
  // 40°C, 50°C, 60°C 等值线
  const thresholds = [40, 50, 60];
  const ambient = 25;
  
  for (const threshold of thresholds) {
    const attenuation = (threshold - ambient) / (coreTemp - ambient);
    const contourRadius = radius * (1 - Math.sqrt(attenuation));
    
    const ring = new THREE.RingGeometry(contourRadius - 0.01, contourRadius + 0.01, 64);
    const material = new THREE.MeshBasicMaterial({
      color: temperatureToColor(threshold),
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(ring, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    group.add(mesh);
  }
  
  return group;
}

function temperatureToColor(tempC: number): number {
  // 25°C → 蓝(0x3B82F6), 50°C → 黄(0xEAB308), 80°C → 红(0xEF4444)
  const t = Math.max(0, Math.min(1, (tempC - 25) / 55));
  if (t < 0.5) {
    return lerpColor(0x3B82F6, 0xEAB308, t * 2);
  } else {
    return lerpColor(0xEAB308, 0xEF4444, (t - 0.5) * 2);
  }
}
```

---

## 4. 环境道具运行时编辑

### 4.1 仿真态拖拽

环境道具在 `simulate` 和 `diagnose` 模式下**仍可拖拽编辑**（上游规范 §5.3 编辑权限矩阵）。

```typescript
// components/world/GizmoController.ts

export class GizmoController {
  private gizmo: TransformControls;
  
  constructor(camera: THREE.Camera, renderer: THREE.Renderer) {
    // 使用 Three.js TransformControls
    const { TransformControls } = await import('three/addons/controls/TransformControls.js');
    this.gizmo = new TransformControls(camera, renderer.domElement);
    this.gizmo.setMode('translate');
    this.gizmo.setSpace('world');
  }
  
  attachTo(object: THREE.Object3D, mode: 'translate' | 'rotate' | 'scale') {
    this.gizmo.attach(object);
    this.gizmo.setMode(mode);
  }
  
  detach() {
    this.gizmo.detach();
  }
  
  // 拖拽时实时更新 Manifest
  onDragEnd(object: THREE.Object3D) {
    const propId = object.userData.propId;
    if (propId) {
      projectStore.updateEnvironmentPropTransform(propId, {
        position: {
          x: object.position.x,
          y: object.position.y,
          z: object.position.z,
        },
      });
    }
  }
}
```

### 4.2 数据流

```text
用户拖拽火源 Gizmo
  → Three.js object.position 实时更新
  → GizmoController.onDragEnd
  → projectStore.updateEnvironmentPropTransform(propId, newTransform)
  → Manifest.environment.props[i].transform 更新
  → EnvStateManager.tick() 下一帧使用新位置计算温度
  → 温感 ideal 值变化
  → Worker 收到新的 setIdealInputs
  → App 逻辑响应温度变化
```

---

## 5. EnvironmentInspector

### 5.1 面板结构

```text
┌─ Environment Inspector ─────────────────────────────────┐
│                                                          │
│ Selected: fire_01 (火源)                                 │
│                                                          │
│ Transform                                         [Reset]│
│   Position: X [1.20] Y [0.00] Z [0.50]                  │
│   Rotation: X [0]    Y [0]    Z [0]                      │
│                                                          │
│ Properties                                               │
│   Core Temperature: [80] °C          ◄────────► [slider] │
│   Falloff Radius:   [1.5] m         ◄────────► [slider] │
│                                                          │
│ Sensor Impact                                            │
│   bind_dht_temp: 52.3°C (distance: 0.8m)               │
│   ████████████████████░░░░  52.3/80°C                   │
│                                                          │
│ Fields                                                   │
│   ambient: uniform_temperature = 25°C           [Edit]   │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 5.2 属性编辑实时反馈

编辑火源的 `coreTemperatureC` 或 `falloffRadiusM` 时：
- 3D 中温场等值线**实时更新**（debounce 100ms）
- 传感器标签中的温度值实时变化
- 底栏 Trace 中记录参数变更事件

---

## 6. 温感报警模板

### 6.1 `tpl_temp_alarm` Manifest Patch

```typescript
export const TEMP_ALARM_TEMPLATE: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'env_sensor', modelId: 'dht22_stub' },
    { componentId: 'alarm_led', modelId: 'led' },
    { componentId: 'buzzer', modelId: 'buzzer_stub' },
  ],
  connections: [ /* ... */ ],
  mechanical: {
    parts: [
      { partId: 'sensor_box', modelId: 'sensor_enclosure_v1',
        transform: { position: { x: 0, y: 0.03, z: 0 } },
        physics: { massKg: 0.1, collider: 'box', static: true } },
      { partId: 'led_window', modelId: 'sensor_enclosure_v1',
        transform: { position: { x: 0.03, y: 0.06, z: 0 } },
        physics: { collider: 'none' } },
    ],
    joints: [],
  },
  environment: {
    props: [
      { propId: 'fire_01', modelId: 'env_heat_source',
        transform: { position: { x: 1.2, y: 0, z: 0.5 } },
        properties: { coreTemperatureC: 80, falloffRadiusM: 1.5 } },
    ],
    fields: [
      { fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 },
    ],
  },
  bindings: {
    actuators: [
      { bindingId: 'bind_led', deviceComponentId: 'alarm_led', pin: 'GPIO_LED',
        mechanicalPartId: 'led_window',
        mapping: { type: 'gpio_to_emissive', activeHigh: true, emissiveColor: 0xff0000 } },
      { bindingId: 'bind_buzzer', deviceComponentId: 'buzzer', pin: 'GPIO_BUZZER',
        mapping: { type: 'gpio_to_binary_state', activeHigh: true } },
    ],
    sensors: [
      { bindingId: 'bind_dht_temp', deviceComponentId: 'env_sensor',
        mechanicalPartId: 'sensor_box',
        environmentPropId: 'fire_01',
        mapping: { type: 'temperature_field_sample', fallbackAmbientFieldId: 'ambient' } },
    ],
    displays: [],
  },
};
```

> LED 绑定使用 `gpio_to_emissive` + `mechanicalPartId`（见 W2 B-07），**禁止**空 `mechanicalJointId`。

### 6.2 端到端因果链

```text
[world]          fire_01 at position (0.6, 0, 0.3) — 距离 sensor_box 0.7m
  → [env]        sampleTemperature = 52.3°C (衰减计算)
  → [worker]     setIdealInputs({ bind_dht_temp: 52.3 })
  → [pal]        +noise → 52.1°C, warmup OK
  → [app]        if (temp > 50) { trigger_alarm(); set_led(HIGH); }
  → [worker]     actuatorOutput: GPIO_LED=HIGH, BUZZER=HIGH
  → [mirror]     LED 亮度 → 3D 中指示灯发光
  → [world]      led_window emissive 增强
```

---

## 7. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | 火源 3D 渲染正确（发光球 + 光晕 + 温场环） | 视觉 |
| A2 | Transform Gizmo 可拖拽火源位置 | 手动 |
| A3 | 拖拽火源接近传感器 → 温度值实时升高 | 手动 + 标签显示 |
| A4 | 拖拽火源远离 → 温度降至 ambient | 手动 |
| A5 | 多热源叠加计算正确 | Vitest |
| A6 | EnvironmentInspector 编辑温度/半径实时反映 | 手动 |
| A7 | 温感模板一键装配后端到端闭环（火源 → 报警 → LED） | 完整演示 |
| A8 | simulate 模式可拖拽环境道具 | 手动 |
| A9 | 温场等值线可视化随参数更新 | 视觉 |
| A10 | 环境道具位置变更持久化到 Manifest | 检查 JSON |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——§1.1 DHT Wasm spike、valueC 温场、tpl_temp_alarm 绑定修正。
