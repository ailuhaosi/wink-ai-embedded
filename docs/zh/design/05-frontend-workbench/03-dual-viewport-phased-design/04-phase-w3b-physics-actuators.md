# W3b 物理引擎 + 执行器 — Rapier 集成与 SimTime 同步

| 项 | 内容 |
|----|------|
| 阶段 | W3b |
| 预估工期 | ~1.5 天 |
| 前置依赖 | W3a 静态 3D 预览完成 |
| 产出物 | Rapier 集成、SimTime 同步协议、ActuatorMirror、Worker 协议扩展 |
| 里程碑 | M3 — PWM 输出 → 3D 中轮子按占空比转动 → 底盘移动 |
| 关联总纲 | [00-master-plan.md](./00-master-plan.md) §3 性能预算 |

---

## 1. 目标

1. 集成 Rapier 3D 物理引擎（WASM 版），支持刚体、碰撞、关节
2. 定义**精确的 SimTime 同步协议**，保证主线程物理与 Worker Wasm 时间一致
3. 实现 `ActuatorMirror`：将 Worker 的 GPIO/PWM 输出映射到 3D 关节驱动力
4. 扩展 Worker 通信协议：新增 `setIdealInputs` / `actuatorOutput`
5. 建立帧预算监控机制

> 本阶段落地的 `ActuatorObservation` 是数据面分层（[ADR-0027](../../../decisions/unisim/0027-sim-observation-data-planes.md)）中的 ③ 输出通道（执行器面板 / 未来 ActuatorMirror 的 SSOT）；「统一」指消费纪律收敛到 ③，不代表 `pinStates`（①）/ `oledFb`（②）被合并或删除。

**不在本阶段范围**：传感器射线（W3c）、环境温场（W4）。

> **阻塞门禁**：进入 Task 3.1 前必须完成 **Task 3.0b Wasm Bridge Spike**（见 §2.4）。

---

## 2. Rapier 集成

### 2.4 Task 3.0b — Wasm Bridge Spike（阻塞）

| 字段 | 内容 |
|------|------|
| 预估工时 | 4h |
| 优先级 | 🔴 P0（阻塞 W3b 编码） |
| 产出 | spike 结论文档段落 + 最小 PWM 读数路径 |

**Spike 结论（已在 PLAN-20260711-AVOID-P1 中实现并选定）：**
选定方案 **(A)** —— 扩展 `STATE_UPDATE` payload 带 `actuatorOutputs`（包含 `pwm` 键以收集 C-side 占空比）。
1. **PWM 读取方式**：Worker 采集 Wasm 导出的 `pal_wasm_get_pwm_duty_percent(channel)` 并写入 `STATE_UPDATE.payload.actuatorOutputs.pwm[channel]`。主线程在 `simulation-client.ts` 接收到此 payload 后通过 Mapper 模块映射成 `ActuatorObservation` 供 UI/物理引擎只读消费。
2. **引脚与时钟规则**：超声距离等物理输入采用 `SET_ULTRASONIC_DISTANCE`（后续迁至统一的 sensor 接口），虚拟时钟在 Phase 1 暂由 Worker 步进，确保高性能与隔离性。

**须验证的现状与目标**（对照 `wasm-simulation.worker.ts`）：

| 能力 | 现状（Phase C） | W3b 目标 | Spike 结论写入 |
|------|-----------------|----------|----------------|
| 超声距离 | `ultrasonicDistances` Map + `ultrasonicEchoUs(pin)` | W3c 迁到 `setIdealInputs` | 记录 pin 键规则 |
| GPIO 输入 | `pal_wasm_set_gpio_input` | 保持 | ✅ 已可用 |
| PWM 输出 | **无统一 export** | `actuatorOutput.pwm[pin]` | ✅ 选定方案 (A) 嵌入 `STATE_UPDATE.payload.actuatorOutputs` |
| 虚拟时钟 | Worker `STEP_US=1000n` 定时步进 | 与主线程 SimTime 对齐（§4.5） | 暂由 Worker 定时步进驱动 |
| 协议 | `INIT`/`START`/`STATE_UPDATE` 字符串 | `HANDSHAKE` v2 + 过渡期双栈 | 扩展 `STATE_UPDATE` 格式 |

