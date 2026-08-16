# ADR-0053：同一虚拟时刻跨队列事件总序

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-02 |
| 触发 | UniSim 3.0 mechanisms 通篇审阅 P0-1；[审阅闭环 B1](../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md) |
| 影响范围 | `targets/common` 调度器；`targets/wasm` IRQ / Pin Event；mechanisms `02`/`03`/`04`；确定性 / golden 宣称 |
| 决策者 | 项目 Owner（会话确认 Accepted） |
| 关联既有 ADR | [ADR-0003](0003-simulation-fidelity-boundary.md)、[ADR-0013](0013-sim-cooperative-scheduler.md)、[ADR-0014](0014-sim-single-virtual-core.md)、[ADR-0042](0042-sim-execution-modes.md) |
| 关联活规范 | [`02-virtual-clock.md`](../../design/04-wasm-simulation/02-mechanisms/02-virtual-clock.md)、[`03-scheduler-and-concurrency.md`](../../design/04-wasm-simulation/02-mechanisms/03-scheduler-and-concurrency.md)、[`04-interrupt-model.md`](../../design/04-wasm-simulation/02-mechanisms/04-interrupt-model.md) |

---

## 背景（Context）

协作调度在单虚拟核上已钉死：

- 每 tick 相序：Phase 0（IRQ）→ GC → `wakeup_by_time` → `pick_next` → 切任务；
- IRQ 双 FIFO 内：**外部边沿 → 软中断**。

但同一虚拟时刻 `T = now_us` 上，至少还有：

| # | 源 | 今日落点 |
|---|---|---|
| 1 | JS `InterruptQueue`（GPIO 边沿） | Phase 0 |
| 2 | C `s_pending_queue[]`（软中断） | Phase 0 级联 |
| 3 | Pin Event Queue（`pal_wasm_push_pin_event`） | **不在**调度 loop；由 `pal_gpio_pulse_in` 等 **pull** 消费，并可 `advance` 时钟 |
| 4 | `wakeup_by_time`（sleep/超时到期） | Phase 2 |

文档曾只固定「外部→软」与相序片段，**未**给出四者在同 `T` 的总序 tie-break。后果：同 seed 下，「边沿 ISR」与「定时唤醒后的任务逻辑」谁先改 DAL 状态机可能随实现细节漂移 → 隐蔽非确定性 heisenbug，且不得诚实宣称跨「边沿+定时」交叉场景 bit-exact。

另：Pin Event 在任务上下文 `pulse_in` 内快进时钟时，**不会**重入完整调度 Phase 0；由此产生的 PinArbiter 边沿若入 `InterruptQueue`，最早在**下一次** Phase 0 / 最外层 `irq_restore` 才派发。

---

## 方案比选（Options）

### 选项 A：仅文档化「当前偶然顺序」，不改代码

- 优点：零实现成本。
- 缺点：Pin Event 仍游离；读者以为已有总序；反测无法写死。
- **否决**（违背 ADR-0012 契约诚实）。

### 选项 B：把 Pin Event 并入调度 Phase 0.5（到期即推 PinArbiter）

```text
Phase 0   IRQ drain（外→软）
Phase 0.5 应用所有 virtual_time_us <= now 的 Pin Event → 可能再产生边沿入队
Phase 0b  （可选）再次 IRQ drain，消化 0.5 产生的边沿
Phase 1   GC
Phase 2   wakeup_by_time
…
```

- 优点：时间驱动统一；同 `T` 裁决清晰。
- 缺点：改动面大；与「零 Yield `pulse_in` 快进」路径重叠/双消费风险；需仔细定义与 `pulse_in` 的互斥。
- **列为后续增强（Accepted 后可开实现波次），本 ADR 不强制本波落地。**

### 选项 C：分层总序 — 调度总序 SSOT + Pin Event pull 语义 + 反测（**采纳方向**）

