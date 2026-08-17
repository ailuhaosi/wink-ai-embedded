# W2 绑定模型 — Manifest V2 + 绑定校验 + 资产库

| 项 | 内容 |
|----|------|
| 阶段 | W2 |
| 预估工期 | ~2.5–3 天（含 B-09/10 + pin-resolver 单测） |
| 前置依赖 | W1 布局骨架完成 |
| 产出物 | Manifest V2 类型、绑定校验引擎（B-01~B-10）、`binding-pin-resolver` 接口、Device Catalog `worldCoupling` 元数据、BindingsInspector、LayeredAssetLibrary |
| 里程碑 | M1 — 配置超声 raycast 绑定 → 缺绑定时 simulate 阻塞 → 补全后放行 |
| 关联上游 | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8、[00-master-plan.md](./00-master-plan.md) §10 字段对齐表 |

---

## 0. 字段命名纪律

本文 TypeScript **必须使用**总纲 §10 正式字段名：

- `devices[].componentId`（非 `id`）
- `name`（非 `projectName`）
- `environment.fields[].valueC`（非 `intensity`）

`migrateManifest()` 可将历史草稿别名归一化，新写入代码禁止产生别名。

---

## 1. 目标

1. 定义 Manifest `schemaVersion: 2` 的 TypeScript 类型（`mechanical` / `environment` / `bindings`）
2. 实现绑定校验引擎（**B-01 ~ B-10**）驱动 design → simulate 门禁（含模式感知 + Catalog `worldCoupling`）
3. 定义 **`binding-pin-resolver` 接口**（W2 契约 + 单测；W3c 实现 Worker 写入）
4. 构建 BindingsInspector 面板：电路-机械-环境映射表 + 解析引脚只读展示 + 自动建议
5. 定义**映射类型注册表**，支持后续扩展
6. 左栏升级为 Accordion 分层资产库（搜索/标签可降至 P1）
7. Device Catalog 注册 stub 器件及 `simulation.worldCoupling` 元数据（支撑 B-06/B-09）

---

## 2. Manifest V2 类型定义

### 2.1 核心类型