¹ **PWM 读取备选**：(A) 扩展 `STATE_UPDATE` payload 带 `pwmDuty`；(B) 新增 Worker 事件 `actuatorOutput`；(C) 从 `pinStates` + 电机驱动 stub 推导。**Spike 必须择一并在 W3b 全文统一。**

**Spike 已通过**：W3b 全文统一使用方案 (A)。可以使用 `STATE_UPDATE.payload.actuatorOutputs.pwm` 读取 PWM 输出驱动 ActuatorMirror。

---

### 2.1 安装与加载

```typescript
// 使用 compat 版本避免 top-level await 问题
// package.json: "@dimforge/rapier3d-compat": "^0.14.0"

// components/world/physics-engine.ts
let RAPIER: typeof import('@dimforge/rapier3d-compat') | null = null;

export async function initPhysics(): Promise<PhysicsWorld> {
  if (!RAPIER) {
    RAPIER = await import('@dimforge/rapier3d-compat');
    await RAPIER.init();  // 初始化 WASM
  }
  
  const gravity = new RAPIER.Vector3(0, -9.81, 0);
  const world = new RAPIER.World(gravity);
  
  return new PhysicsWorld(world, RAPIER);
}
```

### 2.2 Vite 兼容配置

```typescript
// vite.config.ts 需要的配置
export default defineConfig({
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d-compat']  // 避免预捆绑 WASM
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'three-core': ['three'],
          'rapier-physics': ['@dimforge/rapier3d-compat'],
        }
      }
    }
  }
});
```

### 2.3 备选方案：纯运动学模式

如果 Rapier WASM 加载失败或体积不可接受，提供纯运动学 fallback：

```typescript
export class KinematicFallback implements IPhysicsEngine {
  step(dt: number) {
    // 无碰撞检测，仅积分位置
    for (const body of this.bodies) {
      body.position.addScaledVector(body.velocity, dt);
      body.rotation.z += body.angularVelocity * dt;
    }
  }
}
```

差异：无碰撞、无真实摩擦、小车可穿墙。仅作为降级，不作为正式方案。

---

## 3. PhysicsWorld 封装

### 3.1 类定义

```typescript
// components/world/physics-engine.ts

export class PhysicsWorld {
  private world: RAPIER.World;
  private bodyMap: Map<string, RAPIER.RigidBody> = new Map();
  private colliderMap: Map<string, RAPIER.Collider> = new Map();
  private jointMap: Map<string, RAPIER.ImpulseJoint> = new Map();
  
  constructor(world: RAPIER.World, private R: typeof RAPIER) {
    this.world = world;
  }
  
  // ─── 刚体管理 ───
  
  addDynamicBody(partId: string, position: Vector3, mass: number): RAPIER.RigidBody {
    const bodyDesc = this.R.RigidBodyDesc.dynamic()
      .setTranslation(position.x, position.y, position.z)
      .setAdditionalMass(mass);
    const body = this.world.createRigidBody(bodyDesc);
    this.bodyMap.set(partId, body);
    return body;
  }
  
  addStaticBody(propId: string, position: Vector3): RAPIER.RigidBody {
    const bodyDesc = this.R.RigidBodyDesc.fixed()
      .setTranslation(position.x, position.y, position.z);
    const body = this.world.createRigidBody(bodyDesc);
    this.bodyMap.set(propId, body);
    return body;
  }
  
  // ─── 碰撞体 ───
  
  addBoxCollider(bodyId: string, halfExtents: Vector3, friction: number): RAPIER.Collider {
    const body = this.bodyMap.get(bodyId)!;
    const colliderDesc = this.R.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      .setFriction(friction);
    const collider = this.world.createCollider(colliderDesc, body);
    this.colliderMap.set(bodyId, collider);
    return collider;
  }
  
  addCylinderCollider(bodyId: string, radius: number, halfHeight: number): RAPIER.Collider {
    const body = this.bodyMap.get(bodyId)!;
    const colliderDesc = this.R.ColliderDesc.cylinder(halfHeight, radius);
    return this.world.createCollider(colliderDesc, body);
  }
  
  // ─── 关节 ───
  
  addRevoluteJoint(jointId: string, parentId: string, childId: string, 
                   anchor: Vector3, axis: Vector3): RAPIER.ImpulseJoint {
    const parent = this.bodyMap.get(parentId)!;
    const child = this.bodyMap.get(childId)!;
    const params = this.R.JointData.revolute(
      new this.R.Vector3(anchor.x, anchor.y, anchor.z),
      new this.R.Vector3(0, 0, 0),  // child 局部锚点
      new this.R.Vector3(axis.x, axis.y, axis.z)
    );
    const joint = this.world.createImpulseJoint(params, parent, child, true);
    this.jointMap.set(jointId, joint);
    return joint;
  }
  
  // ─── 步进 ───
  
  step(dt: number) {
    this.world.timestep = dt;
    this.world.step();
  }
  
  // ─── 同步 Three.js ───
  
  syncToThreeJS(meshRegistry: Map<string, THREE.Mesh>) {
    for (const [partId, body] of this.bodyMap) {
      const mesh = meshRegistry.get(partId);
      if (!mesh) continue;
      const pos = body.translation();
      const rot = body.rotation();
      mesh.position.set(pos.x, pos.y, pos.z);
      mesh.quaternion.set(rot.x, rot.y, rot.z, rot.w);
    }
  }
  
  // ─── 清理 ───
  
  dispose() {
    this.world.free();
    this.bodyMap.clear();
    this.colliderMap.clear();
    this.jointMap.clear();
  }
}
```

