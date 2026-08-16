# M2 — UI Bind 插件化

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。**前置：M0 + M1 出口已通过。**

**Goal:** 将 `bindCanvasProps` / `bindWorldProps` 的 `switch(comp.type)` 迁入各外设 `definition.ui.canvasProps|worldProps`；OLED / 舵机 glyph 改为纯 props，清零 `simulation-runtime` 直读。

**Architecture:** 宿主只做 `registry.get(type)?.ui?.canvasProps?.(comp, ctx) ?? {}`；`SimViewContext` 承载 ①②③（本阶段 `displayFb` 别名兼容今日 `oledFb`）。Glyph 禁止 import runtime。

**Tech Stack:** TypeScript 类型扩展、Vitest、既有 `resolveCanvasEntry` / `resolveWorldEntries`。

## Global Constraints

- 继承 roadmap。
- **不**改 Ideal Inject（M3）；**不**改 `observeDisplay`（M4）。
- 未知 type：保持「安全降级」语义——无 `ui.*` 且无 canvas/world 组件时跳过渲染（与今日 `null` 行为对齐）。
- 验证外设：LED、OLED、舵机（按钮 canvas 可无仿真 props，但须迁出 switch）。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M2` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 代码出口已通过（A1–A4；A5 待人工演示勾选） |
| **优先级** | 🟡 P1 |
| **前置依赖** | [`m1-contract-and-guardrails.md`](./m1-contract-and-guardrails.md) |
| **后继** | [`m3-inject-pluginization.md`](./m3-inject-pluginization.md) |

---

## 2. 目标与验收

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | 无 type switch | `bindCanvasProps.ts` / `bindWorldProps.ts` 源码无 `switch (comp.type)` / `case 'led'` |
| A2 | 直读清零 | `architecture-data-plane.test.ts` 期望 `rel` 为空数组 |
| A3 | lint | peripherals `no-restricted-imports` 升为 `error`；`npm run lint` 通过 |
| A4 | 行为回归 | 既有 `bindCanvasProps.test.ts` / `bindWorldProps.test.ts` / resolve* 测试改写后全绿 |
| A5 | 演示 | OLED Demo：屏仍刷新；避障：舵机角度仍显示；LED 亮灭仍跟 pinStates |

---

## 3. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts` | ✏️ | 增加 `ui?`、`SimViewContext` |
| `../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindCanvasProps.ts` | ✏️ | 改为查 registry |
| `../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/bindWorldProps.ts` | ✏️ | 同上；ctx 含 `oledFb`/`displayFb`/`actuatorObservations` |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/definition.ts` | ✏️ | `ui.canvasProps` / `ui.worldProps` |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/button/definition.ts` | ✏️ | 迁入 ui bind |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/definition.ts` | ✏️ | worldProps 注入 framebuffer |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/CanvasGlyph.vue` | ✏️ | props 驱动；删 runtime import |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts` | ✏️ | 迁入 ui bind |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/servo/definition.ts` | ✏️ | canvasProps 提供 angle |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/servo/CanvasGlyph.vue` | ✏️ | `defineProps<{ angle }>` |
| `../../../../../wink-ai/packages/embedded-frontend/src/components/peripherals/WorldPeripheralsPane.vue` 等 | ✏️ | 向 ctx 传入 `actuatorObservations` |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/architecture-data-plane.test.ts` | ✏️ | expect `[]` |
| `../../../../../wink-ai/packages/embedded-frontend/eslint.config.js` | ✏️ | warn → error |
| 相关 `*.test.ts` | ✏️ | 适配 |

---

## 4. 目标类型（契约）

在 `peripherals/types.ts` 增加（对接 tech-design §13.4 多态引脚支持，并只读冻结上下文对象）：

