# UniSim 3.0 Mechanisms 审阅闭环 — 文档补丁 + ADR 提案清单

| 项 | 内容 |
|---|---|
| 文档层级 | ③ 实施计划 |
| 状态 | **Open**（A 档 ✅；B 档 ADR-0053/54/55 **Accepted**；C 档 roadmap 实现待办） |
| 日期 | 2026-08-02 |
| 触发 | mechanisms 01–11 通篇审阅（同刻全序 / UART RX / ISR 延迟 / 浮点确定性等） |
| 关联 | [`04-wasm-simulation/02-mechanisms/`](../../design/04-wasm-simulation/00-README.md) |
| 原则 | **先钉契约与诚实标注**；代码未实现 → **Planned**；方案分叉 → **ADR 提案**；不挡 Wave 3/4 迁入，但挡「高一致」过冲宣称 |

---

## 0. 分层

| 档 | 含义 | 挡 Active？ |
|---|---|---|
| **A. Doc patches** | 勘误 / 钉已实现语义 / Planned 标注 | 本批应完成（契约诚实） |
| **B. ADR 提案** | 有分叉或跨多文件裁决 | Accepted 前不得假装已定；Accepted 后回写 ① |
| **C. Roadmap 实现** | 代码/CI/lint 落地 | 不挡 Migrating→Active 文档门；挡具体「高一致」宣称 |

根 §7 Active 门禁仍须 Wave 3 axes + Wave 4 assurance；本清单补的是**语义缺口诚实化**。

---

## A. 文档补丁（本批执行）

| ID | 项 | 落点 | 状态 |
|---|---|---|---|
| A1 | `memory.yaml` 路径/存在性勘误；禁 malloc → Planned | `05` | ✅ 本批 |
| A2 | ISR 延迟数值化（`WINK_RUNTIME_TICK_MS` 默认 10ms）+ 不可 timing 器件类 | `04` | ✅ 本批 |
| A3 | UART：事务级 Partial；异步 RX/RX IRQ → **Planned**（非「UI 少」） | `08` | ✅ 本批 |
| A4 | 插件读钟：须 `pal_wasm_get_virtual_clock_us`；过期 delay 语义 | `02` | ✅ 本批 |
| A5 | 同刻多源：已钉部分 vs 全序 **Planned**（→ B1） | `03`（链 `02`/`04`） | ✅ 本批 |
| A6 | 浮点确定性：bit-exact vs tolerance；禁 fast-math **契约 Planned/Partial** | `06` | ✅ 本批 |
| A7 | 同步原语表加落地列 | `03` §9 | ✅ 本批 |
| A8 | 双 GPIO 读路径说明 | `10` §3.1 | ✅ 本批 |
| A9 | 故障码表集中 + boot-reset 诚实 | `05` | ✅ 本批 |
| A10 | Glossary：L1/L2/L3 三套消歧 | `05-glossary` | ✅ 本批 |
| A11 | INTERACTIVE CI 子集契约（实现 Planned） | `01` / `11` | ✅ 本批 |
| A12 | 生产口径：链到未钉死的语义上限 | `03-production-contract` | ✅ 本批 |
| A13 | 03 文首 ADR 加链接 | `03` | ✅ 本批 |
| A14 | PRNG：golden 与消费序绑定说明 | `06` | ✅ 本批 |

---

## B. ADR（已 Accepted；实现项见 C）

| ID | 题目 | ADR | 候选决议 | 回写目标 | 挡「高一致」？ |
|---|---|---|---|---|---|
| **B1** | 同一虚拟时刻跨队列事件总序 | [ADR-0053](../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md) **Accepted** | 选项 C：调度总序 SSOT + Pin Event pull | `02`/`03`/`04` | 反测仍 Planned |
| **B2** | UART 异步 RX 模型 | [ADR-0054](../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md) **Accepted** | 选项 A 契约；B 实现 Planned | `08`/`10`/`04` | 实现前挡 RX timing 宣称 |
| **B3** | host↔wasm 浮点 / Golden | [ADR-0055](../../decisions/unisim/0055-sim-fp-determinism-and-golden-policy.md) **Accepted** | 分层 bit-exact vs tolerance | `06`、ADR-0002/0003 | 构建核查 Planned |

- [x] ADR-0053 Accepted + 回写（反测 C1 仍开）
- [x] ADR-0054 Accepted + 回写
- [x] ADR-0055 Accepted + 回写（构建核查 C3 仍开）

---

## C. Roadmap 实现（不本批改代码）

| ID | 项 | 备注 |
|---|---|---|
| C1 | 同刻总序反测 + 若实现偏离则改调度 | 跟 ADR-0053 |
| C2 | UART 异步 RX 最小机制或 Fail-Loud API | 跟 ADR-0054 选项 B |
| C3 | 构建侧禁 fast-math / FP contract 核查 | 跟 ADR-0055 |
| C4 | `wink-tools/.../memory.yaml` 落地 | 对齐 ADR-0043 |
| C5 | ADR-0045 三链接标志落地 | 已在 05 Planned |
| C6 | 栈高水位 / Asyncify vs C 栈诊断 | P1-5 |
| C7 | INTERACTIVE yield-heavy CI 子集 | 跟 A11 |
| C8 | PRNG domain id / 子流 | 文档已警告；实现可选 |
| C9 | 多板多固件 Fail-Loud | Planned |
| C10 | 沙箱威胁模型专节 | 非目标边界 |

---

## 验收（A 档）

- [x] 未实现能力未标 Landed
- [x] 08 UART / 04 ISR 延迟 / 05 lint / 02 读钟 已补
- [x] 本清单挂到 mechanisms README
- [x] B1–B3 ADR 正文已写（0053/0054/0055）
- [x] B1–B3 Accepted + ① 回写（反测/构建核查见 C1/C3）
