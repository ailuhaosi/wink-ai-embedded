# M0 — ADR 与设计规范回写

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。Steps 使用 checkbox。**本阶段无业务代码变更**；未完成出口前不得开始 M1 护栏代码。

**Goal:** 将技术设计从 Draft 提升为可执行权威：评审 Accepted、独立 ADR、回写 Layer ①，并在外设作者指南中强制「方向 → 通道 → Raw」。

**Architecture:** ADR 记录 S3（分层统一）决策；Layer ① 与 `04-adding-a-peripheral.md` 成为日常 SSOT；实施套件其余阶段引用本 ADR 编号。

**Tech Stack:** Markdown / ADR 模板（`.claude/rules/docs-adr.md`）。

## Global Constraints

- 继承 [`00-roadmap.md`](./00-roadmap.md) Global Constraints。
- ADR 编号：仓库当前最高为 `0026`；本阶段使用 **`0027`**（若并行分支已占用则顺延并更新本文件与 roadmap 链接）。
- **禁止**在本阶段修改 `../../../../../wink-ai/packages/embedded-frontend/src/**`（除文档外）。
- 技术设计 Q1–Q12 建议默认值全部采纳，除非评审纪要明确否决。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M0` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 已完成（出口 A1–A6 通过） |
| **优先级** | 🔴 P0（阻塞 M1+） |
| **前置依赖** | 无（套件起点） |
| **后继** | [`m1-contract-and-guardrails.md`](./m1-contract-and-guardrails.md) |
| **关联技术设计** | [`../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md`](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md) |
| **关联设计规范** | [`../../05-frontend-workbench/01-frontend-workbench-architecture.md`](../../design/05-frontend-workbench/01-frontend-workbench-architecture.md)、[`../../05-frontend-workbench/04-adding-a-peripheral.md`](../../design/05-frontend-workbench/04-adding-a-peripheral.md)、[`../../05-frontend-workbench/03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md`](../../design/05-frontend-workbench/03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md)、[`../../05-frontend-workbench/03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md`](../../design/05-frontend-workbench/03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md) |

---

## 2. 背景与目标

### 2.1 问题

技术设计已写清 3 出 + 1 入与 M1–M6 重构方向，但状态仍为 **Draft**。无 ADR / Layer ① 回写时，外设作者与后续实施计划缺乏权威引用，易与「万物 Observation」或「废除 pinStates」等错误方向漂移。

### 2.2 目标

- ✅ 技术设计状态 → **Accepted**
- ✅ ADR-0027 Accepted，标题含「数据面分层：3 出 + 1 入」
- ✅ `04-adding-a-peripheral.md` 新增强制「方向 → 通道 → Raw」章节
- ✅ Workbench 架构规范至少增加一节指向本 ADR 与四通道速查

### 2.3 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | 技术设计状态 | 头部「状态」为 **Accepted**（或评审纪要明确 Accepted + 链接） |
| A2 | ADR 存在且 Accepted | `docs/decisions/unisim/0027-sim-observation-data-planes.md`（或顺延编号）状态 Accepted |
| A3 | 外设指南 | `04-adding-a-peripheral.md` 含决策流程图或等价表（①②③④） |
| A4 | Layer ① 回写 | `01-frontend-workbench-architecture.md`（或等价章节）链到 ADR-0027 |
| A5 | 口径检查 | 上述新文档全文无「4 种观测」歧义表述 |
| A6 | 套件互链 | tech-design「关联实施计划」指向本目录 |

---

## 3. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `docs/tech-designs/unisim/2026-07-12-sim-observation-layers-design.md` | ✏️ | 状态 → Accepted；补关联 ADR / 实施计划 |
| `docs/decisions/unisim/0027-sim-observation-data-planes.md` | 🆕 | ADR 正文 |
| `docs/design/05-frontend-workbench/04-adding-a-peripheral.md` | ✏️ | 新增通道选型强制章节 |
| `docs/design/05-frontend-workbench/01-frontend-workbench-architecture.md` | ✏️ | 数据面分层回写 |
| `docs/reviews/unisim/2026-07-12-sim-observation-layers-review.md` | 🆕（可选） | 若评审意见不写在 tech-design 头部 |
| `docs/implementation-plans/unisim/00-roadmap.md` | ✏️ | 状态 → 执行中；填 ADR 链接 |

---

## 4. Tasks

### Task 0.1: 评审勾选与状态翻转

**Files:**
- Modify: `docs/tech-designs/unisim/2026-07-12-sim-observation-layers-design.md`

- [ ] **Step 1: 确认 Q1–Q12**

在 tech-design §12 / §13.9 将建议默认值落实为评审结论（全部「是」，除非决策者否决并批注理由）。

- [ ] **Step 2: 更新头部元数据**

```markdown
| 状态 | **Accepted（已采纳）** |
| 关联 ADR | [`ADR-0027`](../../decisions/unisim/0027-sim-observation-data-planes.md) |
| 关联实施计划 | [`../implementation-plans/2026-07-12-sim-observation-layers/`](./00-roadmap.md) |
```

- [ ] **Step 3: 勾选 §11 验收标准** 全部为是。

- [ ] **Step 4: Commit（可选，若用户要求提交）**

```bash
git add docs/tech-designs/unisim/2026-07-12-sim-observation-layers-design.md
git commit -m "$(cat <<'EOF'
docs: accept sim observation layers tech design

