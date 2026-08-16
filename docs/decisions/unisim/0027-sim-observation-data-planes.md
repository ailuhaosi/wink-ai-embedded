# ADR-0027：仿真数据面分层：3 出 + 1 入

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-12（Proposed）／ 2026-07-12（Accepted） |
| 触发 | 技术设计评审 [2026-07-12 评审报告](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)（综合评分 9.2/10，Q1–Q12 全部采纳）；前置见 [Phase 1 舵机观测评审](../../reviews/core/2026-07-12-avoidance-car-phase1-servo-observe-review.md) |
| 影响范围 | `05-frontend-workbench/01-frontend-workbench-architecture.md`、`05-frontend-workbench/04-adding-a-peripheral.md`、`../../../../wink-ai/packages/embedded-frontend/src/peripherals/**`、`../../../../wink-ai/packages/embedded-frontend/src/workers/wasm-simulation.worker.ts`、`../../../../wink-ai/packages/embedded-frontend/src/services/simulation-runtime.ts` |
| 决策者 | 架构师（技术设计 Accepted 后据 Q5 结论落盘本 ADR） |

---

## 背景（Context）

Workbench 与 `wink-micro-os` Wasm **底层共用** Worker + `STATE_UPDATE` 通道，但历史上前端逐步长出了两套并行的输出消费路径：

| Demo | 闭环 | 输出消费 |
|------|------|----------|
| `oled_dashboard` | 按钮按下 → 固件写 LED / 刷 OLED | UI 直接读 `pinStates` / `oledFb` |
| `avoidance_car` Phase 1 | 超声距离 → 固件控舵 → PWM duty | Mapper → `ActuatorObservation` |

两者都经同一 Worker / Wasm / `STATE_UPDATE`，但**前端输出语义契约不同**，且按钮、超声等输入激励在部分文档/讨论中被误称为「第四种观测」，与「输出 3 种」口径冲突。

若不规范，存在以下风险：

1. 新外设插件随意绑 `pinStates` 或 Observation，3D / 面板出现双绑定或漏绑定。
2. 把 OLED framebuffer 硬塞进 `ActuatorObservation` → 类型膨胀为杂物袋。
3. 为求「干净」而废除 `pinStates` → 电路调试、PinArbiter、故障可视化失去脚级真相。
4. LED 永远只读 `pinStates`、舵机只读 Observation → 统一执行器面板/未来 ActuatorMirror 无法统一驱动「灯 + 轮 + 舵」。
5. 文档把 ④ 说成「第四种观测」→ 与「输出 3 种」口径冲突，评审与实现各说各话。

技术设计 [`2026-07-12-sim-observation-layers-design.md`](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md)（§0、§5 S0–S4、§11–§13）已就此提出固定计数口径与分层方案，并经 [评审](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md) Accepted（Q1–Q12 全部采纳建议默认值，无否决项）。本 ADR 依据该技术设计与评审结论，正式确立架构决策。

---

## 方案比选（Options，S0–S4，选定 S3）

| 方案 | 描述 | 结论 |
|------|------|------|
| **S0 维持现状、无规范** | 两套路径并存，文档不约束 | ❌ 不可接受 |
| **S1 全部并入 Observation** | 废除 `pinStates` / `oledFb`，万物皆 Observation | ❌ 过统一，损失脚级真相与显示语义 |
| **S2 全部退回 pinStates** | 舵机也用脚电平 + UI 猜角度 | ❌ 无法支撑 W3b 物理/执行器面板 |
| **S3 分层统一（选定）** | **输出 3 通道**（① Pin Mirror / ② Display Payload / ③ Actuator Observation）长期共存 + **输入 1 通道**（④ Ideal Inject）；消费纪律按层；执行器语义以 ③ 为 SSOT | ✅ **选定** |
| **S4 仅文档、永不迁 LED** | ③ 只服务舵机/电机；灯永远只 ① | ⚠️ 可作过渡，3D 灯会痛；不作为最终方案 |

**选定 S3 的理由（摘自技术设计 §5.2）：**

1. 输出观测恰好 3 种，对应三种信息形态（脚电平 / 显示块 / 物理量）；另有 1 种输入注入；合计 4 条数据面。强行把输出并成一种会损失表达力或调试力。
2. W3b 已选定 Observation（③）驱动未来 ActuatorMirror；① 仍是电路 SSOT；④ 由 W3c 演进，不并入观测。
3. 「统一」指纪律与演进方向，不是删除通道，也不是把 ④ 改名叫「第四种观测」。