### 3.2 Manifest → Physics 转换

```typescript
function buildPhysicsFromManifest(manifest: EmbeddedProjectManifest, physics: PhysicsWorld) {
  // 1. 创建机械件刚体
  for (const part of manifest.mechanical?.parts ?? []) {
    if (part.physics?.static) {
      physics.addStaticBody(part.partId, part.transform.position);
    } else {
      physics.addDynamicBody(part.partId, part.transform.position, part.physics?.massKg ?? 0.1);
    }
    
    // 碰撞体
    const model = MODEL_LIBRARY[part.modelId];
    if (model && part.physics?.collider !== 'none') {
      addColliderFromModel(physics, part.partId, model, part.physics);
    }
  }
  
  // 2. 创建关节
  for (const joint of manifest.mechanical?.joints ?? []) {
    if (joint.type === 'revolute') {
      physics.addRevoluteJoint(joint.jointId, joint.parentPartId, joint.childPartId,
        { x: 0, y: 0, z: 0 }, joint.axis);
    }
  }
  
  // 3. 创建环境静态碰撞体
  for (const prop of manifest.environment?.props ?? []) {
    physics.addStaticBody(prop.propId, prop.transform.position);
    // 碰撞体...
  }
}
```

---

## 4. SimTime 同步协议

### 4.1 时间主从模型

```text
┌─────────────────── Time Master: 主线程 ──────────────────────┐
│                                                               │
│  simTimeUs: bigint  ←── 每帧递增 dtUs                        │
│  ↓                                                            │
│  postMessage({ type: 'setIdealInputs',                       │
│                targetSimTimeUs: simTimeUs,                     │
│                inputs: IdealInputBatch })                      │
│                                                               │
└───────────────────────────┬───────────────────────────────────┘
                            │
                            ▼
┌─────────────────── Time Follower: Worker ─────────────────────┐
│                                                               │
│  收到 targetSimTimeUs                                        │
│  while (s_virtual_us < targetSimTimeUs) {                    │
│    pal_wasm_advance_virtual_clock(s_virtual_us + tickStepUs) │
│    run app_loop iteration                                     │
│  }                                                            │
│                                                               │
│  postMessage({ type: 'actuatorOutput',                       │
│                simTimeUs: s_virtual_us,                        │
│                gpio: {...}, pwm: {...} })                      │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 4.2 帧时序详细图

```text
Time ──────────────────────────────────────────────────────►

