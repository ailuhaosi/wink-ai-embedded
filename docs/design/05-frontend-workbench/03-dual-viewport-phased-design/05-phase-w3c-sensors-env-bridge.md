# W3c 传感器 + 环境桥接 — Raycaster 测距与 EnvStateManager

| 项 | 内容 |
|----|------|
| 阶段 | W3c |
| 预估工期 | ~1.5 天 |
| 前置依赖 | W3b 物理引擎 + 执行器完成 |
| 产出物 | EnvStateManager、Raycaster 测距、距离滑块迁移、噪声可视化 |
| 里程碑 | M4 — 小车前进 → 遇墙 → 超声检测距离 → App 停止电机 → 小车停下 |
| 关联上游 | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §6–§7 |

---

## 1. 目标

1. 实现 `EnvStateManager`：每帧计算所有传感器绑定的 ideal 值
2. 实现 Raycaster 测距：从超声传感器挂载点发射射线，命中环境碰撞体返回距离
3. 将超声距离从手动滑块迁移到 3D 自动检测（保留 override 开关）
4. 通过 Worker `setIdealInputs` 将 ideal 值批量送入 Wasm
5. 实现传感器噪声可视化（ideal vs degraded 对比）
6. 完成避障小车模板端到端闭环

> `setIdealInputs` / `IdealInputBatch` 承载的是数据面分层（[ADR-0027](../../../decisions/unisim/0027-sim-observation-data-planes.md)）中的 ④ Ideal Inject（输入注入），与 3 种输出观测（①②③）并列而非合并；传感器理想值不并入 `ActuatorObservation`（③）。

---

## 1.1 Wasm 桥接迁移对照表（SSOT）

从 Phase C 现状迁移到 binding 驱动 ideal 输入。**W3c 实施必须按表执行，禁止跳过过渡期双栈。**

| 传感器/执行器 | Phase C 现状 API | W3c 目标 API | 迁移步骤 |
|---------------|------------------|--------------|----------|
| HC-SR04 距离 | `setUltrasonicDistance(trig, echo, cm)` → Worker `ultrasonicDistances` Map → `ultrasonicEchoUs` | `setIdealInputs({ sensors: [{ bindingId, value, unit:'cm' }] })` | ① EnvState 算距离 ② 并行写旧 API（1 周）③ `overrideIdealInputs` 时旧 API 优先 ④ 删除滑块 |
| 按键 GPIO | `setPinIdeal(pin, level)` | 保留；可并入 `idealBatch.virtualGpio` | 不阻塞 W3c |
| PWM 输出（读） | 无 | `actuatorOutput` 事件（W3b spike 定论） | W3b 已交付 |
| DHT 温度 | **不存在** | W4 实现；W3c 不阻塞 | 见 W4 §2 |

**Worker 内部映射**（`bindingId` → 物理 pin）：

```typescript
// services/binding-pin-resolver.ts — 接口定义见 W2 §2.5；本阶段实现 Worker 写入
function resolveUltrasonicPins(manifest, bindingId): { trig: number; echo: number } | null;
```

`setIdealInputs` 收到 `bind_radar_front: 32` 后，Worker 调用 `resolveUltrasonicPins()` 写入 `ultrasonicDistances`（键 = echo pin），直至 Wasm 侧有通用 ideal 传感器 setter。B-10 已在 W2 门禁保证 simulate 前引脚可解析。

---

## 1.2 碰撞体与射线统一策略（Rapier ↔ Three）

**问题**：W3b Rapier 碰撞体与 W3c Three.js `Raycaster` 若数据源分裂，会出现「撞墙但超声仍报 maxRange」。

**决策：Rapier 为碰撞 SSOT，Three 射线走 Rapier castRay**

| 层 | 职责 |
|----|------|
| Rapier | 所有环境/墙壁碰撞体；`PhysicsWorld.castRay(origin, dir, maxToi)` |
| Three.js | 仅渲染 mesh；mesh `userData.rapierColliderHandle` 关联 |
| Three Raycaster | **禁止**用于测距语义（仅 UI pick 选中保留） |