```typescript
// types/manifest-v2.ts
// ConnectionRouting 从 W1 types/circuit-routing.ts import，不在此重复定义。
// LogicSection / SimulationSection 沿用 02-project-manifest-schema.md §7/§simulation 子集，W2 仅类型引用。

import type { ConnectionRouting } from '@/types/circuit-routing';

/** 与 02-project-manifest-schema.md §7 logic 子集对齐 */
export interface LogicSection {
  sourceType?: 'dsl' | 'c';
  dslPath?: string;
  generatedCPath?: string;
}

/** 与上游 §8.6 simulation 扩展对齐 */
export interface SimulationSection {
  worldStepHz?: number;
  physicsBackend?: 'rapier' | 'none';
  deterministicSeed?: number;
  overrideIdealInputs?: boolean;
  faultScenarios?: unknown[];
  workerLimits?: Record<string, unknown>;
}

export interface EmbeddedProjectManifest {
  schemaVersion: 1 | 2;
  id: string;                         // 对应 sim-project.json 中的 project UUID
  name: string;
  target: { boardId: string; targetArch?: string };
  devices: DeviceEntry[];
  connections: ConnectionEntry[];
  
  // V2 新增三节
  mechanical?: MechanicalSection;
  environment?: EnvironmentSection;
  bindings?: BindingsSection;
  
  logic?: LogicSection;
  simulation?: SimulationSection;
}

/** Pin 级功耗配置参数（对应 C 侧 wasm_pin_power_model_t，对齐 sim_specs_deep_assessment.md 缺口 4） */
export interface PinPowerModel {
  /** 有源驱动时电流 (uA) */
  activeCurrentUa: number;
  /** 静态漏电流 (uA) */
  leakageCurrentUa: number;
  /** 单次跳变消耗能量 (nJ) */
  transitionEnergyNj: number;
}

export interface DeviceEntry {
  componentId: string;                // SSOT：与 02-project-manifest-schema 一致
  modelId: string;
  displayName?: string;
  position?: { x: number; y: number };
  rotation?: number;
  properties?: Record<string, unknown> & {
    powerModel?: Record<string, PinPowerModel>; // pinName -> 功耗模型
  };
}

/** 持久化格式（对齐 02-project-manifest-schema.md §6） */
export interface ConnectionPinRef {
  componentId: string;
  pin: string;
}

export interface ConnectionEntry {
  id: string;
  /**
   * 画布运行时使用 "componentId:pinName" 字符串（W1 CircuitCanvas 契约）；
   * 写入 wink-project.json 时经 normalizeConnectionForPersist() 转为 ConnectionPinRef 对象。
   */
  from: string | ConnectionPinRef;
  to: string | ConnectionPinRef;
  color?: string;
  signalType?: string;
  routing: ConnectionRouting;
}

// ─── Mechanical ───────────────────────────────────────────────

export interface MechanicalSection {
  parts: MechanicalPart[];
  joints: MechanicalJoint[];
}

export interface MechanicalPart {
  partId: string;
  modelId: string;                  // 对应内置模型库 ID
  displayName: string;
  parentPartId?: string;            // 装配树父节点
  transform: Transform3D;
  physics: PhysicsProperties;
}

export interface MechanicalJoint {
  jointId: string;
  type: 'revolute' | 'prismatic' | 'fixed' | 'spherical';
  parentPartId: string;
  childPartId: string;
  axis: Vector3;
  limits?: { minRad: number | null; maxRad: number | null };
  motorMaxTorque?: number;
}

export interface Transform3D {
  position: Vector3;
  rotation?: Vector3;    // Euler angles (degrees)
  scale?: Vector3;       // 默认 {1,1,1}
}

export interface Vector3 { x: number; y: number; z: number; }

export interface PhysicsProperties {
  massKg?: number;       // 默认 0.1
  friction?: number;     // 默认 0.5
  restitution?: number;  // 默认 0.3
  collider: 'box' | 'cylinder' | 'sphere' | 'convex' | 'none';
  static?: boolean;      // 环境道具可以是静态的
}

// ─── Environment ──────────────────────────────────────────────

export interface EnvironmentSection {
  props: EnvironmentProp[];
  fields: EnvironmentField[];
}

export interface EnvironmentProp {
  propId: string;
  modelId: string;
  displayName?: string;
  transform: Transform3D;
  physics?: PhysicsProperties;
  properties?: Record<string, number | string | boolean>;
}

export interface EnvironmentField {
  fieldId: string;
  type: FieldType;
  valueC: number;              // 环境温度（°C）；SSOT 字段名
  region?: FieldRegion;
  falloff?: 'linear' | 'quadratic' | 'none';
  falloffRadiusM?: number;
}

export type FieldType = 
  | 'uniform_temperature'    // 全局环境温度
  | 'point_temperature'      // 点热源衰减场
  | 'uniform_light'          // 全局光照
  | 'directional_light'      // 方向光照
  | 'gravity';               // 重力方向/大小

export type FieldRegion = 
  | { type: 'global' }
  | { type: 'sphere'; center: Vector3; radius: number }
  | { type: 'cone'; apex: Vector3; direction: Vector3; halfAngleDeg: number; length: number };

// ─── Bindings ─────────────────────────────────────────────────

export interface BindingsSection {
  actuators: ActuatorBinding[];
  sensors: SensorBinding[];
  displays: DisplayBinding[];
}

export interface ActuatorBinding {
  bindingId: string;
  deviceComponentId: string;           // → devices[].componentId
  pin: string;
  mechanicalJointId?: string;          // 执行器：关节驱动（pwm_to_angular_velocity 等）
  mechanicalPartId?: string;           // 执行器：零件级（pwm_to_brightness / gpio_to_emissive 等）
  mapping: ActuatorMapping;
}

export interface SensorBinding {
  bindingId: string;
  deviceComponentId: string;           // → devices[].componentId
  mechanicalPartId?: string;           // → mechanical.parts[].partId
  environmentPropId?: string;          // → environment.props[].propId
  mapping: SensorMapping;
  // 注意：传感器无 binding.pin 字段；TRIG/ECHO 等物理引脚经 connections + binding-pin-resolver 解析（§2.5）
}

export interface DisplayBinding {
  bindingId: string;
  deviceComponentId: string;
  mechanicalPartId?: string;
  mapping: DisplayMapping;
}
```