EOF
)"
```

---

### Task 0.2: 撰写 ADR-0027

**Files:**
- Create: `docs/decisions/unisim/0027-sim-observation-data-planes.md`

- [ ] **Step 1: 按 docs-adr 模板创建 ADR**

必含章节：背景、方案比选（S0–S4，选定 S3）、决策结论、后果与约束、遵循与后续、状态变更日志。

**决策结论必须写明：**

1. 输出观测恰好 3 种（①②③）；输入注入恰好 1 种（④）；合计 4 条数据面。
2. 「统一」= 消费纪律与演进方向，不是删除通道。
3. 电路视窗永久允许读 ①；执行器面板 / ActuatorMirror 只读 ③。
4. LED：① 为主、③ 可选增强（不强制立刻迁）。
5. 灯带 `pixel_colors` ∈ ③；OLED FB ∈ ②（语义色 ≠ 显示 FB）。
6. 外设成功标准：同构 ③/②/④ 新增时宿主零 `type` 特判（P1–P6）。
7. 多态引脚安全兼容：使用 `isPinHigh` 包装对 ① `pinStates` 的直接读取。
8. 确定性仿真时序：支持 `timestampUs` 在 Worker 排队，与 `simTimeUs` 步进对齐生效。
9. 物理惯性仿真：转换器上下文支持传入 `stateStore` 和 `lastObservation` 以满足状态化转换。
10. 显示载荷优化：支持 display Transferables 零拷贝传输、脏矩形过滤与 Worker 30Hz 频控。
11. 静态依赖防越界：外设包禁止直连 `simulation-client`，架构测试必须通过扫描进行拦截。

- [ ] **Step 2: 状态设为 Accepted**（与 tech-design 同日或紧随）

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/unisim/0027-sim-observation-data-planes.md
git commit -m "$(cat <<'EOF'
docs(adr): accept 0027 sim observation data planes (3 out + 1 in)

EOF
)"
```

---

### Task 0.3: 回写 `04-adding-a-peripheral.md`

**Files:**
- Modify: `docs/design/05-frontend-workbench/04-adding-a-peripheral.md`

- [ ] **Step 1: 在「复制脚手架」之前插入新章节**（建议编号为 `§0.5` 或独立 `§1` 并顺延后文章节）

章节标题建议：`仿真数据面：先选通道再写代码`。

**必须包含：**

1. 计数口径表（3 出 + 1 入）。
2. tech-design §6.1 决策流程图（可精简复制）。
3. 外设类型速查表（LED / 按钮 / OLED / 舵机 / 电机 / 超声）。
4. 禁止清单（宿主 `type ===`、glyph 直读 runtime、FB 进 Observation、④ 装成 ③）。
5. 链接 ADR-0027 与本套件 roadmap。

- [ ] **Step 2: 全文搜索** `4 种观测` / `第四种观测` — 确保零命中（或仅出现在「禁止说法」例句中并标明错误）。

- [ ] **Step 3: Commit**

```bash
git add docs/design/05-frontend-workbench/04-adding-a-peripheral.md
git commit -m "$(cat <<'EOF'
docs: require channel selection before adding peripherals

EOF
)"
```

---

### Task 0.4: 回写 Workbench 架构规范

**Files:**
- Modify: `docs/design/05-frontend-workbench/01-frontend-workbench-architecture.md`

- [ ] **Step 1: 增加「仿真数据面分层」小节**

内容要点（可短）：

- Worker + `STATE_UPDATE` 共用，消费契约分层。
- ① `pinStates` / ② display FB / ③ `actuatorObservations` / ④ Ideal Inject。
- 链到 ADR-0027、W3b、W3c、本套件 roadmap。

- [ ] **Step 2: 在 W3b / W3c 相关处各加一句交叉引用**（避免与「统一 Observation」表述冲突）。

- [ ] **Step 3: Commit**

```bash
git add docs/design/05-frontend-workbench/01-frontend-workbench-architecture.md
git commit -m "$(cat <<'EOF'
docs: backport ADR-0027 data-plane layering into workbench architecture

EOF
)"
```

---

### Task 0.5: 更新套件 roadmap 状态

**Files:**
- Modify: `docs/implementation-plans/unisim/00-roadmap.md`

- [ ] **Step 1:** 计划状态 → `🔄 执行中`；填入 ADR 实际路径。
- [ ] **Step 2:** 确认 tech-design ↔ roadmap 双向链接完整。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 评审否决 Q 项 | 在 ADR「后果」记录否决项；调整 M2–M6 范围后再执行 |
| ADR 编号冲突 | 顺延编号并全局替换本套件链接 |
| Layer ① 文件结构与预期不符 | 优先改 `04-adding-a-peripheral.md`；架构总览可加附录 |

**回滚：** 删除 ADR 或将状态改回 Proposed；tech-design 改回 Draft。无代码回滚。

---

## 6. 文档变更记录

- 2026-07-12：初稿。

