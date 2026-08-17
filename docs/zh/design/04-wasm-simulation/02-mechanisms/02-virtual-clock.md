# 虚拟时钟 SSOT、零 Yield 快进与时间回绕

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Landed**（`s_virtual_us` 单 Gate / HEADLESS 快进 / bigint）；零 Yield 脉宽环回对超声波为 **Partial**（目标路径，见 [08 §5.1](./08-channel-routing.md)） |
| 支撑轴 | **B（primary）** |
| 关联代码 | `wink-micro-os/osal/wasm/pal_osal_wasm.c`、`wink-micro-os/targets/common/src/wink_sim_physical.c`、`@wink-ai/unisim` (VirtualClock 引擎) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | [0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md)（决策 3）、[0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)、[0042](../../../decisions/unisim/0042-sim-execution-modes.md) |
| 迁自 | `04-wasm-simulation-2.0/03-virtual-clock.md` |

> 本文件回答：delay/超时/脉宽以谁为钟、时钟如何推进、为什么不能双重步进、长时序测试如何毫秒级跑完。对应 C2、C14、C21。

---

## 1. 虚拟微秒时钟 SSOT

### 1.1 设计原则

仿真放弃宿主机墙钟（`Date.now`/`setTimeout`），全面采用单调递增的虚拟微秒时钟 `s_virtual_us`（`uint64_t`）作为唯一时钟 SSOT（[ADR-0009](../../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)）：

- **零耗时无缝跳跃（Fast-Forwarding）**：HEADLESS 下所有 Fiber 处于 sleep/等待时，`pal_sim_scheduler_run` 把 `s_virtual_us` 快进到最近 `next_wakeup_us`，长时序测试毫秒级跑完；
- **物理逻辑绑定**：`wink_phys_debounce_step`、`wink_phys_rc_lowpass`、软定时器全部锚定 `s_virtual_us`，跨宿主机确定性复现；
- **读取零开销**：`pal_os_get_us()` / `pal_os_get_ms()` 纯内存读出，无 JS 往返。

### 1.2 单一写入 Gate（R-VC-1，ADR-0042）

| 角色 | 说明 |
|---|---|
| 时钟持有 | `wink-micro-os/osal/wasm/pal_osal_wasm.c::s_virtual_us`（BSS 零初始化，uint64 单调） |
| 唯一赋值点 | 静态私有 `wink_vclock_advance_internal()` |
| 合法调用者 1 | C→JS 导出 `pal_wasm_advance_virtual_clock(us)`（JS Worker 在 INTERACTIVE 步进） |
| 合法调用者 2 | HEADLESS 调度循环 idle 跳跃（经同一 Gate） |
| **禁止** | `pal_delay_ms/us` 主动步进；任何其他代码直接赋值 `s_virtual_us` |

> 与旧文档的差异：06 旧文称"JS Worker 是唯一写入者"——ADR-0042 后改为"**单一 Gate，两个合法调用者**"。JS 侧 `VirtualClock` 是等价 bigint 镜像，用于调度与时间轴回放 UI；wasm 是时钟仲裁者，两侧不逐微秒对账，只在 `pal_wasm_reset_physical()` + `VirtualClock.reset()` 时强制同步。

### 1.2.1 插件 / JS 读钟与 Pin Event 注入契约

| 规则 | 说明 |
|---|---|
| **仲裁者** | C `s_virtual_us`；导出 `pal_wasm_get_virtual_clock_us()` / `pal_os_get_us()` |
| **插件调度未来边沿前** | **必须**经 cwrap 读 C 钟计算 `delay_us`，**禁止**仅用 JS `VirtualClock.getUs()` 镜像（镜像可相对 C 滞后，造成偏斜窗） |
| **`pal_wasm_push_pin_event(pin, delay_us, level)`** | 入队绝对时刻 = `pal_os_get_us() + delay_us`（以推入瞬间的 C 钟为准） |
| **目标已过期**（`delay_us==0` 或入队后时钟已越过目标） | `pulse_in`：沿对可匹配则返回脉宽；`t_end > now` 才 `advance`，已过去**不回拨**（[ADR-0053](../../../decisions/unisim/0053-sim-same-timestamp-event-total-order.md)） |
| **与调度同刻总序** | Pin Event = **pull**；不进 Phase 2；快进不派发 ISR → [`03` §3.1](./03-scheduler-and-concurrency.md) |

### 1.3 类型契约

