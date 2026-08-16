# 定时器与 PWM 硬件语义

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Partial**：通道 1b PWM duty 旁路（`pal_pwm_set_duty` → `js_pal_pwm_set_duty`）**Landed**；`pal_hwtimer_*` 真机契约（ADR-0047）与 FOC 软步进仿真 **Partial～Planned**（实现挂独立计划，当前树内无 `pal_hwtimer` 符号）；通用 HW capture 通道抽象 **Planned** |
| 支撑轴 | **C（primary）**；与轴 B（时间基）分工见 [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) |
| 关联代码 | `wink-micro-os/targets/wasm/pal_hal_wasm.c`（`pal_pwm_*` / `pal_gpio_pulse_in`）、`wink-micro-os/targets/wasm/wasm_bridge.h`（`js_pal_pwm_set_duty`）、`wink-micro-os/targets/common/`（规划 plant 分区，FOC）、ADR-0047 契约面 |
| 上次核对 | 2026-08-11 Amend（基于 `review.md` 评审更新：PWM 重定名为通道 1b 定时调制） |
| 管辖 ADR | 0047、0003、0002 |
| 迁自 | `04-wasm-simulation-2.0/09-channel-routing.md` §1.4 / §5.3（及文中定时器分层栈 / FOC 相关） |

> 本文件是轴 C（定时器硬件语义）的 **primary home**：HW timer / PWM 周期 / capture / 软步进 / `pal_hwtimer` / FOC 快环行为级边界。
>
> **与通道文边界**：四通道数据面、PWM 作为通道 1b 的**路由/选型**（`notifyDutyChange`、duty 百分比旁路「数据从哪来」）→ [`08-channel-routing.md`](./08-channel-routing.md)。虚拟时钟 SSOT → [`02-virtual-clock.md`](./02-virtual-clock.md)。调度消费者 → [`03-scheduler-and-concurrency.md`](./03-scheduler-and-concurrency.md)。
>
> **禁止**在此重定义 A~F 字母含义（→ [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md)）；**禁止**复制生产口径长文（→ [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md)）。

---

## 1. 时间基 vs 定时器硬件语义（轴 B vs 轴 C）

通道 1（脉冲捕获）与通道 1b（PWM）常被混为「都是时序」，但分属两个正交轴：

| | 轴 B 时间基 | 轴 C 定时器硬件语义 |
|---|---|---|
| 回答 | delay / 超时 / 脉宽以谁为钟 | HW timer、PWM 周期、capture、周期 ISR 像不像芯片 |
| SSOT | `s_virtual_us` + 单 Gate（[`02-virtual-clock.md`](./02-virtual-clock.md)） | PAL timer / PWM /（规划）`pal_hwtimer` 的语义契约 |
| 仿真手段 | 快进、绝对 `wakeup_us`、零 Yield 脉宽环回 | duty 百分比旁路、软步进快环、资源独占门禁 |
| 典型上限 | 非墙钟实时 | **无** 10kHz+ 硬 ISR；无 PWM–ADC 硬件触发真同步 |

同一超声波用例需要 **B**（VirtualClock 脉宽）+ **A**（ECHO 沿，见 [`08-channel-routing.md`](./08-channel-routing.md)）+ `timing` Accuracy Mode。FOC 快环需要 B（虚拟时间步进）+ C（`pal_hwtimer` 软步进）。

仿真中的定时器分层：

```text
┌─ App/BAL/DAL ───────────────────────────────────────┐
│  周期任务、超时、脉宽换算（锚定 pal_os_get_us）      │
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL 软时基 / 协作调度（轴 B/E）─────────────────────┐
│  pal_os_sleep_ms、软定时、调度器 wakeup_us           │  ← Landed
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL PWM / 调制语义（通道 1b）──────────────────────┐
│  pal_pwm_set_duty(channel, percent) → notifyDuty    │  ← Landed（L2 duty）
│  不仿真载波边沿 / 死区 / Center-aligned 对齐        │
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL 硬件定时器（FOC 等，ADR-0047）─────────────────┐
│  pal_hwtimer_* 真机契约 Landed；仿真 = 虚拟时间      │  ← 契约 Landed
│  确定性软步进（每虚拟 ms 步进 N 次），禁墙钟/rand     │    仿真实现 Partial
└─────────────────────────────────────────────────────┘
```

