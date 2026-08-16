# M6 — LED 可选通道 ③（gpio → state）

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。**可与 M4 并行。前置：M2 已通过**（LED 已有 `ui.*` 读 ①）。

**Goal:** 为 LED 增加可选 ③ 路径：`actuatorObserve` + `gpio_pin` source + `gpio_to_state` converter，使 `SimActuatorPanel` / 未来 ActuatorMirror 能显示灯状态；**电路视窗与 glyph 仍以 ① `pinStates` 为 SSOT**。

**Architecture:** Raw `gpio` 双用：① 直接给电路 UI；③ 经 Mapper 得 `quantity: 'state'`。不删除 ①；不新建 Worker 消息。

**Tech Stack:** 既有 `ActuatorOutputBatch.gpio`（Worker 已采）+ Mapper。

## Global Constraints

- 继承 roadmap。
- **禁止**废除 `pinStates` 或强制 LED 只走 ③。
- **禁止**新 Worker 消息。
- 验证：OLED Demo 中 LED 亮灭与面板 state 一致。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M6` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 出口已通过（OLED 按键控灯 + Actuator Observations on/off 同向已确认） |
| **优先级** | ⚪ P2 |
| **前置依赖** | M2（强）；M1 护栏 |
| **验证外设** | LED |

---

## 2. 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | ① 保留 | LED `ui.*` 仍读 `ctx.pinStates`；电路行为不变 |
| A2 | ③ 可选 | LED definition 含 `actuatorObserve` + `watchActuatorSource({ transport: 'gpio_pin' })` |
| A3 | Converter | `gpio_to_state` 注册；单测 raw 0/1 → `off`/`on`（或 bool，与 `ActuatorQuantity` `state` 约定一致） |
| A4 | 面板 | 仿真中 LED 亮时 `SimActuatorPanel` 出现对应 observation |
| A5 | 宿主 | 无 `EmbeddedWorkbench` / Worker 为 LED 新增分支 |
| A6 | 测试 | `npm run test` |

---

## 3. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/definition.ts` | ✏️ | actuatorObserve + observe sources |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/index.ts` | ✏️ | register `gpio_to_state` |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/__tests__/actuator-observation.mapper.test.ts` | ✏️ | LED 用例 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/__tests__/definition.test.ts` | 🆕（可选） | |

---

## 4. 实现要点

### 4.1 definition

```typescript
actuatorObserve: {
  profile: {
    defaultQuantity: 'state',
    unit: 'bool', // 或 'none'；与 converter 返回一致，需与 ActuatorObservation.unit 联合类型对齐
    convert: 'gpio_to_state',
  },
},
simulation: {
  observe: (comp, builder) => {
    const anode = comp.pinConnections.A;
    if (typeof anode === 'number') {
      builder.watchGpio([anode]); // ① 贡献脚观察（若全局已收脚可省略，显式更清晰）
      builder.watchActuatorSource({
        deviceComponentId: comp.id,
        transport: 'gpio_pin',
        transportKey: anode,
      });
    }
  },
},
// ui.* 保持 M2：读 pinStates，不要改成只读 Observation
```

> **unit 选择：** 若现有 `unit` 联合类型无合适字面量，优先用 `'bool'` 且 `value: 'on' | 'off'`（与类型注释一致），或扩展联合类型（最小增量）。

### 4.2 converter

```typescript
actuatorConverterRegistry.register('gpio_to_state', (raw) => ({
  quantity: 'state',
  value: raw ? 'on' : 'off',
  unit: 'bool',
  role: 'command',
}));
```

Mapper 对 `gpio_pin` 已将 raw 转为 `0|1`（见现有 mapper）— 与舵机测试中 `test_gpio_to_state` 模式对齐。

### 4.3 Worker gpio 批次

确认 `STATE_UPDATE.actuatorOutputs.gpio` 在仿真步进中包含 LED 阳极脚。若仅 `pinStates` 有而 `actuatorOutputs.gpio` 为空：

1. 先查 Worker 是否已镜像 gpio → `actuatorOutputs.gpio`（tech-design §7）。
2. 若缺失：**允许**最小修复「从已读 pin map 填入 `actuatorOutputs.gpio`」（仍非新消息类型）。记入本阶段 diff 例外并说明。
3. **不要**让 LED UI 改读 Observation 替代 ①。

---

## 5. Tasks

### Task 6.1: 单测 gpio → state

- [ ] **Step 1: 写失败测试**（可参考 mapper 中已有 `test_gpio_to_state`）。
- [ ] **Step 2: 实现 converter + LED definition。**
- [ ] **Step 3: Commit** `feat(led): optional actuator observation via gpio_to_state`

---

### Task 6.2: 确认 ①/③ 并存

- [ ] **Step 1:** 断言 LED `ui.canvasProps` / `worldProps` 仍使用 `ctx.pinStates`（代码审阅或单测）。
- [ ] **Step 2:** 手动 OLED Demo：灯亮灭 + 面板 state 同向。
- [ ] **Step 3:** Grep 无新 `type === 'led'` 于 Workbench（断线调试钩子除外）。

---

### Task 6.3: 文档与出口

- [ ] `04-adding-a-peripheral.md` LED 行注明「① 为主，③ 可选已实现」。
- [ ] 勾选 roadmap M6；若 M0–M6 均完成，roadmap 状态 → ✅ 已完成。

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| gpio 未进 actuatorOutputs | 最小镜像修复；单测锁行为 |
| 面板与电路不一致 | 同源脚号；quality 暂不引入 |
| unit 类型不匹配 | 编译期修正联合类型 |

**回滚：** 删除 LED `actuatorObserve` / converter；保留 M2 ui bind。

---

## 7. 套件收尾 Checklist（M6 后）

- [x] tech-design / ADR / roadmap 状态一致
- [x] `architecture-data-plane` offenders = `[]`
- [x] 无「4 种观测」歧义（`04-adding-a-peripheral` 已固定 3 出 + 1 入）
- [x] 新增外设 Checklist（方向→通道→Raw）可独立走通电机/LED 案例
- [x] 避障距离滑块端到端（人工已确认）
- [x] `SimActuatorPanel` LED `on`/`off` 与电路同向（人工已确认）

---

## 8. 文档变更记录

- 2026-07-12：初稿。
- 2026-07-12：并行 worktree 实施并合并；LED ①+③ 并存；全量回归见 roadmap。
- 2026-07-12：套件收尾 Checklist 勾选；OLED 按键控灯人工确认（电路 ①）；`SimActuatorPanel` LED state 为可选补看。
- 2026-07-12：人工确认「电路」tab 底部 Actuator Observations 中 LED `on`/`off` 与画布亮灭同向（①+③ 并存）。