---

## 决策结论（Decision）

1. **输出观测恰好 3 种（①②③）；输入注入恰好 1 种（④）；合计 4 条数据面。** 全文（含本 ADR 及所有回写文档）禁止「4 种观测」之类歧义表述；正确说法是「3 种输出观测 + 1 种输入注入 = 4 条数据面」。
2. **「统一」= 消费纪律与演进方向，不是删除通道。** 统一的是执行器面板/3D 的消费契约（收敛到 ③）、外设声明方式（observe / actuatorObserve / inject）、`deviceComponentId` / `simTimeUs` 等横切约定；**不**统一传输层 Raw 形态（仍可有 `pwm`/`gpio`/`fb`/`semantic` 多种），也不要求 OLED 装成执行器或 ④ 装成观测。
3. **电路视窗永久允许读 ① `pinStates`；执行器面板 / 未来 ActuatorMirror 只读 ③ `actuatorObservations`。** 3D ActuatorMirror / 执行器语义面板禁止以 `pinStates` 作为唯一 SSOT。
4. **LED：① 为主、③ 可选增强（不强制立刻迁）。** LED 插件可暂只绑 `pinStates`（现状允许）；若要进统一执行器面板，须同时或改为声明 `actuatorObserve`（`gpio_to_state`）。
5. **灯带 `pixel_colors` ∈ ③；OLED FB ∈ ②（语义色 ≠ 显示 FB）。** 禁止把 framebuffer 塞进 `ActuatorObservation.value` 作为长期方案；显示插件只读 Display Payload，不读 Observation 冒充像素。
6. **外设成功标准：同构 ③/②/④ 新增时宿主零 `type` 特判（P1–P6）。** 新增同构执行器（③，如蜂鸣器/单路电机）不改 Worker、`simulation-client`、`bind*`、`EmbeddedWorkbench`；同构显示（②）同上；同构输入（④，如新滑块传感器）`EmbeddedWorkbench` 无新 `type ===`，只走 `syncIdealInputs`。
7. **多态引脚安全兼容：使用 `isPinHigh` 包装对 ① `pinStates` 的直接读取。** `pinStates` 现阶段以 `boolean` 传输以保证效率，但消费侧（LED、电路视窗等）必须经封装 Helper（如 `isPinHigh(state)`）解析，为后续升级到 `PinSignalState`（含 `voltage` / `mode` / `pull`）结构预留兼容空间；禁止直接对布尔值做裸判断。
8. **确定性仿真时序：支持 `timestampUs` 在 Worker 排队，与 `simTimeUs` 步进对齐生效。** 输入注入（④）不得依赖异步主线程 JS 事件循环延迟；`setIdealInputs`（及过渡期 `SET_PIN_IDEAL` 等）payload 支持可选 `timestampUs?: string`；Worker 接收后压入事件队列，在 `step()` 循环内按当前 `simTimeUs` 弹出符合时间戳的事件写入 Wasm，确保重放时序确定性。
9. **物理惯性仿真：转换器上下文支持传入 `stateStore` 和 `lastObservation` 以满足状态化转换。** ③ 的 Raw→Semantic converter 注册表必须支持持久状态输入（上一次 `ActuatorObservation` 或独立 `stateStore`），以支撑电机等动态外设的加减速等物理惯性轻量仿真，无需在 Worker 侧引入额外状态。
10. **显示载荷优化：支持 display Transferables 零拷贝传输、脏矩形过滤与 Worker 30Hz 频控。** Worker 发送 `STATE_UPDATE` 时应将各 display framebuffer 对应的 `ArrayBuffer` 作为 Transferable Objects 传递以实现零拷贝；预留脏矩形（dirty-rect）增量更新与 Worker 内置 30Hz 频控，防止高频/高分辨率显示带来主线程阻塞或掉帧。
11. **静态依赖防越界：外设包禁止直连 `simulation-client`，架构测试必须通过扫描进行拦截。** `src/peripherals/<type>/` 目录下代码禁止直接 `import` `simulation-runtime` / `simulation-client` / Wasm 实例或全局 `window` 状态；所有运行态信息只能通过 `SimViewContext` / `InjectContext` 获取；须引入 AST/依赖树静态扫描（如 dependency-cruiser 或自定义 ESLint 规则）作为架构测试强制拦截，禁止使用 `/* eslint-disable */` 之类手段绕过。

