# WASM Target C 侧架构提案第二轮评审（Second-Round Architecture Review）

> **评审对象：**
> - [`06-c-target-architecture-and-refactoring-proposal.md`](../../implementation-plans/unisim/06-c-target-architecture-and-refactoring-proposal.md)（已 Approved 的 C 侧目录解耦提案）
> - [`06-01-architecture-review-feedback.md`](../implementation-plans/2026-08-09-wasm-simulation-architecture-evolution-plan/06-01-architecture-review-feedback.md)（第一轮评审反馈 R1-R5）
>
> **评审日期：** 2026-08-09
> **评审角色：** 资深嵌入式架构师（Senior Embedded Architect）
> **评审方法：** 文档评审 + 对照实际源码核实（`targets/wasm/`、`osal/wasm/`、`targets/common/`、`runtime/src/wink_event.c`）
> **评审结论：** ⚠️ **部分接受，提案需第二轮修订（Partially Accepted, Second Revision Required）**

---

## 1. 总体评价

06 提案对 `pal_hal_wasm.c` 职责混合与万能头文件反模式的诊断准确，四条铁律（分层边界、依赖方向、状态共置、导入边界）方向正确，渐进式融入节奏合理。第一轮评审（06-01）的 R1、R4 切中要害，R3、R5 中肯。

但经源码核实，06 提案与 06-01 反馈**共同遗留了 6 个会在 Phase 2/5 转化为链接错误、重复符号或运行时缺陷的问题**，且 R1 的并发论证、R2 的处置选项存在事实性偏差。本评审在肯定 R1/R4 结论的前提下修正其理由，并补充 N1-N6。

| 维度 | 评分 | 说明 |
|---|:---:|---|
| 痛点识别 | ⭐⭐⭐⭐⭐ | 350 行跨通道、万能头文件，诊断精准 |
| 铁律设计（1-4） | ⭐⭐⭐⭐⭐ | 边界清晰；但铁律 2 缺自动化门禁（见 N5） |
| 渐进策略 | ⭐⭐⭐ | Phase 1-4 合理；Phase 5 大爆炸可摊薄（见 N4） |
| 现状覆盖完整性 | ⭐⭐ | 遗漏 `wasm_sim_registry.c` 归属与重复符号（见 N1） |
| 复用意识 | ⭐⭐ | 计划新造 FIFO，已有 `pal_os_ringbuf` 可复用（见 N2） |
| 单一职责执行 | ⭐⭐⭐ | R2 正确指出 degradation 轴归属模糊；但选项 A 错误（见 R2 裁定） |

---

## 2. 对第一轮评审（06-01）的裁定

### R1（UART RX 独立文件）— ✅ 采纳结论，⚠️ 修正理由

06-01 以"SPSC 并发风险"作为 UART RX 必须独立于 I2C/SPI 的主因。经核实 `wasm_bridge.h:217-225`（Axis E 调用约定契约）与 ADR-0054：

> 仿真为**协作单核模型**，JS→C 写入仅在 C 主循环让出给 JS 调度器时发生，二者永不真正并发。现有非原子 head/tail 环形结构在该沙箱内即安全。

因此"SPSC 并发风险"在本目标下不成立。但**独立成文件的结论仍然正确**，真实理由是：

| 维度 | I2C / SPI | UART RX |
|---|---|---|
| 数据方向 | C 主动请求-响应 | JS 主动 push，C 被动消费（方向相反） |
| 状态 | 无持久缓冲 | 必须持有 FIFO（`s_rx_ring[]`/句柄） |
| 唤醒 | 同步返回 | 未来需唤醒阻塞消费者 / 触发 IRQ |
| 可测性 | 纯函数式事务 | 需独立的生产者/消费者单测 |

**裁定：** 新建 `pal_wasm_ch2_uart.c` 承载 RX；`ch2_bus.c` 仅留同步总线事务。轴标注统一为 **Axis A (CH2)**，不把 06-01 自造的子代号 "CH2u" 写入 `wasm_bridge.h` 的 A–F SSOT 分类（避免 ABI 头与设计规范的通道术语漂移）。

### R2（degradation 轴归属 / reset_physical）— ⚠️ 部分采纳，否决选项 A

06-01 提供二选一：A（搬入 `wasm_entry.c`）或 B（新建 sim_ctrl 编排层）。

