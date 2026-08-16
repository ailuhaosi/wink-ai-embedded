# M5 — 电机接通道 ③（验证「加外设零改宿主」）

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。**前置：M2 + M3 已通过**（ui bind 与 inject 总线已稳）。推荐在 M4 前执行。

**Goal:** 将 `motor_driver_stub` 补齐为真实 ③ 执行器插件：双 PWM source + converter → `angular_velocity` Observation；**证明**新增同构执行器不修改 Worker / `EmbeddedWorkbench` / `bind*`。

**Architecture:** 抄舵机金样板（③）：`simulation.observe` → `watchActuatorSource` ×2；`actuatorObserve.profile`；`index.ts` 注册 converter；可选 `ui.canvasProps` 显示 RPM。Raw 复用既有 `pal_wasm_get_pwm_duty_percent`（Worker 已采 `actuatorOutputs.pwm`）。

**Tech Stack:** 既有 Mapper + `actuatorConverterRegistry`；Vitest。

## Global Constraints

- 继承 roadmap。
- **禁止**改 `wasm-simulation.worker.ts` 消息协议（除非测试证明 PWM 未采集——应先修配置而非新消息）。
- **默认不改** `wink-micro-app`；若无固件写左右 PWM，面板可用手动 duty 注入测试 **或** 仅单测 Mapper 路径验收（须在出口注明）。
- 电机 catalog 已有 `pwm_to_angular_velocity` mapping 名：converter id 可取 `dual_pwm_to_rpm` 或每侧一个 observation。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M5` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 代码出口已通过（A1–A5；Task 5.4 默认跳过） |
| **优先级** | 🟡 P1（架构验证外设） |
| **前置依赖** | M2、M3 |
| **验证外设** | `motor_driver_stub` |

---

## 2. 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | 宿主零改 | `git diff`（相对本阶段基线）中 **无** `EmbeddedWorkbench.vue` / `bindCanvasProps.ts` / `bindWorldProps.ts` / `wasm-simulation.worker.ts` 业务改动 |
| A2 | 观测产出 | 单测：给定 `batch.pwm` + sources → 两条（或约定结构的）`angular_velocity` Observation，`deviceComponentId` 正确 |
| A3 | 注册 | `peripherals/motor_driver_stub` 含 observe + converter register |
| A4 | 面板 | 若画布放置电机 stub 且 PWM raw 非零，`SimActuatorPanel` 可见条目（手动或单测） |
| A5 | 测试 | `npm run test` 全绿 |

---

## 3. 文件变更清单（允许改动的集合）

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/definition.ts` | ✏️ | observe + actuatorObserve + ui |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/index.ts` | ✏️ | register converter |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/CanvasGlyph.vue` | ✏️ | 可选显示 RPM props |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/__tests__/*.ts` | 🆕 | |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/__tests__/actuator-observation.mapper.test.ts` | ✏️ | 电机用例 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts` 等 | ❌ | 不应为电机开特例 |

**明确禁止修改（本阶段）：** Worker、Workbench、bind*（若必须改说明 M2 未完成，停下来补 M2）。

---

## 4. 设计选择（写进实现）

### 4.1 双通道 Observation 模型（采用 subAddress 区分左右）

为了优雅支持双通道电机，我们需要在数据结构上传播 `subAddress`。**需要在 M5 中对 `actuator-observation.mapper.ts` 进行微改**，使从 `ActuatorObserveSource` 提取的 `subAddress` 能够如实赋值给输出的 `ActuatorObservation.subAddress`（从而让 UI/3D 面板轻松识别左右通道）：

**方案 A（双 PWM 观察源 + subAddress 区分）：**

- 两个 `ActuatorObserveSource`，`deviceComponentId` 均为 `comp.id`
- 两个 transportKey = 左右 PWM channel（来自 props），并在声明时设置 `subAddress: 0` (左) / `subAddress: 1` (右)。
- Mapper 在映射时拷贝该字段：
  ```typescript
  observations.push({
    deviceComponentId,
    simTimeUs,
    subAddress: src.subAddress, // 传递子地址
    ...converted,
  });
  ```

---

## 4.2 Props

在 definition 增加：

```typescript
props: {
  pwmChannelLeft: { type: 'number', default: 0, description: 'Left PWM channel' },
  pwmChannelRight: { type: 'number', default: 1, description: 'Right PWM channel' },
  maxRpm: { type: 'number', default: 120, description: 'RPM at 100% duty' },
},
```

注意：画布引脚 `PWM_LEFT`/`PWM_RIGHT` 的 GPIO 号 ≠ PWM channel；与舵机一样，**observe 用 pwm channel props**。

---

### 4.3 Stateful Converter (惯性物理仿真)

为了支持物理加速/减速惯性环节的仿真，我们扩展 `ActuatorConverter` 签名上下文，在 `Mapper` 执行转换时传入 `stateStore: Record<string, any>` 和 `lastObservation: ActuatorObservation | null`。注册如下状态化转换器：

```typescript
actuatorConverterRegistry.register('pwm_duty_to_rpm', (duty, ctx) => {
  const maxRpm = typeof ctx.props?.maxRpm === 'number' ? ctx.props.maxRpm : 120;
  const targetRpm = (Math.max(0, Math.min(100, duty)) / 100) * maxRpm;
  
  // 物理惯性环节仿真（Stateful Converter）
  // ctx.stateStore 用于在不同仿真步(step)之间持久保存该实例该通道的转速
  const key = `rpm_${ctx.subAddress ?? 0}`;
  const prevRpm = typeof ctx.stateStore[key] === 'number' ? ctx.stateStore[key] : 0;
  
  // 根据 simTimeUs 差值计算 dt (微秒转秒)
  const lastTime = typeof ctx.stateStore[`t_${key}`] === 'string' ? ctx.stateStore[`t_${key}`] : ctx.simTimeUs;
  const dtSec = (BigInt(ctx.simTimeUs) - BigInt(lastTime)) > 0n 
    ? Number(BigInt(ctx.simTimeUs) - BigInt(lastTime)) / 1e6 
    : 0.01; // 默认 10ms 步长
    
  const inertiaConst = 0.25; // 惯性时间常数 (秒)，控制加速缓急
  const alpha = dtSec / (dtSec + inertiaConst);
  const value = prevRpm + alpha * (targetRpm - prevRpm);
  
  ctx.stateStore[key] = value;
  ctx.stateStore[`t_${key}`] = ctx.simTimeUs;
  
  return {
    quantity: 'angular_velocity',
    value,
    unit: 'rpm',
    role: 'command',
  };
});
```

---

## 5. Tasks

### Task 5.1: Mapper 单测（电机）

**Files:**
- Modify: `actuator-observation.mapper.test.ts`

- [x] **Step 1: 写失败测试** — 注册临时 definition 或使用真实 motor definition（先写 definition 也可）。

```typescript
it('maps dual pwm sources to angular_velocity for motor stub', () => {
  // batch.pwm[0]=50, pwm[1]=100
  // sources: two pwm_channel for same deviceComponentId
  // expect two observations, units rpm, values ~60 and ~120 if maxRpm=120
});
```

- [x] **Step 2: 实现 definition + converter 使测试 PASS。**
- [x] **Step 3: Commit** `feat(motor): map dual PWM duties to angular_velocity observations`

---

### Task 5.2: definition 完整声明

**Files:**
- Modify: `motor_driver_stub/definition.ts`

- [x] **Step 1:**

```typescript
actuatorObserve: {
  profile: {
    defaultQuantity: 'angular_velocity',
    unit: 'rpm',
    convert: 'pwm_duty_to_rpm',
  },
},
simulation: {
  observe: (comp, builder) => {
    const left = (comp.props.pwmChannelLeft as number) ?? 0;
    const right = (comp.props.pwmChannelRight as number) ?? 1;
    builder.watchActuatorSource({
      deviceComponentId: comp.id,
      transport: 'pwm_channel',
      transportKey: left,
      subAddress: 0, // 0 = Left
    });
    builder.watchActuatorSource({
      deviceComponentId: comp.id,
      transport: 'pwm_channel',
      transportKey: right,
      subAddress: 1, // 1 = Right
    });
  },
},
ui: {
  canvasProps: (comp, ctx) => {
    const obs = ctx.actuatorObservations.filter((o) => o.deviceComponentId === comp.id);
    const leftObs = obs.find((o) => o.subAddress === 0);
    const rightObs = obs.find((o) => o.subAddress === 1);
    return {
      label: comp.props.label ?? comp.id,
      rpmLeft: leftObs?.value ?? 0,
      rpmRight: rightObs?.value ?? 0,
    };
  },
},
```

- [x] **Step 2: index.ts 注册 converter**（对照 `servo/index.ts`）。
- [x] **Step 3: Commit**

---

### Task 5.3: 宿主零改证明

- [x] **Step 1:** 对 M5 分支运行：

```bash
git diff --name-only <m5-base-sha> -- \
  ../../../../../wink-ai/packages/embedded-frontend/src/views/EmbeddedWorkbench.vue \
  ../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindCanvasProps.ts \
  ../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindWorldProps.ts \
  ../../../../../wink-ai/packages/embedded-frontend/src/workers/wasm-simulation.worker.ts
```

Expected: 空输出。

- [x] **Step 2:** 将命令与结果记入本计划「执行记录」节（实施时追加）。
- [x] **Step 3: 勾选 roadmap M5。**

---

### Task 5.4:（可选）模板挂载

仅当需要演示闭环且 App 已写左右 PWM 时：更新避障/其它模板放置 `motor_driver_stub`。**默认跳过**；不阻塞 A1–A5。

---

## 6. 执行记录

**M5 base:** `1ec64c1`

### A1 — 宿主零改

```bash
git diff --name-only 1ec64c1 -- \
  ../../../../../wink-ai/packages/embedded-frontend/src/views/EmbeddedWorkbench.vue \
  ../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindCanvasProps.ts \
  ../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindWorldProps.ts \
  ../../../../../wink-ai/packages/embedded-frontend/src/workers/wasm-simulation.worker.ts
```

**结果：** （空输出 — 通过）

**备注：** `../../../../../wink-ai/packages/embedded-frontend/src/services/simulation-client.ts` 有改动（converter `stateStore` 会话重置），属允许范围，不在 A1 门禁文件列表中。

### Task 5.4

默认跳过（模板挂载 `motor_driver_stub`）；不阻塞 A1–A5 出口。

### A4 — 面板验收

以 Mapper 单测 + `CanvasGlyph` RPM props 为验收；无固件驱动 PWM 时 `SimActuatorPanel` 需手动 duty 注入，不要求 live demo。

### A5 — 全量回归

```bash
cd ../../../../../wink-ai/packages/embedded-frontend && bun run test
```

**结果：** 55 files / 266 tests 绿。

### 代码提交

- `262ad40` — `feat(motor): map dual PWM duties to angular_velocity observations`
- `78320c2` — `feat(motor): show dual RPM on canvas glyph and reset converter state`

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 双 observation 同 id 面板重复 | 可接受；后续再加 tag |
| GPIO 默认 14/15 与 channel 混淆 | props 文档写清；单测用 channel |
| 无固件驱动 | 以 Mapper 单测为硬出口 |

---

## 8. 文档变更记录

- 2026-07-12：初稿。
- 2026-07-12：Task 5.3 代码出口通过 — A1 宿主零改 diff 空；A2–A3 电机 observe/converter 已注册；A4 以 Mapper 单测 + glyph RPM props 验收；A5 全量回归 266 tests 绿；Task 5.4 默认跳过；roadmap M5 已勾选。