---

## 后果与约束（Consequences & Constraints）

- **不删除现有通道**：`pinStates` / `oledFb` 在本 ADR 及后续 M0–M6 全套实施期内不被删除，也不要求 OLED Demo 立刻迁到 Observation（见技术设计 §9 非目标）。
- **外设作者纪律收紧**：新增外设必须先标明「方向（入/出）→ 主通道（①/②/③/④）→ Raw 形态」三步（技术设计 §13.6 Checklist），违反将在架构测试/评审中被拦截。
- **架构护栏工作量**：决策 11 需要引入静态依赖扫描工具链（M1 阶段），对现有 CI/lint 配置有增量工作量，但风险低。
- **确定性时序与状态化转换器（决策 8、9）需要 Worker 侧新增队列与 converter 上下文扩展**，属 M3/M5 阶段实施范围，本 ADR 只确立契约方向，不要求立即改代码。
- **显示传输优化（决策 10）为渐进增强**，多屏/彩色屏能力可后续按需扩展（M4 及以后），当前单屏 `oledFb` 路径继续有效。
- **文档一致性**：所有引用本领域的设计规范、实施计划、评审记录必须统一使用「3 出 + 1 入 = 4 条数据面」口径，不得出现「4 种观测」等歧义表述。

## 遵循与后续（Compliance & Follow-up）

- 📋 **Layer ① 回写**：本 ADR Accepted 后，须将决策 1–11 的核心结论回写至 [`05-frontend-workbench/01-frontend-workbench-architecture.md`](../../design/05-frontend-workbench/01-frontend-workbench-architecture.md)（数据面分层的架构级描述）与 [`05-frontend-workbench/04-adding-a-peripheral.md`](../../design/05-frontend-workbench/04-adding-a-peripheral.md)（新增「通道选择」强制小节：先分入/出，再选 ①②③/④，对齐技术设计 §13.6 Checklist）。回写属 M0 出口门禁的一部分，由后续任务（implementation-plans 套件 M0 内）跟进落地。
- 📋 **实施计划跟进**：决策 6–11 的具体代码级落地由 [`implementation-plans/2026-07-12-sim-observation-layers/00-roadmap.md`](../../implementation-plans/unisim/00-roadmap.md)（M0–M6）分阶段执行；M1 契约文档化与护栏、M2 UI bind 插件化、M3 Inject 插件化与确定性队列、M4 Observe 语义纯化、M5 电机接 ③（验证零改宿主）、M6 LED 可选 ③。
- 📋 **关联文档**：
  - 技术设计：[`tech-designs/2026-07-12-sim-observation-layers-design.md`](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md)（§0 计数口径、§5 方案比选、§11–§13 验收标准与外设可维护性）
  - 评审记录：[`reviews/2026-07-12-sim-observation-layers-review.md`](../../reviews/unisim/2026-07-12-sim-observation-layers-review.md)（综合评分 9.2/10，Q1–Q12 结论）
  - 前置评审：[`reviews/2026-07-12-avoidance-car-phase1-servo-observe-review.md`](../../reviews/core/2026-07-12-avoidance-car-phase1-servo-observe-review.md)
  - 实施计划套件：[`implementation-plans/2026-07-12-sim-observation-layers/00-roadmap.md`](../../implementation-plans/unisim/00-roadmap.md)
- ✅ 技术设计头部「关联 ADR」已更新为直接引用本文档（Accepted，2026-07-12）。

---

*本 ADR 状态变更请在此记录：*
- 2026-07-12：Proposed（技术设计评审 Accepted 触发，依据 Q5 结论开立本 ADR）。
- 2026-07-12：Accepted。决策 1–11（3 出 + 1 入计数口径、统一即纪律非删除、电路视窗/执行器面板消费边界、LED 渐进迁移、灯带/OLED 通道归属、外设零特判成功标准、多态引脚兼容、确定性时序队列、状态化转换器、显示传输优化、静态依赖防越界）全部确立为正式架构决策；Layer ① 回写与代码级落地转入 `implementation-plans/2026-07-12-sim-observation-layers/` 套件 M0–M6 跟进。