1. **调度器 tick 内总序（SSOT，与现实现对齐并写死）**  
   `Phase0(外→软) → GC → wakeup_by_time(now) → pick_next → 任务切片`。  
   同刻：IRQ 副作用（含 ISR 内 `set_pending`）全部发生在 wakeup 之前；wakeup 置 READY 全部发生在 `pick_next` 之前。

2. **`wakeup_by_time` 同刻多任务**：扫描顺序固定为 **slot 下标升序**（实现已是表扫描）；文档写死，禁止改为依赖注册时墙钟。

3. **Pin Event = pull-driven 因果，不参与 Phase 2 竞态**  
   - 入队绝对时刻 = 推入瞬间 `pal_os_get_us() + delay_us`（插件须读 **C** 钟，见 mechanisms `02`）。  
   - 消费仅发生在明确 API（今日：`pal_gpio_pulse_in`）；消费时可 Gate 快进到沿时刻，**不**回拨。  
   - 由 pull 路径产生的 GPIO 边沿 → JS/IRQ 队列：仅在后续 Phase 0 / `irq_restore` 兑现，**不**在 `advance` 中同步派发 ISR。  
   - 因此：「同 `T` 的 Pin Event vs wakeup」**不是**调度器内并列源；交叉场景的可复现性 = **任务调用序**（谁先 `pulse_in` / 谁先被 pick）∪ 上述调度总序。宣称 bit-exact 必须固定任务注册序 + yield 模式（ADR-0013）。

4. **反测（Accepted 后必做）**  
   同 seed：在同一 `now_us` 预置「外部边沿 pending」+「任务 A `wakeup_us=now`」→ 断言 ISR 副作用发生在任务 A 首条用户逻辑之前（或文档钉死的观测点）。另测：`pulse_in` 快进不插入 Phase 0。

5. **明确非目标**  
   真机 NVIC 同刻仲裁、任意指令间刺入、µs 级 IRQ 延迟（见 mechanisms `04` §8）。

---

## 决策结论（Decision）

**采纳选项 C** 作为契约：

| 层级 | 总序规则 | 成熟度 |
|---|---|---|
| Tick 相序 | Phase0 → GC → wakeup → pick → run | **Landed**（与现实现对齐） |
| IRQ 双 FIFO | 外部 → 软 | **Landed** |
| wakeup 同刻多任务 | slot 升序置 READY | **Landed**（表扫描；文档钉死） |
| Pin Event | pull 语义；不进 Phase 2；快进不派发 ISR | **Landed**（契约）；Phase 0.5 增强 **Planned** |
| 跨「边沿 ISR + 定时唤醒」bit-exact | 仅在遵守本 ADR + 固定注册序/yield 时可宣称 | 反测门禁 **Planned**（须补 `test_sim_same_timestamp_*`） |

**拒绝**：在未遵守本总序前宣称超声波沿 + sleep 交织等场景跨版本 golden 稳定。

---

## 后果与约束（Consequences & Constraints）

1. mechanisms `02`/`03`/`04` 已按本结论回写。  
2. 实现若偏离（例如未来在 `advance` 内派发 IRQ）→ **必须**改本 ADR 或改代码，禁止静默。  
3. 选项 B（Phase 0.5）若落地，另开实施计划，并回归 `pulse_in` 零 Yield 路径。  
4. 与 Accuracy Mode：同刻总序反测未绿前，跨源交叉场景不得用 `timing` 冒充已证明 bit-exact（链 `11`）。

---

## 遵循与后续（Compliance & Follow-up）

1. ~~Proposed~~ → **Accepted 2026-08-02**；① 已回写。  
2. 补反测：`test_sim_same_timestamp_irq_before_wakeup`（名可调整）——审阅闭环 C1。  
3. UART 异步 RX → [ADR-0054](0054-sim-uart-async-rx-model-boundary.md)；浮点 golden → [ADR-0055](0055-sim-fp-determinism-and-golden-policy.md)。

---

*本 ADR 状态变更请在此记录：*

- 2026-08-02：Proposed（mechanisms 审阅闭环 B1；选项 C）
- 2026-08-02：Accepted（项目 Owner 确认；回写 `02`/`03`/`04`）