### 2.2 映射类型注册表

```typescript
// types/mapping-registry.ts

// ─── 执行器映射 ───────────────────────────────────────────────

export type ActuatorMapping = 
  | PwmToAngularVelocity
  | PwmToLinearPosition
  | GpioToBinaryState
  | PwmToBrightness
  | GpioToEmissive;                    // LED/指示灯：绑 mechanicalPartId，非 joint

export interface GpioToEmissive {
  type: 'gpio_to_emissive';
  activeHigh: boolean;
  emissiveColor?: number;             // 0xRRGGBB
}

export interface PwmToAngularVelocity {
  type: 'pwm_to_angular_velocity';
  maxRpm: number;
  deadband: number;       // 0-1, 低于此占空比视为 0
  invert: boolean;
}

export interface PwmToLinearPosition {
  type: 'pwm_to_linear_position';
  minAngleDeg: number;    // 舵机最小角度
  maxAngleDeg: number;    // 舵机最大角度
  pulseMsRange: [number, number]; // [1.0, 2.0] 标准舵机
}

export interface GpioToBinaryState {
  type: 'gpio_to_binary_state';
  activeHigh: boolean;
  description?: string;   // 如 "继电器" / "电磁阀"
}

export interface PwmToBrightness {
  type: 'pwm_to_brightness';
  maxLumens: number;
  curve: 'linear' | 'gamma22'; // gamma 2.2 更符合人眼感知
}

// ─── 传感器映射 ───────────────────────────────────────────────

export type SensorMapping = 
  | RaycastRangeCm
  | TemperatureFieldSample
  | CollisionContactBool
  | LightIntensitySample
  | AngularPositionToEncoder;

export interface RaycastRangeCm {
  type: 'raycast_range_cm';
  maxRangeCm: number;
  rayOriginOffset: Vector3;
  rayDirection: Vector3;
  beamWidthDeg?: number;  // 可选：超声波扩散锥角度（简化）
}

export interface TemperatureFieldSample {
  type: 'temperature_field_sample';
  fallbackAmbientFieldId: string;
  samplingOffsetM?: Vector3; // 传感器相对零件的采样偏移
}

export interface CollisionContactBool {
  type: 'collision_contact_bool';
  contactGroupMask?: number;  // 碰撞组掩码
}

export interface LightIntensitySample {
  type: 'light_intensity_sample';
  sensitivityRange: [number, number]; // [minLux, maxLux]
  direction?: Vector3;    // 感光方向
}

export interface AngularPositionToEncoder {
  type: 'angular_position_to_encoder';
  pulsesPerRevolution: number;
  /** SSOT：关节引用仅在 mapping 内，binding.mechanicalPartId 对此类型无效 */
  jointId: string;
}

// ─── 显示映射 ─────────────────────────────────────────────────

export type DisplayMapping = 
  | FramebufferTexture;

export interface FramebufferTexture {
  type: 'framebuffer_texture';
  resolution?: { width: number; height: number };
}
```

### 2.3 Schema 迁移

```typescript
// services/manifest-migration.ts

export function migrateManifest(raw: unknown): EmbeddedProjectManifest {
  const obj = raw as Record<string, unknown>;
  
  // 版本检测
  const version = (obj.schemaVersion as number) ?? 1;
  
  if (version === 1) {
    return {
      ...obj,
      schemaVersion: 2,
      mechanical: { parts: [], joints: [] },
      environment: { props: [], fields: [] },
      bindings: { actuators: [], sensors: [], displays: [] },
    } as EmbeddedProjectManifest;
  }
  
  if (version === 2) {
    // 容错：缺失节视为空
    const merged = {
      ...obj,
      mechanical: obj.mechanical ?? { parts: [], joints: [] },
      environment: obj.environment ?? { props: [], fields: [] },
      bindings: obj.bindings ?? { actuators: [], sensors: [], displays: [] },
    } as EmbeddedProjectManifest;
    // 历史草稿别名：fields[].intensity → valueC
    for (const f of merged.environment?.fields ?? []) {
      const raw = f as EnvironmentField & { intensity?: number };
      if (raw.valueC === undefined && raw.intensity !== undefined) {
        raw.valueC = raw.intensity;
      }
    }
    return merged;
  }
  
  throw new Error(`Unknown manifest schemaVersion: ${version}. Please upgrade your Wink-AI.`);
}
```