经核实 `wasm_entry.c` 仅 40 行宿主入口。若采纳 A，入口层将 `#include` 各轴内部头并直接编排状态，**入口层反向依赖全部轴**，耦合比现状更糟，且把启动期代码与运行期仿真编排混为一谈。

同时核实 `pal_wasm_reset_physical()`（`pal_wasm_physical.c:81-89`）当前只清 Axis F 自有状态（`s_faults`/debounce/PRNG/fault log/domains）并调用 `wasm_sim_devices_reset()`，**并未直接访问 GPIO mode / `s_i2c_bus_inited` 等 Axis A static 状态**。06-01 担心的"隐式反向依赖"在现状代码中尚不存在——风险在于未来演进。

**裁定（选项 B 轻量化版）：**
- `pal_wasm_reset_physical()` 留在重命名后的 `pal_wasm_degradation.c`，轴归属纯化为 **Axis F**；
- 立规：编排函数只能调用各轴**已发布的 reset 钩子**（`pal_wasm_ch1_reset()`、`pal_wasm_ch2_reset()` …），**不得直接访问 Axis A 的 static 状态**；
- 各通道在抽离时同步发布其 reset 钩子；
- 不新建单独的 `sim_ctrl.c`（40 行编排不足以支撑独立编译单元，避免过度设计）。

### R3（fault_domain / degradation 边界表）— ✅ 采纳

在 06 提案 §3 补充边界判断表（详见 N3 配套）。

### R4（Phase 5 风险重评）— ✅ 采纳结论，但进一步消解

06-01 将 Phase 5 合并冲突风险升为"高"并要求 feature-freeze Gate。该判断对"大爆炸式 Phase 5"成立。但根因是 06 提案**刻意把 ch1/ch2b 抽离全压到 Phase 5**，而 Phase 2 本就要触碰 `pal_hal_wasm.c`（迁出 I2C 段与 `s_i2c_bus_inited`）。

**裁定：** 采纳 Gate，但同时把抽离摊薄到各 phase（见 N4），使 Phase 5 退化为纯收尾，风险等级随之下调。

### R5（万能头过渡期技术债标注）— ✅ 采纳并强化

不仅标注，还应把零行为变更的 `pal_wasm_fault_types.h` 提前切到 Phase 2 之前（见 N5），让新建文件从第一天起不背负全部无关声明。

---

## 3. 新增问题（N1–N6）

### N1【高】`devices/wasm_sim_registry.c` 不是纯遗留，存在状态与符号归属冲突

06 提案 §3.2 将 `devices/` 整体标注为"Phase 1 清理后逐步移除"，§3.3 映射表完全没有它的位置。但源码核实：

- `wasm_sim_registry.c`（128 行，**始终编译**，CMakeLists.txt:14，无 `@deprecated`）实际持有：
  - GPIO 输入/输出状态数组（:25-27），导出 `pal_wasm_set_gpio_input`（:115）、`pal_wasm_get_gpio_output`（:126）——这两个是 **Axis A CH1 的 KEEPALIVE 导出**，06 §3.3 却把它们列进待建的 `pal_wasm_ch1_gpio.c`；
  - I2C sim stub（:48-63）、PWM 通道存在性/占空比查询（:65-76）；
  - `pal_wasm_sim_reset_all_devices`（:44）。
- **重复符号隐患**：`wasm_dev_servo.c:27` 在 `WINK_USE_RC_SERVO` 下定义了 KEEPALIVE `pal_wasm_get_pwm_duty_percent`，与 06 规划给 `ch2b_pwm.c` 的同名导出直接冲突。ch2b_pwm 一旦落地而 servo 仍编入，链接期 duplicate symbol。
- **宏遮蔽隐患**：`wasm_dev_ultrasonic.c:19` 与 `wasm_sim_registry.c` 本地 `#define WASM_SIM_MAX_PINS 40`，遮蔽 `pal_wasm_internal.h` 的 128。引脚 >40 时存在越界类风险。

**修订要求：**
1. §3.3 增补 registry 中符号的迁移归属：GPIO 状态与 `set_gpio_input/get_gpio_output` → `ch1_gpio.c`；PWM 查询 → `ch2b_pwm.c`；`sim_reset_all_devices` → 走 N3 的 reset 编排。
2. Phase 5 Gate 增加："`WINK_USE_RC_SERVO` 构建下无 `pal_wasm_get_pwm_duty_percent` 重复定义"。
3. 统一 `WASM_SIM_MAX_PINS` 为单一来源（来自拆分后的 `pal_wasm_common.h`），删除 devices 内的本地 40。
4. §5 CMake 明确 registry 退场时间点，不得在最终态仍残留。

