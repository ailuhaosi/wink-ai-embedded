# M3 — Ideal Inject 插件化

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。**前置：M2 出口已通过。**

**Goal:** 将按钮 / 超声等 ④ Ideal Inject 从 `EmbeddedWorkbench.vue` / `syncIdleGpioFromComponents` 的 `type ===` 特判迁入 `definition.simulation.inject`；宿主只调用通用 `runInject` / `runInjectIdle` / `syncIdealInputs`。

**Architecture:** ④ 是输入激励，不是 Observation。插件声明 `inject.apply` / `inject.idle`；宿主遍历组件调用。底层暂时仍调 `setPinIdeal` / `setUltrasonicDistance`（W3c 统一 API 的适配点，本阶段不实现时间戳队列）。

**Tech Stack:** TypeScript、Vitest、现有 `simulation-pin-api.ts`。

## Global Constraints

- 继承 roadmap。
- **禁止**为传感器新增 `actuatorObserve`「方便面板展示」。
- **不**在本阶段实现 `setIdealInputs` 完整协议 / Worker 事件队列（可留 `kind: 'ideal_inputs'` 扩展位）。
- Workbench 中与演示相关的 **LED 断线** `toggleWireBreak`（`type === 'led'`）属调试工具：本阶段可保留或迁到独立 debug action；**不要**塞进 `inject` 冒充输入通道。若保留，须在计划验收中标注为「已知非插件化调试钩子」。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M3` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 出口已通过（A1–A5 人工确认完成） |
| **优先级** | 🟡 P1 |
| **前置依赖** | [`m2-ui-bind-pluginization.md`](./m2-ui-bind-pluginization.md) |
| **后继** | [`m5-motor-channel3.md`](./m5-motor-channel3.md)（推荐）或 M4 |

---

## 2. 今日特判锚点（必须消除）

| 位置 | 行为 |
|------|------|
| `EmbeddedWorkbench.vue` ~L90–99 | `type === 'ultrasonic'` → `setUltrasonicDistance` |
| `EmbeddedWorkbench.vue` `handleButtonPress/Release` | 直接 `setPinIdeal` |
| `simulation-client.ts` `syncIdleGpioFromComponents` | `type !== 'button'` continue |
| `WorldPeripheralsPane` / 事件绑定 | 可能把 press/release 绑到宿主 handler |

目标：宿主变为：

```typescript
import { runInject, runInjectIdle, syncIdealInputs } from '@/services/ideal-inject';

// 距离 / props 变化
syncIdealInputs(activeComponents.value);

// 按钮按下
runInject(comp, { event: 'press' });

// 复位 / 启动前
runInjectIdle(activeComponents.value);
```

---

## 3. 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | 无超声特判 | `EmbeddedWorkbench.vue` 无 `type === 'ultrasonic'`（grep） |
| A2 | 无按钮 idle 硬编码 | `syncIdleGpioFromComponents` 删除或改为薄封装调用 `runInjectIdle`；内部无 `type !== 'button'` |
| A3 | 契约 | `PeripheralDefinition.simulation.inject` 类型存在；button / ultrasonic 已填 |
| A4 | 测试 | 新单测覆盖 button press/idle、ultrasonic distance apply |
| A5 | 演示 | OLED Demo 按钮控灯；避障距离滑块仍驱动固件 |

---

## 4. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts` | ✏️ | `simulation.inject` |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/ideal-inject.ts` | 🆕 | `runInject` / `runInjectIdle` / `syncIdealInputs` |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/__tests__/ideal-inject.test.ts` | 🆕 | |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/button/definition.ts` | ✏️ | inject |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts` | ✏️ | inject |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/simulation-client.ts` | ✏️ | 废弃硬编码 idle |
| `../../../../../wink-ai/packages/embedded-frontend/src/views/EmbeddedWorkbench.vue` | ✏️ | 改调通用 API |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/button/WorldWidget.vue` 等 | ✏️ | 事件上抛或本地调 inject（优先：上抛由宿主 runInject，保持测试性） |

---

## 5. 目标契约

为了支撑**确定性仿真时间戳对齐 (Temporal Determinism)**，`InjectContext` 提供时钟获取，且注入 API 支持携带 `timestampUs`。同时支持**输入引脚冲突仲裁 (Conflict Arbiter)**：