> **`PinPowerModel`**：W2 仅在类型层预埋（对齐总纲 ABI 缺口 #4）；Inspector 编辑入口推迟至 W5 诊断面板。

### 2.4 Connection 格式归一化

画布（W1 `CircuitCanvas`）与持久化（`02-project-manifest-schema.md` §6）使用两种 `from`/`to` 表示。W2 提供归一化层，**禁止**在业务代码中手写双格式分支。

```typescript
// services/connection-normalize.ts

export function formatPinRef(ref: ConnectionPinRef): string {
  return `${ref.componentId}:${ref.pin}`;
}

export function parsePinRef(s: string): ConnectionPinRef {
  const idx = s.lastIndexOf(':');
  if (idx <= 0) throw new Error(`Invalid pin ref: ${s}`);
  return { componentId: s.slice(0, idx), pin: s.slice(idx + 1) };
}

/** 加载 wink-project.json → 画布可用的字符串格式 */
export function normalizeConnectionForCanvas(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? entry.from : formatPinRef(entry.from),
    to: typeof entry.to === 'string' ? entry.to : formatPinRef(entry.to),
  };
}

/** 保存画布状态 → schema §6 对象格式 */
export function normalizeConnectionForPersist(entry: ConnectionEntry): ConnectionEntry {
  return {
    ...entry,
    from: typeof entry.from === 'string' ? parsePinRef(entry.from) : entry.from,
    to: typeof entry.to === 'string' ? parsePinRef(entry.to) : entry.to,
  };
}
```

### 2.5 引脚解析契约（binding-pin-resolver）

**非对称设计**（避障闭环数据基础）：

| 绑定类型 | Manifest 中的引脚表达 | 物理 GPIO 来源 |
|----------|----------------------|----------------|
| `ActuatorBinding` | `pin: "PWM_LEFT"`（器件逻辑引脚名） | `connections` + Board Model → 板级 pin number |
| `SensorBinding` | **无 `pin` 字段** | `connections` 反查 TRIG/ECHO 等（Device Model `pins[]`） |

W2 定义接口与 Vitest；W3c 在 Worker `setIdealInputs` 路径实现写入（见 [05-phase-w3c-sensors-env-bridge.md](./05-phase-w3c-sensors-env-bridge.md) §1.1）。

```typescript
// services/binding-pin-resolver.ts

export interface ResolvedActuatorPin {
  deviceComponentId: string;
  logicalPin: string;       // binding.pin，如 "PWM_LEFT"
  boardPinNumber: number;   // 经 connections + board model 解析
}

export interface ResolvedUltrasonicPins {
  trigPin: number;
  echoPin: number;
}

export interface BindingPinResolver {
  resolveActuatorPin(
    manifest: EmbeddedProjectManifest,
    binding: ActuatorBinding,
  ): ResolvedActuatorPin | null;

  resolveUltrasonicPins(
    manifest: EmbeddedProjectManifest,
    bindingId: string,
  ): ResolvedUltrasonicPins | null;

  /** 通用传感器引脚解析；键为 Device Model pin name（如 TRIG、ECHO） */
  resolveSensorPins(
    manifest: EmbeddedProjectManifest,
    binding: SensorBinding,
  ): Record<string, number> | null;
}
```

**扭矩上限 SSOT**：`motorMaxTorque` 归属 `MechanicalJoint`（§2.1），**不在** `PwmToAngularVelocity` mapping 内。W3b `ActuatorMirror` 从 joint 读取（见 [04-phase-w3b-physics-actuators.md](./04-phase-w3b-physics-actuators.md) §5.1）。