```typescript
// EnvStateManager.computeRaycastRange — 伪代码
const hit = physicsWorld.castRay(origin, direction, maxRangeM);
const distanceCm = hit ? hit.timeOfImpact * 100 : mapping.maxRangeCm;
```

自碰撞排除：射线过滤组忽略 `ProductGroup` 刚体，仅命中 `EnvironmentGroup` + ground。

---

## 2. EnvStateManager

### 2.1 职责

`EnvStateManager` 是 JS 环境域的核心计算引擎，处于 3D 物理世界与 Worker Wasm 之间：

```text
3D 物理世界 ──┐
              ├──► EnvStateManager.tick() ──► IdealInputBatch ──► Worker
环境场/道具 ──┘
```

### 2.2 类定义

```typescript
// components/world/EnvStateManager.ts

export interface IdealSensorValue {
  bindingId: string;
  value: number | boolean;
  unit: 'cm' | 'celsius' | 'percent' | 'bool' | 'lux';
  source: 'computed' | 'override';  // override = 用户手动输入
}

export class EnvStateManager {
  private sensorValues: Map<string, IdealSensorValue> = new Map();
  private overrides: Map<string, number | boolean> = new Map();
  private raycastCache: Map<string, { value: number; frameAge: number }> = new Map();
  
  constructor(
    private manifest: EmbeddedProjectManifest,
    private physics: PhysicsWorld,
    private scene: THREE.Scene,
  ) {}
  
  /**
   * 每帧调用，计算所有传感器 ideal 值
   * @param simTimeUs 当前仿真时间
   * @param frameCount 帧计数，用于射线降频
   */
  tick(simTimeUs: bigint, frameCount: number): IdealInputBatch {
    const sensors: IdealSensorValue[] = [];
    
    for (const binding of this.manifest.bindings?.sensors ?? []) {
      let value: IdealSensorValue;
      
      // 检查是否有手动覆盖
      if (this.overrides.has(binding.bindingId)) {
        value = {
          bindingId: binding.bindingId,
          value: this.overrides.get(binding.bindingId)!,
          unit: this.getUnitForMapping(binding.mapping),
          source: 'override',
        };
      } else {
        // 根据 mapping 类型计算
        value = this.computeSensorValue(binding, frameCount);
      }
      
      this.sensorValues.set(binding.bindingId, value);
      sensors.push(value);
    }
    
    return {
      simTimeUs,
      sensors: sensors.map(s => ({
        bindingId: s.bindingId,
        value: s.value,
        unit: s.unit,
      })),
    };
  }
  
  private computeSensorValue(binding: SensorBinding, frameCount: number): IdealSensorValue {
    switch (binding.mapping.type) {
      case 'raycast_range_cm':
        return this.computeRaycastRange(binding, frameCount);
      case 'temperature_field_sample':
        return this.computeTemperature(binding);
      case 'collision_contact_bool':
        return this.computeCollisionContact(binding);
      case 'light_intensity_sample':
        return this.computeLightIntensity(binding);
      default:
        return { bindingId: binding.bindingId, value: 0, unit: 'cm', source: 'computed' };
    }
  }
  
  // ─── Override 管理 ───
  
  setOverride(bindingId: string, value: number | boolean) {
    this.overrides.set(bindingId, value);
  }
  
  clearOverride(bindingId: string) {
    this.overrides.delete(bindingId);
  }
  
  clearAllOverrides() {
    this.overrides.clear();
  }
}
```

---

## 3. Raycaster 测距

### 3.1 射线计算