Frame N                          Frame N+1
├──────── 16ms ─────────────────┤──────── 16ms ──────────┤
│                                │                        │
│ Main:                          │ Main:                  │
│ ├─ render(N)                   │ ├─ applyActuators(N+1)│
│ ├─ physics.step(dt)            │ ├─ render(N+1)        │
│ ├─ envState.tick(N)            │ ├─ physics.step(dt)   │
│ └─ postMsg(idealInputs, N+1)  │ └─ postMsg(..., N+2)  │
│         │                      │         │              │
│         ▼                      │         ▼              │
│ Worker:                        │ Worker:                │
│ ├─ advance_clock(N+1)         │ ├─ advance_clock(N+2) │
│ ├─ app_loop()                  │ ├─ app_loop()         │
│ └─ postMsg(actuatorOutputs)    │ └─ postMsg(...)       │
│                   │            │                        │
│                   ▼            │                        │
│           actuatorBuffer[1]    │                        │
│                   (write)      │  actuatorBuffer[1]     │
│                                │        (read)          │
```

### 4.3 Worker 追赶超时保护

```typescript
// 主线程侧
const WORKER_TIMEOUT_FRAMES = 3;
let workerMissedFrames = 0;

function onWorkerResponse(event: MessageEvent) {
  workerMissedFrames = 0;
  // 正常处理 actuatorOutput...
}

function onAnimationFrame() {
  workerMissedFrames++;
  
  if (workerMissedFrames >= WORKER_TIMEOUT_FRAMES) {
    // Worker 追赶不上
    if (currentSimSpeed > 1) {
      currentSimSpeed = Math.max(1, currentSimSpeed / 2);
      showWarning('仿真速度已自动降低，Worker 计算负载过高');
    } else {
      showWarning('⚠ Worker 响应超时，仿真可能不准确');
    }
  }
}
```

### 4.4 Worker 追赶预算（硬约束）

主线程每帧推送给 Worker 的 `targetSimTimeUs` 增量不得无限追赶，避免 Worker 单帧内 `while` 循环阻塞 `postMessage`：

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `MAX_CATCHUP_US_PER_FRAME` | `5_000`（5ms 虚拟时间） | 主线程每帧最多要求 Worker 前进 5ms |
| `WORKER_TIMEOUT_FRAMES` | `3` | 连续未响应则降 SimSpeed |
| `STEP_US`（Worker 内部） | `1000n`（1ms） | 与现 Worker 一致；每 catch-up 帧最多循环 5 次 |

```typescript
// Worker 侧（伪代码）
function catchUpTo(targetUs: bigint) {
  const maxSteps = 5;
  let steps = 0;
  while (s_virtual_us < targetUs && steps < maxSteps) {
    advanceOneStep(STEP_US);
    steps++;
  }
  if (s_virtual_us < targetUs) {
    postMessage({ type: 'WORKER_LAG', behindUs: targetUs - s_virtual_us });
  }
}
```

**与 Asyncify**：`pal_delay_ms` 触发的 unwind 计入步数；单帧 catch-up 上限可防止 delay 链过长卡死 Worker。

### 4.5 与现有 Worker 定时器的关系

| 模式 | 行为 |
|------|------|
| **过渡期（推荐 W3b）** | 主线程 rAF 发送 `setIdealInputs` + `targetSimTimeUs`；Worker **暂停** `setInterval` 自驱，改被动 catch-up |
| Legacy | 保留 `setInterval` 路径，`VITE_WORKER_SELF_CLOCK=true` 可回退 |

W3c 全量切换后删除自驱定时器。

### 4.6 主线程 dt 钳制

```typescript
// 物理步进 dt 钳制，防止 tab 切回时一次步进过大
const MAX_DT = 1 / 30;  // 最大 33ms
const FIXED_PHYSICS_DT = 1 / 60;  // 固定 16.67ms 物理步