### N2【高】UART RX FIFO 应复用 `pal_os_ringbuf`，而非新建

Phase 2 计划（02-phase-2 文档 :70）拟新建 `pal_uart_rx_fifo.h`（256 字节自定义 SPSC）。仓库已有现成、且被 runtime 验证过的同构件：

- `wink-micro-os/osal/common/pal_osal_ringbuf.c` —— 单线程无锁 SPSC，容量强制 2 的幂，`volatile head/tail`；声明于 `pal/include/osal/pal_osal.h`。
- 成熟范式：`runtime/src/wink_event.c:21-128` 已示范「`pal_os_ringbuf` + 二值信号量 + ISR-aware give」用于事件 FIFO 与阻塞等待——这正是 UART RX 需要的形态（字节入队 + 唤醒阻塞读/IRQ）。

**修订要求：** 删除新建 FIFO 头文件的计划；`pal_wasm_ch2_uart.c` 在 init/reset 时 `pal_os_ringbuf_create()`（容量 2 的幂），生产者 `pal_wasm_push_uart_rx_byte` 调 `push`，消费者 `pal_uart_read_byte` 调 `pop`，阻塞读配 `pal_os_sem`。减少一个新抽象与一份测试面，且与 runtime 行为一致。

> 注：`pal_os_ringbuf` 基于 malloc，需在仿真 init/reset 路径显式 create/destroy；这与现有 event 队列的生命周期管理一致，不引入新问题。

### N3【中】R3 边界表 + reset 钩子发布约定

补充 `degradation` vs `fault_domain` 边界判断表（落实 R3）：

| 归属文件 | 收录原则 | 典型内容 |
|---|---|---|
| `pal_wasm_degradation.c` | 影响**物理通道行为**、被 Axis A 消费的参数 | bounce_us、drop_permil、PRNG、warmup_us、debounce 上下文、RC tau |
| `pal_wasm_fault_domain.c` | 影响**故障域判定与功耗模型**的仿真宏观配置 | 功耗 Stub、故障域阈值/arm/reset 策略 |
| `pal_wasm_fault.c` | 故障日志环、faulted 闩锁、ABI hash、host_fault | fault log ring、`WASM_FAULT_GUARD_*` |

并明确：跨轴 reset 由 `pal_wasm_degradation.c` 的 `reset_physical` 统一编排，仅经各轴发布的 `pal_wasm_ch*_reset()` 钩子执行，不触碰对轴 static 状态（落实 R2 裁定）。

### N4【中】把通道抽离摊薄到各 phase，消解 Phase 5 大爆炸

06 提案以"Phase 1-4 不动 `pal_hal_wasm.c` 减少 diff"为由，把 GPIO/PWM 抽离全压到 Phase 5。但 Phase 2 已必须迁出 I2C 段并移动 `s_i2c_bus_inited`——文件已被打开。建议调整节奏：

| Phase | 抽离动作 | 文件变更面 |
|---|---|---|
| Phase 2 | `ch2_bus`（I2C/SPI）+ 新建 `ch2_uart` | 2 新文件 |
| Phase 3 | `ch2b_pwm`（与 adc 重命名同批，纯机械搬迁） | 1 新文件 + 1 重命名 |
| Phase 4 | `ch1_gpio`（含 `s_pin_events`/`s_gpio_mode`，状态最大，单独成批便于 review） | 1 新文件 |
| Phase 5 | 头文件拆分、physical→degradation 重命名、混入函数迁移、删空壳、CMake 最终化 | 收尾 |

每步仅 1-2 文件、可独立单测；Phase 5 由"6+ 文件同步大改"退化为纯收尾，合并冲突面骤降。R4 的 feature-freeze Gate 保留但等级相应下调。

### N5【中】`pal_wasm_fault_types.h` 提前拆分 + 铁律 2 纳入自动化门禁