```typescript
// EnvStateManager 中的 raycast 实现

private computeRaycastRange(binding: SensorBinding, frameCount: number): IdealSensorValue {
  const mapping = binding.mapping as RaycastRangeCm;
  const cacheKey = binding.bindingId;
  
  // 降频优化：非活跃射线每 2 帧更新一次
  const cached = this.raycastCache.get(cacheKey);
  if (cached && cached.frameAge < 2) {
    cached.frameAge++;
    return { bindingId: binding.bindingId, value: cached.value, unit: 'cm', source: 'computed' };
  }
  
  // 获取传感器挂载点的世界坐标
  const mountPartId = binding.mechanicalPartId!;
  const mountBody = this.physics.getBody(mountPartId);
  if (!mountBody) {
    return { bindingId: binding.bindingId, value: mapping.maxRangeCm, unit: 'cm', source: 'computed' };
  }
  
  const mountPosition = mountBody.translation();
  const mountRotation = mountBody.rotation();
  
  // 计算射线起点和方向（世界坐标）
  const origin = new THREE.Vector3(
    mountPosition.x + mapping.rayOriginOffset.x,
    mountPosition.y + mapping.rayOriginOffset.y,
    mountPosition.z + mapping.rayOriginOffset.z,
  );
  
  // 将局部方向转换为世界方向
  const localDir = new THREE.Vector3(mapping.rayDirection.x, mapping.rayDirection.y, mapping.rayDirection.z);
  const quat = new THREE.Quaternion(mountRotation.x, mountRotation.y, mountRotation.z, mountRotation.w);
  const worldDir = localDir.clone().applyQuaternion(quat).normalize();
  
  // 发射射线 — SSOT：Rapier castRay（见 §1.2），非 Three Raycaster
  const hit = this.physics.castRay(origin, worldDir, mapping.maxRangeCm / 100);
  
  let distanceCm: number;
  if (hit) {
    distanceCm = Math.round(hit.timeOfImpact * 100);
  } else {
    distanceCm = mapping.maxRangeCm; // 无命中 = 最大距离
  }
  
  // 更新缓存
  this.raycastCache.set(cacheKey, { value: distanceCm, frameAge: 0 });
  
  return { bindingId: binding.bindingId, value: distanceCm, unit: 'cm', source: 'computed' };
}
```

### 3.2 射线可视化

```typescript
// 调试辅助：在 3D 场景中显示射线
function updateRayHelper(scene: THREE.Scene, origin: THREE.Vector3, 
                         direction: THREE.Vector3, distance: number, hit: boolean) {
  const helper = scene.getObjectByName('_ray_helper') as THREE.ArrowHelper;
  
  if (!helper) {
    const arrow = new THREE.ArrowHelper(direction, origin, distance / 100, 
      hit ? 0x22d3ee : 0x64748b, 0.02, 0.01);
    arrow.name = '_ray_helper';
    scene.add(arrow);
  } else {
    helper.position.copy(origin);
    helper.setDirection(direction);
    helper.setLength(distance / 100);
    helper.setColor(new THREE.Color(hit ? 0x22d3ee : 0x64748b));
  }
  
  // 命中点标记
  if (hit) {
    const hitPoint = origin.clone().add(direction.clone().multiplyScalar(distance / 100));
    updateHitMarker(scene, hitPoint);
  }
}
```

### 3.3 射线与碰撞体的交互

射线只与以下对象交互：
- `environment.props` 的碰撞体（墙壁、障碍物）
- 地面

不与产品自身零件交互（避免自碰撞）。

---

## 4. 距离滑块迁移

### 4.1 迁移策略

| 阶段 | 行为 |
|------|------|
| **W3c 前** | `VirtualUltrasonic.vue` 手动滑块 → `setUltrasonicDistance()` |
| **W3c 后** | 3D Raycaster 自动计算 → `EnvStateManager.tick()` → `setIdealInputs()` |
| **过渡期** | 两者共存，`overrideIdealInputs` 开关控制 |

### 4.2 Override 调试开关

```vue
<!-- 在右栏 Bindings Tab 中 -->
<template>
  <div v-for="sensor in sensorBindings" :key="sensor.bindingId" class="sensor-row">
    <span>{{ sensor.bindingId }}</span>
    <span class="value-display">
      <span class="ideal">{{ idealValue }}</span>
      <span v-if="isDegraded" class="degraded">→ {{ degradedValue }}</span>
    </span>
    
    <!-- Override 开关 -->
    <label class="override-toggle">
      <input type="checkbox" v-model="overrideEnabled" />
      手动覆盖
    </label>
    <input 
      v-if="overrideEnabled" 
      type="range" 
      :min="0" :max="maxRange" 
      v-model="overrideValue"
      @input="envStateManager.setOverride(sensor.bindingId, overrideValue)"
    />
  </div>
</template>
```

### 4.3 VirtualUltrasonic 组件更新