```typescript
export interface InjectContext {
  event?: 'press' | 'release' | 'props' | 'idle';
  /** 可选：当由确定性测试回放触发时，指示当前注入的仿真微秒时间戳 */
  timestampUs?: string;
  /** 宿主可注入的共享 API，避免外设 import pin-api 造成环依赖 */
  apis: {
    /** 注入 GPIO 理想值，支持时间戳，支持弱拉或强覆盖模式（用于解决同引脚冲突） */
    setPinIdeal: (pin: number, level: boolean, options?: { timestampUs?: string; drive?: 'strong' | 'weak' }) => void;
    setUltrasonicDistance: (trig: number, echo: number, cm: number, options?: { timestampUs?: string }) => void;
    /** 获取仿真 Worker 的当前虚拟时间，协助外设进行时序同步 */
    getCurrentSimTimeUs: () => string;
  };
}

// PeripheralDefinition.simulation 扩展：
inject?: {
  kind: 'gpio_ideal' | 'ultrasonic_distance' | 'ideal_inputs';
  apply: (comp: CircuitComponentInstance, ctx: InjectContext) => void;
  idle?: (comp: CircuitComponentInstance, ctx: InjectContext) => void;
};
```

`ideal-inject.ts` 职责（由宿主实现时注入 API）：

```typescript
export function syncIdealInputs(components: CircuitComponentInstance[]): void {
  const apis = { 
    setPinIdeal: (pin, level, opts) => setPinIdeal(pin, level, opts), 
    setUltrasonicDistance: (trig, echo, cm, opts) => setUltrasonicDistance(trig, echo, cm, opts),
    getCurrentSimTimeUs: () => getSimTimeUs() // 从 simulation-runtime 获取
  };
  
  // 冲突仲裁：对同引脚多点注入，宿主内部维护 Map 分辨 strong/weak。若冲突，strong 覆盖 weak，同级以最新写入为准。
  for (const comp of components) {
    const inject = registry.get(comp.type)?.simulation?.inject;
    inject?.apply(comp, { event: 'props', apis });
  }
}

export function runInject(
  comp: CircuitComponentInstance,
  partial: Pick<InjectContext, 'event' | 'timestampUs'>,
): void {
  const inject = registry.get(comp.type)?.simulation?.inject;
  const apis = { 
    setPinIdeal: (pin, level, opts) => setPinIdeal(pin, level, { ...opts, timestampUs: partial.timestampUs }), 
    setUltrasonicDistance: (trig, echo, cm, opts) => setUltrasonicDistance(trig, echo, { ...opts, timestampUs: partial.timestampUs }),
    getCurrentSimTimeUs: () => getSimTimeUs()
  };
  inject?.apply(comp, { ...partial, apis });
}

export function runInjectIdle(components: CircuitComponentInstance[]): void {
  const apis = { 
    setPinIdeal: (pin, level, opts) => setPinIdeal(pin, level, opts), 
    setUltrasonicDistance: (trig, echo, cm, opts) => setUltrasonicDistance(trig, echo, cm, opts),
    getCurrentSimTimeUs: () => getSimTimeUs()
  };
  for (const comp of components) {
    const inject = registry.get(comp.type)?.simulation?.inject;
    inject?.idle?.(comp, { event: 'idle', apis });
  }
}
```

---

## 6. Tasks

### Task 3.1: 类型 + ideal-inject 服务（TDD）

**Files:**
- Create: `ideal-inject.ts` + test
- Modify: `types.ts`

- [x] **Step 1: 写失败测试**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { registry } from '@/peripherals';
import { syncIdealInputs, runInject, runInjectIdle } from '../ideal-inject';

// 使用真实 button/ultrasonic definition（已 register via peripherals/index）
// mock setPinIdeal / setUltrasonicDistance