function physicsStep(rawDt: number) {
  const clampedDt = Math.min(rawDt, MAX_DT);
  
  // 固定步长 + 插值（semi-fixed timestep）
  physicsAccumulator += clampedDt;
  while (physicsAccumulator >= FIXED_PHYSICS_DT) {
    physics.step(FIXED_PHYSICS_DT);
    physicsAccumulator -= FIXED_PHYSICS_DT;
    simTimeUs += BigInt(Math.round(FIXED_PHYSICS_DT * 1_000_000));
  }
  
  // 插值因子用于渲染平滑（可选）
  const alpha = physicsAccumulator / FIXED_PHYSICS_DT;
  physics.syncToThreeJS(meshRegistry, alpha);
}
```

---

## 5. ActuatorMirror

### 5.1 职责

将 Worker 返回的 `ActuatorOutputBatch`（GPIO/PWM 原始值）映射为 3D 物理世界的驱动力：

```typescript
// components/world/ActuatorMirror.ts

export class ActuatorMirror {
  constructor(
    private manifest: EmbeddedProjectManifest,
    private physics: PhysicsWorld,
  ) {}
  
  applyOutputs(outputs: ActuatorOutputBatch) {
    const bindings = this.manifest.bindings?.actuators ?? [];
    
    for (const binding of bindings) {
      const pinKey = this.resolvePinNumber(binding.pin);
      
      switch (binding.mapping.type) {
        case 'pwm_to_angular_velocity': {
          const duty = outputs.pwm[pinKey] ?? 0;
          const mapping = binding.mapping as PwmToAngularVelocity;
          
          // 死区处理
          const effectiveDuty = duty < mapping.deadband ? 0 : duty;
          const targetRpm = effectiveDuty * mapping.maxRpm * (mapping.invert ? -1 : 1);
          const targetRadPerSec = (targetRpm / 60) * 2 * Math.PI;
          
          // 设置关节电机目标速度；motorMaxTorque 来自 MechanicalJoint（W2 §2.5 SSOT）
          const joint = this.manifest.mechanical?.joints.find(
            j => j.jointId === binding.mechanicalJointId,
          );
          const maxTorque = joint?.motorMaxTorque ?? 0.5;

          this.physics.setJointMotorVelocity(
            binding.mechanicalJointId, 
            targetRadPerSec,
            maxTorque,
          );
          break;
        }
        
        case 'gpio_to_binary_state': {
          const level = outputs.gpio[pinKey] ?? false;
          const mapping = binding.mapping as GpioToBinaryState;
          const active = mapping.activeHigh ? level : !level;
          // 触发/释放锁定关节等
          this.physics.setJointLocked(binding.mechanicalJointId, !active);
          break;
        }
        
        case 'pwm_to_brightness': {
          const duty = outputs.pwm[pinKey] ?? 0;
          const mapping = binding.mapping as PwmToBrightness;
          // 控制 3D 中点光源强度
          this.updateLightIntensity(binding.mechanicalJointId, duty, mapping);
          break;
        }
      }
    }
  }
}
```

### 5.2 视觉反馈（电路视窗侧）

当 ActuatorMirror 应用输出后，同时通知电路视窗更新 PWM 可视化：

| PWM 状态 | Circuit View 反馈 |
|----------|-------------------|
| duty = 0 | 引脚/导线灰色 |
| 0 < duty < 1 | 引脚脉冲动画（频率正比于 duty） |
| duty = 1 | 引脚/导线持续高亮 |

### 5.3 差速底盘运动学（M3 验收范围）

双轮 `pwm_to_angular_velocity` 绑定后，须通过 **差速运动学** 驱动底盘 `chassis` 刚体（而非两轮独立空转）：

```text
v = (v_left + v_right) / 2
ω = (v_right - v_left) / trackWidth
```

| 里程碑 | 验收 |
|--------|------|
| **M3 最低** | 两轮按 PWM 占空比旋转（可暂不整车平移） |
| **M3 推荐** | 底盘随双轮差速前进/转向（`trackWidth` 默认 0.12m，写入模板） |

实现位置：`ActuatorMirror` 或 `DiffDriveController.ts`，在 `applyOutputs` 后写入 chassis 线速度/角速度。

---

## 6. Worker 协议扩展

### 6.1 新增命令

```typescript
// 新增到 SimulationCommand union
| { type: 'setIdealInputs'; inputs: IdealInputBatch }