---

## 3. 绑定校验引擎

### 3.1 规则定义

```typescript
// services/binding-validation.service.ts

export type Severity = 'error' | 'warning' | 'info';

export interface ValidationContext {
  /** 当前或目标工作模式；影响 B-04/B-09 严重级别 */
  targetMode: 'design' | 'simulate' | 'diagnose';
  /** simulate 切换时为 true：仅返回 blocking 结果 */
  blockingOnly?: boolean;
  featureFlags?: { manifestSchemaV2: boolean };
}

export interface ValidationResult {
  ruleId: string;
  severity: Severity;
  message: string;
  bindingId?: string;
  componentId?: string;   // B-09 等设备级结果
  fix?: string;
}

export function validateBindings(
  manifest: EmbeddedProjectManifest,
  context: ValidationContext,
  deps: {
    catalog: DeviceCatalog;
    pinResolver: BindingPinResolver;
  },
): ValidationResult[] { /* ... */ }

/** simulate 门禁：error 始终 blocking；design 下 warning 不阻塞切换 */
export function isBlockingResult(r: ValidationResult, context: ValidationContext): boolean {
  if (r.severity === 'error') return true;
  if (context.targetMode === 'simulate' && r.severity === 'warning') {
    return ['B-04', 'B-09'].includes(r.ruleId);
  }
  return false;
}
```

### 3.2 校验规则清单

| 规则 ID | 检查 | 严重级别 | 实现细节 |
|---------|------|----------|----------|
| **B-01** | `deviceComponentId` 必须存在于 `devices` | Error | 遍历 bindings，查找 devices 匹配 |
| **B-02** | `mechanicalJointId` / `mechanicalPartId` 必须存在于 `mechanical`（若该字段有值） | Error | actuators 至少填 jointId **或** partId 之一 |
| **B-03** | 同一 PWM 引脚不得绑定多个冲突执行器 | Error | 构建 pin→binding 索引，检查冲突 |
| **B-04** | 超声绑定缺少 `mechanicalPartId` | Warning(design) / Error(simulate) | 仿真门禁提升严重级别 |
| **B-05** | 火源温感绑定无 `environmentPropId` 时回退 `fields` ambient | Info | 自动 fallback + 提示 |
| **B-06** | 绑定引脚信号类型与 `mapping.type` 不匹配 | Error | 依赖 Device Catalog `pins[].type`；PWM↔pwm、GPIO↔gpio |
| **B-07** | 执行器 mapping 与目标引用类型匹配 | Error | 见下表（执行器） |
| **B-07s** | 传感器 mapping 与目标引用类型匹配 | Error | 见下表（传感器） |
| **B-08** | 存在 device 但无对应 binding（可选绑定覆盖率提示） | Info | 仅 `worldCoupling: 'optional'` 器件 |
| **B-09** | `worldCoupling: 'required'` 器件缺少 binding | Warning(design) / **Error(simulate)** | Catalog 驱动；hc-sr04、motor_driver_stub 等 |
| **B-10** | binding 存在但 `pinResolver` 无法解析所需引脚 | Warning(design) / **Error(simulate)** | 如超声缺 TRIG/ECHO 连线 |

**B-07 执行器（mapping → 必填引用）**：

| mapping.type | 必填字段 | 禁止 |
|--------------|----------|------|
| `pwm_to_angular_velocity` | `mechanicalJointId`（revolute） | 空 jointId |
| `pwm_to_linear_position` | `mechanicalJointId`（revolute/prismatic） | — |
| `gpio_to_binary_state` | `mechanicalJointId` 或 `mechanicalPartId` | 两者皆空 |
| `pwm_to_brightness` | `mechanicalPartId` | `mechanicalJointId` |
| `gpio_to_emissive` | `mechanicalPartId` | `mechanicalJointId` |

**B-07s 传感器（mapping → 必填引用）**：