```typescript
export interface PinSignalState {
  level: boolean;
  voltage?: number;
  mode: 'input' | 'output' | 'high_z' | 'analog';
  pull: 'none' | 'up' | 'down';
}

export interface SimViewContext {
  readonly pinStates: Record<number, boolean | PinSignalState>;
  /** ② 今日单屏过渡：与 oledFb 同值 */
  readonly displayFb: Uint8Array | null;
  /** @deprecated 别名，binder 内可读 ctx.displayFb */
  readonly oledFb?: Uint8Array | null;
  readonly actuatorObservations: readonly ActuatorObservation[];
}

/** 安全判断引脚是否为高电平，兼容 boolean 和 PinSignalState 结构 */
export function isPinHigh(state: boolean | PinSignalState | undefined): boolean {
  if (state === undefined) return false;
  if (typeof state === 'boolean') return state;
  return state.level;
}

export interface PeripheralUiBind {
  canvasProps?: (
    comp: CircuitComponentInstance,
    ctx: SimViewContext,
  ) => Record<string, unknown>;
  worldProps?: (
    comp: CircuitComponentInstance,
    ctx: SimViewContext,
  ) => Record<string, unknown>;
}

// PeripheralDefinition 增加：
//   ui?: PeripheralUiBind;
```

`CanvasPropsContext` / `WorldPropsContext` 应扩展或直接改用 `SimViewContext`，避免两套上下文长期分叉。

---

## 5. Tasks

### Task 2.1: 扩展类型（TDD：先让旧测试仍编译）

**Files:**
- Modify: `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts`

- [ ] **Step 1:** 按上节添加 `SimViewContext` / `PeripheralUiBind` / `ui?`。
- [ ] **Step 2:** `npm run typecheck` 或至少 `npm run test` 相关文件编译通过。
- [ ] **Step 3: Commit** `feat(types): add PeripheralUiBind and SimViewContext`

---

### Task 2.2: 改写 bind* 为 registry 分发（先红后绿）

**Files:**
- Modify: `bindCanvasProps.ts`, `bindWorldProps.ts`
- Modify: `bindCanvasProps.test.ts`, `bindWorldProps.test.ts`

- [ ] **Step 1: 更新测试** — 不再依赖 switch；改为：

1. 对已注册外设，期望 props 与迁入 definition 后一致。
2. 未知 type → `null` 或 `{}`（与 `resolve*` 约定一致：无 ui 且无定义时 degrade）。

建议行为：

```typescript
export function bindCanvasProps(
  comp: CircuitComponentInstance,
  ctx: SimViewContext,
): Record<string, unknown> | null {
  const def = registry.get(comp.type);
  if (!def?.canvas?.component) return null;
  const props = def.ui?.canvasProps?.(comp, ctx) ?? {};
  return props;
}
```

World 同理（检查 `def.world?.component`）。

- [ ] **Step 2: 运行测试确认失败**（definition 尚未填 ui）

```bash
cd ../../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/components/peripherals/__tests__/bindCanvasProps.test.ts src/components/peripherals/__tests__/bindWorldProps.test.ts
```

Expected: FAIL（props 为空或不匹配）。

- [ ] **Step 3: 实现 bind* registry 分发**（最小实现）。
- [ ] **Step 4: Commit** `refactor: dispatch bind* via peripheral ui binders`

---

### Task 2.3: LED / 按钮 / 超声迁入 `ui.*`

**Files:**
- Modify: `led/definition.ts`, `button/definition.ts`, `ultrasonic/definition.ts`

- [ ] **Step 1: LED** — 从旧 `bindCanvasProps`/`bindWorldProps` **逐字段搬运**（保持 props 形状，避免 CanvasGlyph 破坏）：

```typescript
ui: {
  canvasProps: (comp, ctx) => ({
    pinConnections: comp.pinConnections,
    color: comp.props.color,
    brightness: comp.props.brightness,
    label: comp.props.label,
    flip: comp.props.flip,
    pinStates: ctx.pinStates,
  }),
  worldProps: (comp, ctx) => ({
    pinConnections: comp.pinConnections,
    color: comp.props.color,
    level:
      typeof comp.pinConnections.A === 'number'
        ? isPinHigh(ctx.pinStates[comp.pinConnections.A])
        : false,
    brightness: comp.props.brightness,
    label: comp.props.label,
    flip: comp.props.flip,
  }),
},
```

- [ ] **Step 2: 按钮 / 超声** — 同样搬运营代码。
- [ ] **Step 3: 跑 bind* 测试至 PASS。**
- [ ] **Step 4: Commit** `feat(peripherals): move LED/button/ultrasonic UI bind into definitions`

---

### Task 2.4: OLED — binder 注入 FB + Glyph 纯 props

**Files:**
- Modify: `oled/definition.ts`, `oled/CanvasGlyph.vue`, `oled/WorldWidget.vue`（若已用 props 则只改 definition）
- Modify: 调用方传入 ctx（`WorldPeripheralsPane` / canvas host）