```typescript
// VirtualUltrasonic.vue 的变化
// 之前：手动滑块调节距离
// 之后：显示 EnvStateManager 计算的距离（只读），滑块仅在 override 模式下可用

// 组件从 props 接收距离值，不再主动调用 setUltrasonicDistance
interface UltrasonicDisplayProps {
  distance: number;           // 来自 EnvStateManager
  isOverrideMode: boolean;
  maxRangeCm: number;
}
```

---

## 5. 传感器噪声可视化

### 5.1 ideal vs degraded 对比

在 3D 视窗中，传感器读数气泡同时显示理想值和退化后的值：

```text
┌──────────────────────┐
│ 📡 超声波             │
│ ideal:  32.0 cm      │
│ degraded: 31.7 cm    │
│ noise: ±0.3 cm       │
├──────────────────────┤
│ ████████████░░░      │  ← 距离条（蓝色=ideal，橙色=degraded 范围）
└──────────────────────┘
```

### 5.2 实现方式

```typescript
// 3D 中使用 CSS2DRenderer 叠加 HTML 标签
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

function createSensorLabel(bindingId: string, idealValue: number): CSS2DObject {
  const div = document.createElement('div');
  div.className = 'sensor-label';
  div.innerHTML = `
    <div class="sensor-name">${bindingId}</div>
    <div class="sensor-value">
      <span class="ideal">${idealValue.toFixed(1)} cm</span>
    </div>
  `;
  
  const label = new CSS2DObject(div);
  label.name = `_label_${bindingId}`;
  return label;
}

// 每帧更新标签值
function updateSensorLabels(envState: EnvStateManager, degradedValues?: Map<string, number>) {
  for (const [bindingId, ideal] of envState.getSensorValues()) {
    const label = scene.getObjectByName(`_label_${bindingId}`);
    if (!label) continue;
    
    const div = (label as CSS2DObject).element;
    const degraded = degradedValues?.get(bindingId);
    
    div.querySelector('.ideal')!.textContent = `${ideal.value} ${ideal.unit}`;
    if (degraded !== undefined) {
      div.querySelector('.degraded')!.textContent = `→ ${degraded.toFixed(1)} ${ideal.unit}`;
    }
  }
}
```

### 5.3 因果链中的退化步骤

当因果链面板（W5）实现后，点击 `pal` 层步骤自动在右栏显示当前退化参数：

```text
[pal] +noise → 31.7cm, warmup OK
  ↳ 参数: bounce_us=2000, adc_noise_v=0.01, warmup_us=50000
  ↳ 当前状态: warmup 已完成, PRNG seed=42
```

---

## 6. 完整渲染循环（W3c 版本）

```typescript
function startSimulationLoop() {
  const clock = new THREE.Clock();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (document.hidden) return;
    
    const rawDt = clock.getDelta();
    
    if (isSimulationRunning.value) {
      // 1. 应用上一帧 Worker 返回的执行器输出
      if (pendingActuatorOutput) {
        actuatorMirror.applyOutputs(pendingActuatorOutput);
        pendingActuatorOutput = null;
      }
      
      // 2. 物理步进
      physicsStep(rawDt);
      physics.syncToThreeJS(meshRegistry);
      
      // 3. 计算环境 ideal 值
      const idealBatch = envStateManager.tick(simTimeUs, frameCount);
      
      // 4. 更新射线辅助可视化
      updateRayHelpers();
      
      // 5. 更新传感器标签
      updateSensorLabels(envStateManager);
      
      // 6. 发送 ideal 值给 Worker
      simulationClient.sendIdealInputs(idealBatch);
      
      frameCount++;
    }
    
    // 7. 渲染
    controls.update();
    renderer.render(scene, camera);
    css2dRenderer.render(scene, camera);
  }
  
  animate();
}
```

---

## 7. 避障小车模板端到端

### 7.1 `tpl_avoidance_car` Manifest Patch

