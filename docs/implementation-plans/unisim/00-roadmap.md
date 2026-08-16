# 仿真数据面分层重构 — 实施路线图（Roadmap）

> **For agentic workers:** 本文件是套件入口。按阶段顺序打开对应 `mN-*.md` 执行；阶段之间必须通过出口门禁后再进入下一阶段。REQUIRED SUB-SKILL：`superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。

**Goal:** 把 Workbench 仿真 I/O 收敛为固定口径——**输出观测 3 通道（① Pin Mirror / ② Display Payload / ③ Actuator Observation）+ 输入注入 1 通道（④ Ideal Inject）**——并完成外设插件化，使「新增同构外设」零改宿主 `type ===` 特判。

**Architecture:** 分层统一（S3），不是通道合并。宿主只做总线；外设包声明 `ui.*` / `simulation.inject` / `observeDisplay` / `actuatorObserve`；Worker 只认 Raw 形态（`gpio` / `pwm` / `fb` / `semantic`）。

**Tech Stack:** Vue 3 + TypeScript + Vitest + ESLint（`embedded-frontend`）；文档层 ADR + Layer ① 回写。

## Global Constraints

- **计数口径：** 禁止写「4 种观测」；正确说法是「3 出 + 1 入 = 4 条数据面」。
- **不删除** `pinStates` / `oledFb`（本套件全程）。
- **不把** framebuffer 塞进 `ActuatorObservation`；**不把** ④ 传感器包装成 ③。
- **Ideal Inject ≠ 写输出 Raw**（见 tech-design §2.2）。
- **引脚解析安全化：** 消费 ① `pinStates` 必须通过 Helper 函数（如 `isPinHigh(state)`）解析，禁止外设直接访问布尔值，为引脚多态化（高阻态/模拟电平）预留兼容空间。
- **输入注入时钟对齐：** 输入注入 ④ 必须在 Worker 内与仿真时钟（`simTimeUs`）对齐排队生效，支持确定性仿真回放。
- **状态化转换器：** ③ 转换器注册表必须支持持久状态（如传入上一次 Observation 或 stateStore），以实现电机等动态外设物理惯性（加减速）的轻量级仿真。
- **显示载荷传输优化：** 预留 Transferables 零拷贝机制与脏矩形增量更新，Worker 内置 30Hz 频控，防止高帧率带来主线程阻塞。
- **静态依赖强护栏：** 严禁外设包直连 `simulation-client`、Wasm 实例或全局 `window` 状态，架构测试需进行 AST/依赖树扫描验证（禁止使用 `/* eslint-disable */` 绕过）。
- 每阶段结束：`cd ../../../../../wink-ai/packages/embedded-frontend && bun run test` 全绿；涉及 lint 规则的阶段额外 `npm run lint`。
- 本套件**默认不改** `wink-micro-os` C 导出（M5 电机复用既有 PWM Raw）；仅当评审批准新 Raw 态时才扩 Worker/Wasm。
- 提交原子化：英文 commit message；一次 commit 聚合一个逻辑模块。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **套件编号** | `PLAN-20260712-SIM-OBS-LAYERS` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ M0–M6 出口已通过（人工演示均已确认） |
| **优先级** | 🟡 P1（可维护性 / 架构纪律；不阻塞现有 OLED / 避障演示） |
| **关联技术设计** | [`../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md`](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md)（Accepted） |
| **关联评审** | [`../../reviews/unisim/2026-07-12-sim-observation-layers-review.md`](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)（Accepted） |
| **关联 ADR** | [`../../decisions/unisim/0027-sim-observation-data-planes.md`](../../decisions/unisim/0027-sim-observation-data-planes.md)（ADR-0027 Accepted） |
| **前置依赖** | Phase 1 舵机观测已交付：[`../2026-07-11-avoidance-car-phase1-servo-observe-plan.md`](../core/2026-07-11-avoidance-car-phase1-servo-observe-plan.md) |
| **验证外设矩阵** | LED / OLED / 按钮 / 超声 / 舵机 / 电机 stub |

---

## 2. 目录索引

| 文件 | 阶段 | 一句话 | 验证外设 | 风险 |
|------|------|--------|----------|------|
| [`00-roadmap.md`](./00-roadmap.md) | — | 本文件 | — | — |
| [`m0-adr-and-docs.md`](./m0-adr-and-docs.md) | **M0** | Accepted → ADR → 回写 Layer ① + 通道选型 Checklist | — | 低 |
| [`m1-contract-and-guardrails.md`](./m1-contract-and-guardrails.md) | **M1** | 契约文档化 + glyph 直读 runtime 护栏（可先 warn） | — | 低 |
| [`m2-ui-bind-pluginization.md`](./m2-ui-bind-pluginization.md) | **M2** | `definition.ui.*`；删除 `bind*` 的 `switch(type)` | LED、OLED、舵机 | 中 |
| [`m3-inject-pluginization.md`](./m3-inject-pluginization.md) | **M3** | `simulation.inject`；去掉 Workbench 超声/按钮特判 | 按钮、超声波 | 中 |
| [`m4-observe-semantic-purity.md`](./m4-observe-semantic-purity.md) | **M4** | `observeDisplay` 取代 I2C→oled 耦合；清理假 observe | OLED、超声 | 低 |
| [`m5-motor-channel3.md`](./m5-motor-channel3.md) | **M5** | 电机 stub 接 ③；**零改 Worker** | 电机 | 中 |
| [`m6-led-optional-channel3.md`](./m6-led-optional-channel3.md) | **M6** | LED 可选 `gpio_to_state`；电路仍用 ① | LED | 低 |

---

## 3. 推荐执行顺序

```text
M0 → M1 → M2 → M3 → M5 → (M4 ∥ M6)
```

| 顺序理由 | 说明 |
|----------|------|
| M0 先于一切代码 | 技术设计 + ADR-0027 须 Accepted；无权威则不得开 M1 护栏代码 |
| M1 先于 M2 | 护栏与文档先落地，M2 改绑定时有失败信号 |
| M2 先于 M3 | UI 消费面先插件化，再收注入；避免 Workbench 同时大改 |
| M5 先于 M4/M6 | 用「加电机」证明 ③ 路径宿主零特判（设计 §13.7 推荐） |
| M4 ∥ M6 | 互不依赖；可并行 |

**硬门禁：** 未完成 M0 出口，不得开始 M1 代码 Task（文档草稿 Task 除外）。

---

## 4. 跨阶段成功标准（套件级）

完成 M0–M6 后，下列命题必须为真：

1. 文档与 ADR 固定口径：**输出 3 + 输入 1**。
2. `bindCanvasProps` / `bindWorldProps` **无** `switch(comp.type)`；改为 `def.ui?.canvasProps?.(comp, ctx)`。
3. `EmbeddedWorkbench` / `syncIdleGpioFromComponents` **无新增** `type === 'button'|'ultrasonic'|…` 特判；注入走 `runInject` / `runInjectIdle`。
4. `oled/CanvasGlyph.vue`、`servo/CanvasGlyph.vue` **不** `import` `simulation-runtime` 的数据面 ref（经 binder 传 props）。
5. 新增同构 ③ 执行器（以电机为证）：不改 Worker、`simulation-client` 协议分支、`EmbeddedWorkbench`。
6. 电路视窗仍可读 ① `pinStates`；OLED 仍走 ②；按钮/超声走 ④。

---

## 5. 今日摩擦 → 阶段映射

| 摩擦（tech-design §13.2） | 收敛阶段 |
|---------------------------|----------|
| `bind*` `switch(type)` | M2 |
| glyph 直读 `oledFb` / `actuatorObservations` | M1 护栏 → M2 消除 |
| Workbench 按钮/超声 inject 特判 | M3 |
| `syncIdleGpioFromComponents` 认 `button` | M3 |
| Worker `hasOled` / `watchI2C→oled` | M4 |
| `watchUltrasonic` 被忽略（假 observe） | M4（清理）+ M3（真 inject） |
| 电机 stub 无 observe/converter | M5 |
| LED 无 ③、进面板要改宿主 | M6 |

---

## 6. 非目标（整套套件）

1. 不实现 W3c 完整 `setIdealInputs` 时间戳队列（可在 M3 留适配点；细节属 W3c 计划）。
2. 不实现多屏 `displayOutputs` Transferable 完整 API（M4 可留类型扩展点）。
3. 不收敛 `ActuatorObservation.value` 的 `any[]`（Phase 2 / 舵机计划 §10.4）。
4. 不引入 3D ActuatorMirror / Rapier（属 W3b）。
5. 不修改 `wink-micro-app/avoidance_car` 业务逻辑（除非 M5 明确需要模板挂电机——默认不改 App）。

---

## 7. 阶段出口速查

| 阶段 | 出口一句话 |
|------|------------|
| M0 | ADR Accepted + Layer ① / `04-adding-a-peripheral` 含「方向→通道→Raw」 |
| M1 | 架构测或 ESLint 能抓 glyph 直读；频道纪律可引用 |
| M2 | LED/OLED/舵机经 `ui.bind`；`bind*` 无 type switch |
| M3 | 按钮/超声 inject 在 definition；Workbench 无对应 type 特判 |
| M4 | `observeDisplay` 生效；假 `watchUltrasonic` 观察语义清除 |
| M5 | 电机产出 `angular_velocity` Observation；Worker diff 为空（或仅注释） |
| M6 | LED 可选出现在 `SimActuatorPanel`；电路仍读 ① |

---

## 8. 文档变更记录

- 2026-07-12：初稿 — 套件目录 + M0–M6 路线图（对齐 tech-design §13.7）。
- 2026-07-12：M0 出口通过 — 计划状态 → 执行中；关联 ADR-0027 / 评审 / 技术设计均为 Accepted。
- 2026-07-12：M1 出口通过 - 架构护栏与模板/文档提示完成；全量回归 `cd ../../../../../wink-ai/packages/embedded-frontend && bun run test` 通过（53 files / 246 tests）。
- 2026-07-12：M2 代码出口通过 — `bind*` 无 `switch(type)`；glyph 零直读 runtime；护栏升 `error`；全量回归 249 tests 绿。A5 人工演示待勾选。
- 2026-07-12：M3 代码出口通过 — 按钮/超声 inject 迁入 `definition.simulation.inject`；`EmbeddedWorkbench` 无 `type === 'ultrasonic'`；`syncIdleGpioFromComponents` 薄封装 `runInjectIdle`；全量回归 55 files / 264 tests 绿。已知非插件化调试钩子：`toggleWireBreak` 仍 `type === 'led'`。A5 人工浏览器演示待确认。
- 2026-07-12：M3 A5 部分确认 — OLED 按键控灯人工通过；避障距离滑块延后至套件收尾再测。进入 M5（电机通道 ③）。
- 2026-07-12：M5 代码出口通过 — 电机 stub 双 PWM → `angular_velocity` Observation；A1 宿主零改 diff 空（`simulation-client.ts` 会话重置属允许改动）；Task 5.4 模板挂载默认跳过；全量回归 55 files / 266 tests 绿。进入 M4 ∥ M6。
- 2026-07-12：M4 ∥ M6 并行完成并合并 — M4：`watchDisplay` / `displayKinds` / FB 30Hz+Transferable+dirty；超声假 observe 已删。M6：LED 可选 ③ `gpio_to_state`（① `pinStates` 仍为电路 SSOT）。合并后全量回归 57 files / 278 tests 绿。人工演示待确认：OLED 屏刷新、LED 面板 state、避障距离滑块（M3 延后项）。
- 2026-07-12：套件收尾 — 人工确认 OLED 按键控灯（含屏刷新路径）在 M4/M6 合并后仍正常；`architecture-data-plane` offenders=`[]`；roadmap / `04-adding-a-peripheral` 口径已与 ADR-0027 对齐。避障距离滑块仍为可选补测。
- 2026-07-12：人工确认 Actuator Observations 中 LED `on`/`off` 与电路亮灭同向（M6 A4）。
- 2026-07-12：避障距离滑块端到端人工通过；修复 Simulate 下 Ideal Inject 滑块误禁用；套件人工演示项全部勾选。