| mapping.type | 必填字段 | 附加约束 |
|--------------|----------|----------|
| `raycast_range_cm` | `mechanicalPartId` | 同 B-04 |
| `temperature_field_sample` | `fallbackAmbientFieldId` 存在于 `environment.fields` | 无 `environmentPropId` 时 B-05 Info |
| `collision_contact_bool` | `mechanicalPartId` | — |
| `light_intensity_sample` | `mechanicalPartId` | — |
| `angular_position_to_encoder` | `mapping.jointId` ∈ `mechanical.joints` | **禁止**依赖 binding.`mechanicalPartId` |

### 3.3 门禁集成

`VITE_MANIFEST_SCHEMA_V2=false` 时：**跳过** bindings 校验（与忽略三节一致），仅保留 W1 静态检查。

```typescript
// workbench-mode.store.ts — switchTo('simulate')
async function canEnterSimulate(): Promise<boolean> {
  const staticOk = await staticCheckService.run();
  if (!staticOk) {
    useLayoutStore().activateBottomTab('static-check');
    return false;
  }

  if (!import.meta.env.VITE_MANIFEST_SCHEMA_V2) {
    return true;  // A10：不校验 bindings
  }

  const manifest = useProjectStore().manifest;
  const results = validateBindings(
    manifest,
    { targetMode: 'simulate', blockingOnly: true },
    { catalog: deviceCatalog, pinResolver: bindingPinResolver },
  );

  const blocking = results.filter(r => isBlockingResult(r, { targetMode: 'simulate' }));
  if (blocking.length > 0) {
    useLayoutStore().activateBottomTab('diagnostics');
    useInspectorStore().activateTab('diagnostics');
    return false;
  }
  return true;
}
```

> **顺序**：先 `static-check`，再 `binding-validation`（对齐总纲 §4.6）。`design` 模式下 `validateBindings` 仍运行但仅 surfacing warning/info，不阻塞编辑。

---

## 4. BindingsInspector 面板

### 4.1 UI 结构

```text
┌─ Bindings Inspector ──────────────────────────────────────┐
│                                                            │
│ Actuators (2)                                      [+ Add] │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 🔗 bind_motor_left                                   │   │
│ │   Device: motor_driver → Pin: PWM_LEFT               │   │
│ │   Joint: joint_wheel_left (revolute)                  │   │
│ │   Mapping: pwm_to_angular_velocity (200 RPM)         │   │
│ │   Status: ✅ OK                              [Edit][🗑] │   │
│ └──────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 🔗 bind_motor_right                          [...]    │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ Sensors (1)                                        [+ Add] │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ 📡 bind_radar_front                                  │   │
│ │   Device: front_radar → Part: mount_ultrasonic       │   │
│ │   Pins: TRIG→GPIO4, ECHO→GPIO5 (resolved, readonly)  │   │
│ │   Mapping: raycast_range_cm (max 400cm)              │   │
│ │   Status: ✅ OK                              [Edit][🗑] │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                            │
│ [💡 Auto-Suggest Bindings]                                 │
│                                                            │
│ Validation: 0 errors, 0 warnings                           │
└────────────────────────────────────────────────────────────┘
```

### 4.2 自动建议算法

当用户同时拥有 device 和 mechanical 零件时，提供绑定建议：

```typescript
function suggestBindings(manifest: EmbeddedProjectManifest): SuggestedBinding[] {
  const suggestions: SuggestedBinding[] = [];
  
  for (const device of manifest.devices) {
    // 电机类 device → 查找 revolute joint → 建议 pwm_to_angular_velocity
    if (isMotorDevice(device)) {
      const joints = manifest.mechanical?.joints.filter(j => j.type === 'revolute') ?? [];
      for (const joint of joints) {
        if (!hasExistingBinding(manifest, device.componentId, joint.jointId)) {
          suggestions.push({
            deviceComponentId: device.componentId,
            mechanicalJointId: joint.jointId,
            suggestedMapping: { type: 'pwm_to_angular_velocity', maxRpm: 200, deadband: 0.05, invert: false },
            confidence: 0.8,
          });
        }
      }
    }
    
    // 超声类 device → 查找传感器挂载点 → 建议 raycast_range_cm
    if (isUltrasonicDevice(device)) {
      const mounts = manifest.mechanical?.parts.filter(p => p.modelId.includes('ultrasonic')) ?? [];
      for (const mount of mounts) {
        suggestions.push({
          deviceComponentId: device.componentId,
          mechanicalPartId: mount.partId,
          suggestedMapping: { type: 'raycast_range_cm', maxRangeCm: 400, rayOriginOffset: {x:0,y:0,z:0.02}, rayDirection: {x:1,y:0,z:0} },
          confidence: 0.9,
        });
      }
    }
  }
  
  return suggestions;
}
```

