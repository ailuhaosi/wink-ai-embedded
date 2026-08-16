# M4 — Observe 语义纯化（Display / 清理假 Observe）

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。**前置：M3 建议已完成**（超声真路径已是 inject）。可与 M6 并行。

**Goal:** 用显式 `observeDisplay` 表达 ② Display Payload 需求，取代「`watchI2C` ⇒ `oled: true`」耦合；清理超声波无效的 `watchUltrasonic` 观察语义；Worker 改为认 `displayKinds[]`（或等价通用字段），禁止 per-type 字符串膨胀。

**Architecture:** ObserveBuilder 增加 `watchDisplay(kind)`；`ObserveResult` 产出 `displayKinds: string[]`（含 `ssd1306_fb`）；Worker 见 `ssd1306_fb` 再采 FB。I2C 观察若仍需调试，与 display 解耦。

**Tech Stack:** TypeScript、Vitest、`wasm-simulation.worker.ts`。

## Global Constraints

- 继承 roadmap。
- **禁止**把 FB 写入 Observation。
- 本阶段可不实现多屏 `displays` map / Transferable（留类型扩展注释即可）。
- **零**新增 `type === 'oled'` 字符串于 Worker。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M4` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 出口已通过（OLED 按键控灯人工确认） |
| **优先级** | ⚪ P2（语义纯化；功能已可用） |
| **前置依赖** | M3（强建议）；至少 M2 |
| **验证外设** | OLED、超声波 |

---

## 2. 现状问题

| 机制 | 问题 |
|------|------|
| `ObserveBuilderImpl.build()`: `oled: this.i2cConfigs.length > 0` | I2C ≠ 显示通道；未来非 OLED 的 I2C 器件会误开 FB 采集 |
| Worker `hasOled` | 布尔特例，扩展性差 |
| `ultrasonic` `watchUltrasonic` | Worker 侧配置被忽略；与 ④ inject 重复/误导 |

---

## 3. 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | OLED 声明 | `oled/definition` 使用 `observeDisplay` 或 `builder.watchDisplay('ssd1306_fb')`；不再依赖「有 I2C 就 oled」 |
| A2 | Builder | `oled` 标志仅由 display 声明产生；纯 `watchI2C` 不置 `oled: true` |
| A3 | Worker | 采集 FB 条件基于 display kind / 通用字段；无新 per-type 分支 |
| A4 | 超声 | definition 移除或标注废弃 `watchUltrasonic`；inject 仍工作 |
| A5 | 回归 | `npm run test`；OLED Demo 屏刷新正常 |

---

## 4. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/observe-builder.ts` | ✏️ | `watchDisplay`；build 逻辑 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts` | ✏️ | 可选 `observeDisplay` 顶层字段或并入 simulation |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/definition.ts` | ✏️ | 改声明 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts` | ✏️ | 删假 observe |
| `../../../../../wink-ai/packages/embedded-frontend/src/workers/wasm-simulation.worker.ts` | ✏️ | `hasOled` → `displayKinds` |
| `../../../../../wink-ai/packages/embedded-frontend/src/services/simulation-client.ts` | ✏️ | OBSERVE_PINS payload 字段 |
| `../../../../../wink-ai/packages/embedded-frontend/src/types/sim-worker-protocol.ts` | ✏️ | 协议字段 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/observe-builder.test.ts` | ✏️ | |

---

## 5. Tasks

### Task 4.1: ObserveBuilder TDD

**Files:**
- Modify: `observe-builder.ts` + tests

- [ ] **Step 1: 失败测试**

```typescript
it('does not set oled from watchI2C alone', () => {
  const b = new ObserveBuilderImpl();
  b.watchI2C(21, 22);
  expect(b.build().oled).toBe(false);
  expect(b.build().displayKinds ?? []).toEqual([]);
});

it('sets display kind via watchDisplay', () => {
  const b = new ObserveBuilderImpl();
  b.watchDisplay('ssd1306_fb');
  const r = b.build();
  expect(r.displayKinds).toContain('ssd1306_fb');
  expect(r.oled).toBe(true); // 过渡：兼容旧 Worker 布尔，直至 Worker 改完可删
});
```

- [ ] **Step 2: 实现 `watchDisplay(kind: string)`**；`build()`：

```typescript
displayKinds: [...this.displayKinds],
oled: this.displayKinds.includes('ssd1306_fb'), // transitional
oledConfig: this.i2cConfigs[0] ?? null, // I2C 元数据可选保留
```

- [ ] **Step 3: Commit** `feat(observe): add watchDisplay decoupled from I2C`