describe('ideal-inject', () => {
  it('syncIdealInputs applies ultrasonic distance from props', () => {
    // arrange ultrasonic comp with TRIG/ECHO + distance 25
    // expect setUltrasonicDistance called with (trig, echo, 25)
  });

  it('runInject press sets active pin level for button', () => {
    // expect setPinIdeal(signalPin, !activeLow)
  });

  it('runInjectIdle restores idle level for button', () => {
    // expect setPinIdeal(signalPin, activeLow)
  });

  it('ignores peripherals without inject', () => {
    // led comp → no throw, no pin api calls
  });
});
```

- [x] **Step 2: 实现最小 `ideal-inject.ts` + 类型。**
- [x] **Step 3: Commit** `feat: add ideal-inject runner for channel ④`

---

### Task 3.2: 按钮 definition.inject

**Files:**
- Modify: `button/definition.ts`

- [x] **Step 1: 实现**

```typescript
simulation: {
  inject: {
    kind: 'gpio_ideal',
    apply(comp, ctx) {
      const signalPin = comp.pinConnections['1.l'];
      if (typeof signalPin !== 'number') return;
      const activeLow = comp.props.activeLow !== false;
      if (ctx.event === 'press') ctx.apis.setPinIdeal(signalPin, !activeLow);
      if (ctx.event === 'release') ctx.apis.setPinIdeal(signalPin, activeLow);
    },
    idle(comp, ctx) {
      const signalPin = comp.pinConnections['1.l'];
      if (typeof signalPin !== 'number') return;
      const activeLow = comp.props.activeLow !== false;
      ctx.apis.setPinIdeal(signalPin, activeLow);
    },
  },
},
```

- [x] **Step 2: 测试 PASS。**
- [x] **Step 3: Commit** `feat(button): declare gpio_ideal inject`

---

### Task 3.3: 超声 definition.inject

**Files:**
- Modify: `ultrasonic/definition.ts`

- [x] **Step 1:**

```typescript
simulation: {
  // 保留 observe 至 M4 清理；本阶段 inject 为真路径
  observe(comp, builder) { /* 现有 watchUltrasonic，M4 删除 */ },
  inject: {
    kind: 'ultrasonic_distance',
    apply(comp, ctx) {
      const trig = comp.pinConnections.TRIG;
      const echo = comp.pinConnections.ECHO;
      const dist = comp.props.distance;
      if (typeof trig !== 'number' || typeof echo !== 'number') return;
      if (typeof dist !== 'number') return;
      ctx.apis.setUltrasonicDistance(trig, echo, dist);
    },
  },
},
```

- [x] **Step 2: Commit** `feat(ultrasonic): declare ultrasonic_distance inject`

---

### Task 3.4: 宿主改接

**Files:**
- Modify: `EmbeddedWorkbench.vue`, `simulation-client.ts`

- [x] **Step 1: 替换 watch 超声特判** 为 `watch(..., () => syncIdealInputs(activeComponents.value))`。
- [x] **Step 2: `handleButtonPress/Release` → `runInject(comp, { event: 'press'|'release' })`。
- [x] **Step 3: `syncIdleGpioFromComponents` → 实现改为调用 `runInjectIdle`，或删除并由 Workbench 直接调用。
- [x] **Step 4: Grep 门禁：**

```bash
rg "type === 'ultrasonic'|type !== 'button'|type === 'button'" ../../../../../wink-ai/packages/embedded-frontend/src/views/EmbeddedWorkbench.vue ../../../../../wink-ai/packages/embedded-frontend/src/services/simulation-client.ts
```

Expected: 无业务特判命中（注释/调试 LED 断线除外并记录）。

- [x] **Step 5: `npm run test`**
- [x] **Step 6: Commit** `refactor(workbench): route ideal inject through peripheral plugins`

---

### Task 3.5: 演示与出口

- [x] OLED Demo：按按钮 LED 变化。（人工浏览器已确认）
- [x] Avoidance：拖距离 → 舵机/面板响应。（人工已确认；含 Simulate 下 Ideal Inject 滑块可拖）
- [x] 勾选 roadmap M3。

---

## 7. 风险与回滚

| 风险 | 缓解 |
|------|------|
| WorldWidget 仍直接调 setPinIdeal | grep `setPinIdeal` 于 peripherals；仅允许经 inject 或测试 mock |
| 双路径 inject（旧 watch + 新 sync）重复写 | 删除 Workbench 旧特判，只留 syncIdealInputs |
| W3c 后续 API 变更 | `apis` 门面集中，便于改 `setIdealInputs` |

---

## 8. 文档变更记录

- 2026-07-12：初稿。
- 2026-07-12：Task 3.5 代码出口通过 — A1–A4 验证绿；全量回归 264 tests；A5 人工演示待确认；roadmap M3 已勾选。
- 2026-07-12：A5 部分确认 — OLED 按键控灯人工通过；避障距离滑块延后至套件收尾（M4 清理假 observe 后再联调更合适）。
- 2026-07-12：套件收尾 — M4/M6 合并后再次确认 OLED 按键控灯正常；避障滑块仍为可选补测。
- 2026-07-12：A5-Avoidance 人工通过 — 拖超声距离滑块驱动舵机/面板；顺带修复 Simulate 下 Ideal Inject 滑块被 `canEditCircuit` 误禁用。