### 4.3 AI Patch 预览

当 AI 建议修改 bindings 时：

- 在 BindingsInspector 中以**虚线边框 + 蓝色背景**显示建议条目
- 每条建议附带 `Accept` / `Reject` 按钮
- Accept 将建议写入 Manifest；Reject 关闭该建议

### 4.4 解析引脚只读展示

传感器 binding 行调用 `bindingPinResolver.resolveSensorPins()` / `resolveUltrasonicPins()`，展示「TRIG→GPIOx」等只读字段。解析失败时显示 ⚠ 并链至 Diagnostics（B-10）。

---

## 5. LayeredAssetLibrary

### 5.1 Accordion 分区

```vue
<!-- components/asset-library/LayeredAssetLibrary.vue -->
<template>
  <div class="asset-library">
    <AccordionSection title="Boards" icon="Cpu" :defaultOpen="true">
      <AssetItem v-for="b in boards" :key="b.id" :item="b" 
        :dragTarget="'circuit'" />
    </AccordionSection>
    
    <AccordionSection title="Peripherals" icon="Zap">
      <AssetItem v-for="p in peripherals" :key="p.id" :item="p" 
        :dragTarget="'circuit'" />
    </AccordionSection>
    
    <AccordionSection title="Mechanical" icon="Box" :disabled="!featureWorld">
      <AssetItem v-for="m in mechanicalParts" :key="m.id" :item="m" 
        :dragTarget="'world'" />
    </AccordionSection>
    
    <AccordionSection title="Environment" icon="Cloud" :disabled="!featureWorld">
      <AssetItem v-for="e in envProps" :key="e.id" :item="e" 
        :dragTarget="'world'" />
    </AccordionSection>
    
    <AccordionSection title="Templates" icon="Layout">
      <TemplateItem v-for="t in templates" :key="t.id" :template="t" />
    </AccordionSection>
    
    <AccordionSection title="Active" icon="Layers" :defaultOpen="true">
      <ActiveObjectTree :manifest="manifest" @select="onSelect" />
    </AccordionSection>
  </div>
</template>
```

### 5.2 搜索过滤

- 顶部搜索框支持跨分区搜索
- 输入时自动展开包含匹配项的分区
- 支持标签过滤（如 `motor`, `sensor`, `chassis`）

### 5.3 仿真态行为

- simulate/diagnose 模式下左栏**默认收起**
- 可手动展开查看 Active 对象树
- Boards / Peripherals / Mechanical 在仿真态标记为不可拖拽

---

## 5.4 Device Catalog 与 `worldCoupling`

W2 在 catalog 为 stub 及常用外设补充 `simulation.worldCoupling`（对齐 [01-device-model-registry.md](../../07-platform-governance/01-device-model-registry.md) §3 扩展）：

```json
{
  "id": "hc-sr04",
  "simulation": {
    "worldCoupling": "required",
    "allowedSensorMappings": ["raycast_range_cm"]
  }
}
```

| modelId | `worldCoupling` | 说明 |
|---------|-----------------|------|
| `hc-sr04` | `required` | 缺 sensor binding → B-09 simulate 阻塞 |
| `motor_driver_stub` | `required` | 缺 actuator binding → B-09 simulate 阻塞 |
| `dht22_stub` | `required` | W4 前可 Warning only |
| `led` | `optional` | 无 binding 时 B-08 Info |
| `esp32-devkit-v1` | `none` | 不参与 bindings 覆盖率 |

B-06 同时要求 catalog 提供 `pins[].type`（`pwm` / `gpio` / `digital_in` 等）。

## 5.5 模板前置设备清单