---

### Task 4.2: OLED definition 切换

**Files:**
- Modify: `oled/definition.ts`

- [ ] **Step 1:** 将现有 `watchI2C` 改为：

```typescript
simulation: {
  observe(comp, builder) {
    const sda = comp.pinConnections.SDA; // 按实际引脚名
    const scl = comp.pinConnections.SCL;
    // 可选：仍声明 I2C 供调试，但不再驱动 oled 标志
    builder.watchI2C(
      typeof sda === 'number' ? sda : null,
      typeof scl === 'number' ? scl : null,
    );
    builder.watchDisplay('ssd1306_fb');
  },
},
```

（引脚名以当前 `oled/definition.ts` 为准。）

- [ ] **Step 2: 更新 observe-builder / oled 相关测试。**
- [ ] **Step 3: Commit** `refactor(oled): declare observeDisplay via watchDisplay`

---

### Task 4.3: Worker / 协议改接与传输优化

**Files:**
- Modify: `sim-worker-protocol.ts`, `wasm-simulation.worker.ts`, `simulation-client.ts`

- [ ] **Step 1:** `OBSERVE_PINS` payload 增加 `displayKinds?: string[]`；保留 `oled?: boolean` 过渡双写一个版本。
- [ ] **Step 2: 传输层与频控优化（30Hz 封顶 + Transferables + 脏标记）**
  - **频控限制**：在 Worker 内使用时间戳限制，对 Display Framebuffer 的采集和 `postMessage` 投递限制在最高 30FPS（约每 33ms 一次），即使仿真 Wasm 执行步频（tick）非常快。
  - **Transferables 零拷贝**：在 Worker 发送 `STATE_UPDATE` 时，将 Framebuffer 的 `ArrayBuffer` 作为第二个参数传递给 `postMessage`，转移其所有权，避免序列化克隆开销。
  - **脏标记（Dirty Check）**：仅在 Framebuffer 内容发生实际变化时才触发 `postMessage` 传输。
- [ ] **Step 3:** Worker：

```typescript
let displayKinds: string[] = [];
// on OBSERVE_PINS:
displayKinds = payload.displayKinds ?? (payload.oled ? ['ssd1306_fb'] : []);
// on step:
const wantFb = displayKinds.includes('ssd1306_fb');
const now = performance.now();
if (wantFb && now - lastDisplayPostMs >= 33 && hasEmscriptenExport(...)) {
  const fb = readWasmFb();
  if (isFbDirty(fb)) {
    const buffer = fb.buffer.slice(0); // 或直接转移 Transferable
    postMessage({ type: 'STATE_UPDATE', oledFb: fb }, [buffer]);
    lastDisplayPostMs = now;
  }
}
```

- [ ] **Step 4: 协议单测更新，断言 Transferable 正常工作且不拷贝。**
- [ ] **Step 5: Commit** `refactor(worker): collect display FB by displayKinds with Transferable and 30Hz throttling`

---

### Task 4.4: 清理超声假 observe

**Files:**
- Modify: `ultrasonic/definition.ts`
- Modify: observe-builder — `watchUltrasonic` 可标 `@deprecated` 或保留空实现供调试脚

- [ ] **Step 1:** 移除 ultrasonic `simulation.observe` 中的 `watchUltrasonic`（inject 已在 M3）。
- [ ] **Step 2:** 若 Worker 仍解析 `ultrasonicConfig` 且无用，停止从 ObserveBuilder 传播或加注释「ignored；use inject」。
- [ ] **Step 3: 更新 `observe-builder.test.ts` / ultrasonic tests。**
- [ ] **Step 4: Commit** `refactor(ultrasonic): remove fake watchUltrasonic observe`

---

### Task 4.5: 回归与文档

- [ ] `npm run test`
- [ ] OLED Demo 目视屏刷新
- [ ] `04-adding-a-peripheral.md` 将 `watchI2C→oled` 说明改为 `watchDisplay`
- [ ] 勾选 roadmap M4

---

## 6. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 过渡期双字段不一致 | client 双写 `oled` + `displayKinds` 一个版本 |
| 非 SSD1306 显示 | 新 kind 需 Worker 通用分支 + 评审（P5） |

---

## 7. 文档变更记录

- 2026-07-12：初稿。
- 2026-07-12：并行 worktree 实施并合并入 `feat/sim-observation-layers`；全量回归见 roadmap。
- 2026-07-12：人工确认 OLED Demo（按键控灯 / 屏刷新路径）在合并后仍正常。