- CMake `-sWASM_BIGINT=1`：`uint64_t` ↔ JS `bigint` 精确传递；
- TS 全链路时钟字段必须 `bigint`，禁止隐式 `number`（传 `number` 给 bigint 导出会抛 `TypeError`，这是运行期兜底）；
- uint64 量程 >580 年，不可达；溢出预警见 §4。

---

## 2. 零 Yield 同步事件驱动快进

### 2.1 问题

朴素的引脚时序环回若在 `pal_gpio_pulse_in` 上 Asyncify yield，会因 Unwind/Rewind 拖慢 **10~50×**。

### 2.2 机制（Pin Event Queue）

1. **Pin Event Queue**：C 侧维护"未来引脚变化"的时间链表（`pal_wasm_push_pin_event(pin, delay_us, level)`）；
2. **Zero-Yield Callback**：Trig 跃变时同步回调插件，插件把 Echo 边沿时间戳写入队列；
3. **同步时钟跃进**：`pulse_in` 直接累加 `s_virtual_us` 并返回脉宽，**Asyncify 挂起次数 = 0**（HEADLESS 路径）。

这是超声波脉宽测量的目标落点（替代 deprecated 的 C 侧 cm→µs 捷径，见 [08 §5.1](./08-channel-routing.md)）。

### 2.3 已知副作用

快进跳跃可能漏中间边沿、或越过半个去抖窗——契约与逃逸归 C14.2：快进前必须 drain 到期 pin 事件 / 物理步进，或快进取全局"下一事件"时间。

---

## 3. 物理算法锚定虚拟时钟

`wink-micro-os/targets/common/src/wink_sim_physical.c`（target 无关算法库，host 与 wasm 共用）所有时间基准由 caller 传入 `pal_get_us()` 虚拟时钟值：

| 算法 | API | 时间锚 |
|---|---|---|
| 按键去抖（强制翻转模型） | `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | `now_us` = 虚拟时钟 |
| RC 一阶低通 + 噪声 | `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | 同上 |
| 预热/采样间隔检查 | `wink_phys_warmup_check(now_us, power_on_us, ...)` | 同上 |
| 总线丢包 | `wink_phys_bus_drop(drop_permil, seed)` | PRNG 驱动 |

**确定性红线**：严禁 `rand()`/`Math.random()`/`clock()`/`time()`/墙钟；PRNG 是种子驱动的 LCG（`wink_phys_prng_next`），caller 持有 seed。详见 [06](./06-physical-degradation.md)。

---

## 4. 时钟溢出与回绕

- `s_virtual_us` 是 uint64，>580 年量程，业务不可达；但仍有早期预警：`pal_wasm_is_clock_warning_fired()` 在跨 UINT64 中点后置位并保持（JS Worker 每 tick 轮询，首次 true 时 `console.warn`），重启 wasm 实例才清零。
- **App 自管的 uint32 滴答/毫秒仍须测回绕**（C21.1）：`now - last` 必须用无符号减法。单测要快进跨越回绕点。
- 相对超时跨越快进：内部一律用绝对 `wakeup_us`，不用"剩余 delta"（C21.2）。

---

## 5. 时钟相关逃逸索引（详见 [../04-assurance/01-consistency-spec.md](../04-assurance/01-consistency-spec.md)）

| ID | 场景 | 要点 |
|---|---|---|
| C2.1 | sleep/定时唤醒快进 | 同 seed/同注册序 → 唤醒序列可复现；墙钟耗时 ≪ 虚拟跨度 |
| C2.2 | 脉宽零 Yield 环回 | Asyncify 次数 = 0；容差内返回 |
| C2.3 | 去抖/RC 锚定虚拟时钟 | 固定输入 → golden 向量一致 |
| C2.4 | 单中断采样周期 | 无注入周期误差 0；可注入受控抖动 |
| C14.1 | 禁止双重步进 | CI 断言唯一写入 Gate |
| C14.2 | 快进不丢边沿 | drain 事件 / 全局最小事件时间 |
| C14.3 | Plant↔OS 锁步 | plant 禁读墙钟，同一 virtual_dt |
| C21 | 时间/计数回绕 | uint32 回绕、绝对唤醒、序列号模 |

**当前不仿真晶振/时钟源 ±50ppm 漂移**（非目标；C2.1 边界）。若未来需要，须先在 [`06-physical-degradation.md`](./06-physical-degradation.md) 立项——现无该算子，不得暗示「退化引擎已能注 ppm」。