// Worker 收到后将 ideal 值注入 PAL
// 替代现有的逐 GPIO setPinIdeal 和 setUltrasonicDistance
```

### 6.2 新增事件

```typescript
// 新增到 SimulationEvent union
| { type: 'actuatorOutput'; outputs: ActuatorOutputBatch }

interface ActuatorOutputBatch {
  simTimeUs: bigint;
  gpio: Record<number, boolean>;  // pin → level
  pwm: Record<number, number>;   // pin → duty 0..1
}
```

### 6.3 协议版本协商

```typescript
// Worker 启动后第一条消息
worker.postMessage({ type: 'HANDSHAKE', protocolVersion: 2 });

// Worker 回复
// { type: 'HANDSHAKE_ACK', supportedVersions: [1, 2] }

// 主线程选择双方都支持的最高版本
// 如果只有 v1，回退到 setPinIdeal / setUltrasonicDistance 旧协议
```

---

## 7. 帧预算监控

```typescript
// components/world/perf-monitor.ts

export class FrameBudgetMonitor {
  private frameTimes: number[] = [];
  private readonly WINDOW = 60;  // 60 帧滑动窗口
  
  markFrameStart() { this.frameStart = performance.now(); }
  
  markPhase(name: 'render' | 'physics' | 'envState' | 'postMessage' | 'vueUpdate') {
    // 记录各阶段耗时
  }
  
  markFrameEnd() {
    const total = performance.now() - this.frameStart;
    this.frameTimes.push(total);
    if (this.frameTimes.length > this.WINDOW) this.frameTimes.shift();
    
    // 超预算警告
    if (total > 16) {
      this.overBudgetCount++;
      if (this.overBudgetCount > 10) {
        this.emit('budgetExceeded', { avgMs: this.average, worst: this.worst });
      }
    }
  }
  