- [ ] **Step 1: 写/更新测试** — CanvasGlyph 不再依赖模块级 `oledFb`。

目标 Glyph：

```vue
<script setup lang="ts">
import '@wokwi/elements';
import { ref, watch } from 'vue';
import { paintOledFramebuffer, type OledElementLike } from './paintFramebuffer';

const props = defineProps<{
  framebuffer?: Uint8Array | null;
}>();

const oledEl = ref<OledElementLike | null>(null);

watch(
  () => [props.framebuffer, oledEl.value] as const,
  ([newFb, el]) => {
    if (!el) return;
    paintOledFramebuffer(el, newFb ?? null);
  },
  { immediate: true },
);
</script>
```

- [ ] **Step 2: definition.ui**

```typescript
ui: {
  canvasProps: (_comp, ctx) => ({
    framebuffer: ctx.displayFb ?? ctx.oledFb ?? null,
  }),
  worldProps: (comp, ctx) => ({
    pinConnections: comp.pinConnections,
    framebuffer: ctx.displayFb ?? ctx.oledFb ?? null,
  }),
},
```

- [ ] **Step 3: 确保 resolve 链路把 `displayFb`/`oledFb` 填进 ctx**（与 EmbeddedWorkbench 今日传入的 `oledFb` 对齐）。
- [ ] **Step 4: Commit** `refactor(oled): bind framebuffer via ui props`

---

### Task 2.5: 舵机 — binder 注入 angle + Glyph 纯 props

**Files:**
- Modify: `servo/definition.ts`, `servo/CanvasGlyph.vue`

- [ ] **Step 1: 失败测试** — Glyph 接受 `angle: number`；definition 从 observations 查找。

```typescript
ui: {
  canvasProps: (comp, ctx) => {
    const obs = ctx.actuatorObservations.find(
      (o) => o.deviceComponentId === comp.id && o.quantity === 'angular_position',
    );
    const angle = typeof obs?.value === 'number' ? obs.value : 90;
    return {
      id: comp.id,
      label: comp.props.label ?? comp.id,
      pwmChannel: comp.props.pwmChannel,
      angle,
    };
  },
},
```

```vue
<script setup lang="ts">
import '@wokwi/elements';
defineProps<{
  id: string;
  label?: string;
  pwmChannel?: number;
  angle: number;
}>();
</script>

<template>
  <div class="servo-container">
    <wokwi-servo :angle="angle" />
    <span class="label">{{ label || id }} ({{ Math.round(angle) }}°)</span>
  </div>
</template>
```

- [ ] **Step 2: Canvas host ctx 必须包含 `actuatorObservations`**（从 `simulation-runtime` 在宿主读取后传入 — 宿主允许，外设包不允许）。
- [ ] **Step 3: Commit** `refactor(servo): bind angle via ui props`

---

### Task 2.6: 清零护栏 + stub 外设

**Files:**
- Modify: `architecture-data-plane.test.ts` → `expect(rel).toEqual([])`
- Modify: `eslint.config.js` → `'error'`
- Modify: stub definitions（`motor_driver_stub` / `buzzer_stub` / `dht22_stub`）若有 canvas 组件：提供空 `ui.canvasProps: () => ({})` 或最小 props，避免 resolve 失败

- [ ] **Step 1:** 确认无 peripherals 文件 import simulation-runtime。
- [ ] **Step 2:** `npm run lint && npm run test`
- [ ] **Step 3: Commit** `test: enforce zero simulation-runtime imports in peripherals`

---

### Task 2.7: 手动演示清单

- [ ] OLED dashboard Simulate：按钮/LED/OLED 行为与改前一致。
- [ ] Avoidance：距离滑块 → 舵机角度面板与 glyph 一致。
- [ ] 勾选 roadmap M2 出口。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| ctx 漏传 `actuatorObservations` | 舵机角度卡在 90°；加 resolve 测试覆盖 |
| World/Canvas ctx 形状不一致 | 统一 `SimViewContext` |
| stub 外设 resolve 回归 | 为 stub 补最小 ui 或允许 `canvasProps` 缺省 `{}` |

**回滚：** revert M2 commits；M1 baseline 测试改回双 offender。

---

## 7. 文档变更记录

- 2026-07-12：初稿。