```typescript
// components/world/templates/avoidance-car.ts

export const AVOIDANCE_CAR_TEMPLATE: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'motor_driver', modelId: 'motor_driver_stub' },
    { componentId: 'front_radar', modelId: 'hc-sr04' },
  ],
  connections: [ /* PWM/TRIG/ECHO 连线 */ ],
  mechanical: {
    parts: [
      { partId: 'chassis', modelId: 'diff_drive_chassis_v1', /* ... */ },
      { partId: 'wheel_left', modelId: 'drive_wheel_v1', parentPartId: 'chassis', /* ... */ },
      { partId: 'wheel_right', modelId: 'drive_wheel_v1', parentPartId: 'chassis', /* ... */ },
      { partId: 'mount_ultrasonic', modelId: 'ultrasonic_mount_v1', parentPartId: 'chassis', /* ... */ },
    ],
    joints: [
      { jointId: 'joint_wheel_left', type: 'revolute', parentPartId: 'chassis', childPartId: 'wheel_left', axis: {x:0,y:0,z:1} },
      { jointId: 'joint_wheel_right', type: 'revolute', parentPartId: 'chassis', childPartId: 'wheel_right', axis: {x:0,y:0,z:1} },
    ],
  },
  environment: {
    props: [
      { propId: 'wall_north', modelId: 'env_wall_segment', transform: { position: {x:0,y:0.15,z:1} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_south', modelId: 'env_wall_segment', transform: { position: {x:0,y:0.15,z:-1} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_east', modelId: 'env_wall_segment', transform: { position: {x:1,y:0.15,z:0}, rotation: {x:0,y:90,z:0} }, physics: { static: true, collider: 'box' } },
      { propId: 'wall_west', modelId: 'env_wall_segment', transform: { position: {x:-1,y:0.15,z:0}, rotation: {x:0,y:90,z:0} }, physics: { static: true, collider: 'box' } },
    ],
    fields: [
      { fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 },
    ],
  },
  bindings: {
    actuators: [
      { bindingId: 'bind_motor_left', deviceComponentId: 'motor_driver', pin: 'PWM_LEFT', mechanicalJointId: 'joint_wheel_left', mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false } },
      { bindingId: 'bind_motor_right', deviceComponentId: 'motor_driver', pin: 'PWM_RIGHT', mechanicalJointId: 'joint_wheel_right', mapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false } },
    ],
    sensors: [
      { bindingId: 'bind_radar_front', deviceComponentId: 'front_radar', mechanicalPartId: 'mount_ultrasonic', mapping: { type: 'raycast_range_cm', maxRangeCm: 400, rayOriginOffset: {x:0,y:0,z:0.02}, rayDirection: {x:1,y:0,z:0} } },
    ],
    displays: [],
  },
};
```

### 7.2 端到端因果链

```text
[world]      Raycast hit wall_north @ 32cm
  → [env]    ideal_distance_cm = 32
  → [worker] setIdealInputs({ bind_radar_front: 32 })
  → [pal]    +noise → 31.7cm, warmup OK
  → [app]    if (distance < 40) { stop_motors(); }
  → [worker] actuatorOutput: PWM_LEFT=0, PWM_RIGHT=0
  → [mirror] ActuatorMirror → joint_wheel_left velocity=0
  → [world]  wheel_angular_vel = 0, chassis stops
```

---

## 8. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | 超声射线从挂载点正确发射，方向随底盘旋转 | 视觉（射线辅助） |
| A2 | 射线命中墙壁返回正确距离（±1cm） | 日志对比 |
| A3 | 射线无命中返回 maxRangeCm | 手动移除墙壁 |
| A4 | EnvStateManager.tick() 每帧耗时 < 1ms | 性能监控 |
| A5 | ideal 距离通过 setIdealInputs 送入 Worker | 日志 |
| A6 | App 逻辑根据距离停止电机 → 3D 中小车停下 | 端到端演示 |
| A7 | Override 开关可切换手动/自动距离 | 手动 |
| A8 | VirtualUltrasonic 组件显示自动计算的距离（只读） | 视觉 |
| A9 | 传感器标签显示 ideal vs degraded 对比 | 视觉 |
| A10 | 避障小车模板一键装配后端到端闭环 | 完整演示 |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——§1.1 桥接迁移表、§1.2 Rapier 射线 SSOT、模板 ambient `valueC`。
- 2026-07-09：W2 评审回写——§1.1 引用 W2 §2.5 pin-resolver 接口归属。