- `pal_wasm_internal.h` 中最该先拆的 `pal_wasm_fault_types.h`（故障枚举 + 事件结构体 + `WASM_FAULT_GUARD_*` 宏）是**零行为变更的纯机械动作**，应在 Phase 2 之前切出。degradation/common 子头可留 Phase 5。
- 铁律 2（A→F 单向）目前仅靠评审自觉。仓库已有分层门禁 `wink-tools/tools/lint/rules/layering.yaml`（WASM-DAL-ISOLATION, ADR-0003）及配套 `test_lint_wasm_isolation.py`，但未覆盖 `targets/wasm/` 内部轴间依赖。
- **修订要求：** 新增**铁律 5（Dependency Gate）**——增加一个解析 `#include` 的检查，断言 `pal_wasm_degradation.c` / `pal_wasm_fault*.c` 不得 include 任何 `pal_wasm_ch*.h`/通道内部头。把君子协定变 CI 门禁。

### N6【低】无主符号、CMake 与 Axis E 实现位置遗漏

- `pal_hal_wasm.c` 中 `pal_test_enable/disable_hardware_loopback`（:337,:342）、`pal_rmt_pulse_capture_init`（:347，均 UNSUPPORTED stub）与静态助手 `pal_gpio_mode_idle_level`（:47）在 §3.3 映射表中**无归属**。须明确：助手 → `ch1_gpio.c`；test/RMT stub → `ch1_gpio.c` 或单列 `pal_wasm_stub.c`（建议归 ch1，避免新增空壳文件）。
- §5 最终 CMake 仍列 `devices/wasm_sim_registry.c`，与"devices 退场"自相矛盾；且漏掉 `WINK_USE_RC_SERVO` / `WINK_USE_ULTRASONIC` 条件块的存续裁决。须明确 registry 退场后条件块是一并移除还是迁移到新位置。
- Axis E 的 `pal_wasm_set_sim_mode/get_sim_mode` C 实现位于 `osal/wasm/pal_osal_wasm.c:70-86`（符合铁律 1，正确），但 06 §3 未说明这一点，易使读者在 `targets/wasm/` 下找不到实现。补一句说明。

---

## 4. 修订优先级汇总

| 编号 | 问题 | 优先级 | 需修订章节 | 阻塞 Phase 2 |
|---|---|:---:|---|:---:|
| R1 | UART RX 独立 `ch2_uart.c`（理由修正 + 复用 ringbuf） | 🔴 高 | 06 §3.2/§3.3/§4 P2 | 是 |
| N1 | registry 归属、重复符号、MAX_PINS 统一 | 🔴 高 | 06 §3.2/§3.3/§5/§6 | 是 |
| N2 | 复用 `pal_os_ringbuf`，不新建 FIFO | 🔴 高 | 06 §4 P2、Phase 2 计划 | 是 |
| R4/N4 | 逐 phase 抽离，Phase 5 降为收尾 | 🟡 中 | 06 §4/§6 | 否（建议同步） |
| R2/N3 | reset 编排纯化、边界表 | 🟡 中 | 06 §3.3/§3.4/§4 P5 | 否 |
| N5 | fault_types 提前拆分、铁律 5 门禁 | 🟡 中 | 06 §2/§3.4 | 否（建议 P2 前） |
| N6 | 无主符号、CMake、Axis E 说明 | 🟢 低 | 06 §3.3/§5 | 否 |
| R5 | 过渡期技术债标注（并入 N5） | 🟢 低 | 06 §3.4 | 否 |

---

## 5. 结论

> **结论：06 提案方向正确，但不能按现状进入 Phase 2。**
>
> - **R1（修正理由后）+ N1 + N2 为 Phase 2 开工前置项**：UART 文件切分、registry 归属与重复符号裁决、FIFO 复用 `pal_os_ringbuf` 必须先落入提案。
> - **R2/N3、R4/N4、N5** 建议在同一轮修订中完成，不阻塞 Phase 2 但显著降低 Phase 5 风险。
> - **N6、R5** 为文档完整性补全。
>
> 铁律 1-4、CMake 显式列举、Axis B/E 留在 OSAL 等核心决策已通过评审，维持不变。新增铁律 5（Dependency Gate）将铁律 2 固化为 CI 门禁。

---

*评审人：资深嵌入式架构师*
*评审日期：2026-08-09*
*关联文档：[06 提案](../../implementation-plans/unisim/06-c-target-architecture-and-refactoring-proposal.md) · [06-01 第一轮评审](../implementation-plans/2026-08-09-wasm-simulation-architecture-evolution-plan/06-01-architecture-review-feedback.md)*