模板在 W3c/W4 **完整装配前**，须满足以下设备/模型可用性。未就绪的模板按钮在 UI 上 **disabled** 并提示缺失项。

| 模板 ID | 电路外设（Device Catalog） | 3D modelId（MODEL_LIBRARY） | 完整装配阶段 |
|---------|---------------------------|----------------------------|--------------|
| `tpl_avoidance_car` | `esp32-devkit`, `hc-sr04`, **`motor_driver_stub`**¹ | `diff_drive_chassis_v1`, `drive_wheel_v1`, `ultrasonic_mount_v1`, `env_wall_segment` | W3c |
| `tpl_temp_alarm` | `esp32-devkit`, **`dht22_stub`**¹, `led`, **`buzzer_stub`**¹ | `sensor_enclosure_v1`, `env_heat_source` | W4 |

¹ **Stub 设备**：W2 在 catalog 注册占位类型（无新 Wokwi 元件亦可），仅保证 Manifest + 绑定校验通过；Wasm 行为在 W3c/W4 spike 后接通。

**`motor_driver_stub`**：两路 PWM 输出占位，映射到 `bind_motor_left/right`，不要求真实 L298N 芯片仿真。

### 5.5.1 W2 最小模板 patch（M1 / Onboarding 解耦）

W1 Onboarding Step 2 可展示「避障小车」入口，但 **W2 仅交付最小 patch**（非 W3c 完整机械/环境）：

```typescript
// services/templates/avoidance-car-w2-minimal.ts — M1 验收用
export const AVOIDANCE_CAR_W2_MINIMAL: Partial<EmbeddedProjectManifest> = {
  devices: [
    { componentId: 'esp32', modelId: 'esp32-devkit-v1' },
    { componentId: 'front_radar', modelId: 'hc-sr04' },
  ],
  connections: [ /* TRIG/ECHO → GPIO，供 B-10 单测 */ ],
  mechanical: { parts: [], joints: [] },
  environment: { props: [], fields: [{ fieldId: 'ambient', type: 'uniform_temperature', valueC: 25 }] },
  bindings: { actuators: [], sensors: [], displays: [] },  // 故意为空：M1 验证 B-09 阻塞
};
```

- **M1 演示路径**：加载最小 patch → 拖入/补全 `mount_ultrasonic` + `bind_radar_front` → simulate 放行。
- **完整避障闭环**（含电机、围墙、差速）：仍由 W3c §7.1 `AVOIDANCE_CAR_TEMPLATE` 交付。

---

## 6. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | Manifest V2 类型定义完整，通过 TSC 编译 | `npm run build` |
| A2 | schemaVersion 1 → 2 迁移函数正确工作 | Vitest |
| A3 | B-01~B-10 校验规则全部通过单测 | Vitest |
| A4 | 配置超声 raycast 绑定后 Bindings 面板正确显示（含解析引脚） | 手动 |
| A5 | `hc-sr04` 无 binding 时 design→simulate 被 B-09 阻塞 | Vitest |
| A5b | 有 binding 但缺 TRIG/ECHO 连线时 B-10 阻塞 simulate | Vitest |
| A6 | 补全绑定且引脚可解析后门禁放行 | 手动 |
| A7 | 自动建议算法生成合理建议 | Vitest |
| A8 | 左栏 Accordion 折叠/展开正常 | 手动 |
| A9 | 搜索过滤跨分区工作（P1，可推迟） | 手动 |
| A10 | `VITE_MANIFEST_SCHEMA_V2=false` 时跳过 bindings 校验 | Vitest |
| A11 | `binding-pin-resolver` 接口单测覆盖超声/执行器 | Vitest |
| A12 | `normalizeConnectionForPersist/Canvas` 往返不丢 pin | Vitest |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——§0 字段纪律、componentId/valueC、B-07 扩展、gpio_to_emissive、模板前置清单、迁移 intensity→valueC。
- 2026-07-09：三次评审修补——B-09/10、B-07s、ValidationContext、pin-resolver 契约、Connection 归一化、motorMaxTorque SSOT、worldCoupling catalog、W2 最小模板、门禁串联 static-check。