`pal_hwtimer` 真机契约与 FOC 分层见 [ADR-0047](../../../decisions/core/0047-foc-isr-layering-and-pal-hwtimer.md)；FOC 仿真降级见本文 §2。通用 HW capture 通道抽象为 **Planned**（当前 `pal_gpio_pulse_in` + Pin Event Queue 覆盖超声波，路由见 [`08-channel-routing.md`](./08-channel-routing.md) §2.1）。

> **核对注记（2026-08-02）**：`wink-micro-os/` 树内尚无 `pal_hwtimer` / `foc_isr` 符号；上表「契约 Landed / 仿真 Partial」继承 ADR-0047 与 2.0 诚实标注，**不得**据此宣称仿真软步进已端到端落地。

---

## 2. FOC 快环与 PWM（ADR-0047）

SimpleFOC 本地算法（10kHz ISR / PWM–ADC 同步 / `pal_hwtimer`）在仿真端是**虚拟时间驱动的确定性软步进**：caller 每虚拟 ms 步进 \(N = f_\text{ctrl}/1000\) 次控制环，**禁墙钟/`rand`**；PWM–ADC 硬件同步在仿真端降级为软步进末尾读 plant 等效量。plant 差分方程归 `wink-micro-os/targets/common/wink_sim_physical.*` 的 **plant 分区**（与信号退化分区隔离命名），禁止写入 DAL `#ifdef`。

真机 vs 仿真降级（必须诚实）：

| 真机 | 仿真 |
|---|---|
| 10kHz+ 硬定时器 ISR | 虚拟时间确定性软步进 |
| PWM TRGO/Underflow 触发 ADC | 软步进末尾同步读 plant（行为级近似） |
| IRAM / Xtensa ISR 不存 FPU 约束 | 协作单核，不复刻这些规则 |

- 验收：同 seed + 同虚拟输入 → plant/控制输出可复现（Tolerance Band 或 Golden）；**不得**用仿真证明硬实时延迟或抢占序（C10 → HIL）。
- 分层铁律：BAL `control/` 纯数学（无 `pal_*`）；DAL 硬件块；`foc_isr_trampoline` 是 ISR 宿主且不进 BAL 公共头；`pal_hwtimer_*` 为 PAL 公共契约。
- `dal_vesc`/ODrive 走 CAN/UART 协议帧，无主控 ISR、无 `pal_hwtimer`，不受本节约束。
- 场景契约见 [`../04-assurance/01-consistency-spec.md`](../04-assurance/01-consistency-spec.md) C10（Wave 4 迁入前可能为 stub）；真机契约见 [ADR-0047](../../../decisions/core/0047-foc-isr-layering-and-pal-hwtimer.md)。

---

## 3. 行为语义摘要（轴 C 上限）

| 主题 | 仿真行为 | 上限 / 诚实标注 |
|---|---|---|
| PWM duty（L2） | `pal_pwm_set_duty` → JS `notifyDutyChange`；插件读百分比 | **不**仿真载波边沿 / 死区 / 中心对齐；路由选型见 [`08`](./08-channel-routing.md) §2.3 |
| 软步进快环 | 每虚拟 ms 步进 \(N\) 次；禁墙钟/`rand` | **无** 10kHz+ 硬 ISR |
| capture | 当前靠 `pal_gpio_pulse_in` + Pin Event Queue | 通用 HW capture 抽象 **Planned** |
| 资源独占 | PWM router /（规划）`pal_hwtimer` 门禁 | 与真机资源冲突模型对齐到行为级，非周期精确 |
| `pal_hwtimer` | ADR-0047 契约；仿真 = 虚拟时间软步进 | 仿真实现 **Partial～Planned**（见 §1 核对注记） |