  get average() { return this.frameTimes.reduce((a,b) => a+b, 0) / this.frameTimes.length; }
  get worst() { return Math.max(...this.frameTimes); }
}
```

---

## 8. 更新渲染循环

W3a 的简化循环升级为完整物理循环：

```typescript
function startSimulationLoop() {
  const clock = new THREE.Clock();
  const perfMonitor = new FrameBudgetMonitor();
  
  function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (document.hidden) return;
    
    perfMonitor.markFrameStart();
    
    const rawDt = clock.getDelta();
    
    if (isSimulationRunning.value) {
      // 1. 应用上一帧 Worker 返回的执行器输出
      perfMonitor.markPhase('actuator');
      if (pendingActuatorOutput) {
        actuatorMirror.applyOutputs(pendingActuatorOutput);
        pendingActuatorOutput = null;
      }
      
      // 2. 物理步进（固定步长 + 累加器）
      perfMonitor.markPhase('physics');
      physicsStep(rawDt);
      
      // 3. 同步物理 → Three.js
      physics.syncToThreeJS(meshRegistry);
      
      // 4. 计算环境 ideal 值 → 发送给 Worker（W3c 实现）
      // perfMonitor.markPhase('envState');
      // envStateManager.tick(simTimeUs);
      // sendIdealInputsToWorker(simTimeUs);
    }
    
    // 5. 渲染
    perfMonitor.markPhase('render');
    controls.update();
    renderer.render(scene, camera);
    
    perfMonitor.markFrameEnd();
  }
  
  animate();
}
```

---

## 9. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | Rapier WASM 正确加载（或 fallback 到运动学） | 控制台日志 |
| A2 | 底盘在重力下落到地面并静止 | 视觉 |
| A3 | 轮子通过 revolute joint 可转动 | 视觉 |
| A4 | 墙壁静态碰撞体阻挡底盘 | 视觉 |
| A5 | PWM duty=0.5 → 轮子以半速转动 | 手动 + 调试 |
| A6 | PWM duty=0 → 轮子停止 | 手动 |
| A7 | SimTime 单调递增，主线程与 Worker 差异 < 2 帧 | 日志对比 |
| A8 | Worker 超时 3 帧 → 自动降速 + 警告 | 模拟高负载 |
| A9 | 帧预算监控正常报告各阶段耗时 | Chrome DevTools |
| A10 | 主线程单帧总耗时 < 16ms（50 刚体以内） | Performance |
| A11 | Worker 单帧 catch-up ≤ 5 步；超时触发降速 | 日志 + 手动 |

---

## 10. WASM 模块实例化胶水 imports 契约与中断注册队列 (Gap 8 & Gap 1)

依据 `sim_specs_deep_assessment.md` 评估报告，在 W3b 中打通主线程与 Wasm 时，宿主环境在实例化 WASM 沙箱时必须传入符合 `WasmImports` 契约的导入桩函数，且在 TS 侧需要引入 `WasmInterruptQueue` 来调度异步硬件中断。

### 10.1 WasmImports 契约定义 (Gap 8)

在 `../../../../../wink-ai/packages/unisim/src/unisim/types/` 中声明以下接口，作为 Worker 内 Wasm 实例化的规范：

```typescript
/** WASM 实例化时宿主 JS 必须提供的导入函数契约 (对齐 Emscripten 胶水与 C 侧导出) */
export interface WasmImports {
  env: {
    // --- 异步让出点 (Asyncify) ---
    js_pal_os_sleep_ms: (ms: number) => Promise<void>;
    js_pal_os_busy_wait_us: (us: number) => Promise<void>;

    // --- 同步系统时钟 ---
    js_pal_os_get_ms: () => bigint;
    js_pal_os_get_us: () => bigint;

    // --- PAL HAL 虚拟 IO 读写 ---
    js_pal_gpio_write: (pin: number, level: boolean) => void;
    js_pal_gpio_read: (pin: number) => boolean;
    js_pal_pwm_set_duty: (channel: number, duty: number) => void;
    
    // --- 虚拟 I2C 总线传输 (Bypass, Gap 2) ---
    js_pal_i2c_transfer: (
      port: number,
      addr: number,
      writeBufPtr: number,
      writeLen: number,
      readBufPtr: number,
      readLen: number
    ) => boolean;

    // --- 中断控制 Poll 接口 (Gap 1) ---
    js_pal_register_interrupt: (pin: number, callbackIndex: number, argPtr: number) => void;
    js_pal_deregister_interrupt: (pin: number) => void;
    js_pal_poll_interrupt: (outCallbackIndexPtr: number, outArgPtr: number) => boolean;

    // --- DAL 业务直通 (Bypass) ---
    js_sim_trigger_ultrasonic: (trigPin: number) => void;
    js_sim_measure_echo_pulse_us: (trigPin: number) => number;
  }
}
```

### 10.2 中断桥接队列 (Gap 1)

为支持虚拟按键点击等交互输入产生的中断，TS 侧必须维护中断 FIFO 缓存队列，并在 `js_pal_poll_interrupt` 中被 C 侧运行时定时拉取：

```typescript
/** 中断注册映射信息，对应 C 侧 Table 索引与内存偏移 */
export interface WasmInterruptInfo {
  callbackIndex: number;
  argPtr: number;
}

/** 中断队列状态机，管理 FIFO 缓存，防止 sleeping 窗口重入 */
export interface WasmInterruptQueue {
  /** pin -> 中断路由信息映射表 */
  registry: Map<number, WasmInterruptInfo>;
  /** FIFO 队列，容量由 PAL_WASM_INTERRUPT_QUEUE_SIZE 决定 */
  pending: Array<WasmInterruptInfo>;
  maxPending: number;
}
```

---

## 11. 验收标准增补

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A12 | WasmImports 契约完全覆盖 Emscripten imports，实例化无 Undefined Symbol 报错 | Web Worker 启动验证 |
| A13 | 虚拟按键点击产生的中断信号可通过 WasmInterruptQueue 投递，C 侧成功触发 ISR | 单元测试 + 集成测试 |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——Task 3.0b spike、追赶预算 §4.4–4.5、差速运动学 §5.3。
- 2026-07-09：就绪度对齐——补充宿主 WasmImports 契约 (Gap 8) 与 WasmInterruptQueue 队列 (Gap 1)。
- 2026-07-09：W2 评审回写——§5.1 `motorMaxTorque` 改从 `MechanicalJoint` 读取。

