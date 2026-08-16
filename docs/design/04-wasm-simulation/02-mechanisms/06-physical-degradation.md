# 物理退化引擎与故障注入

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Partial**：抖动/RC/预热/I2C 丢包 / PRNG **Landed**；故障域隔离与功耗模型 **Stub**（Wave3） |
| 支撑轴 | **A/F（secondary）** |
| 关联代码 | `wink-micro-os/targets/common/{include,src}/wink_sim_physical.*`、`wink-micro-os/targets/wasm/pal_wasm_physical.c`、`wink-micro-os/targets/wasm/pal_hal_wasm.c`、`@wink-ai/unisim` (WasmPhysicalBridge 退化桥) |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0009、0003、0040 |
| 迁自 | `04-wasm-simulation-2.0/07-physical-degradation.md` |

> 本文件回答：仿真如何注入抖动/噪声/预热/丢包、为什么要双域混合、确定性如何保证、三层故障纪律是什么。对应轴 A/F 与 C1.3、C2.3、C7、C11.2。

---

## 1. 适用范围

**在范围内**：
- `wink-micro-os/targets/wasm/` 的 OSAL/HAL 适配；
- target 无关算法库 `wink-micro-os/targets/common/src/wink_sim_physical.c`（host PoC Wave 1 与 wasm sandbox 共用）；
- 浏览器侧 UniSim Worker 桥及物理退化组件（`@wink-ai/unisim`）。

**不在范围**：
- esp32/baremetal 真机 target（**零编译污染**，grep 校验）；
- 电气 SPICE；
- **晶振 / 时钟源 ppm 漂移**（非目标；与 [`02-virtual-clock.md`](./02-virtual-clock.md) C2.1 边界一致——勿把信号域抖动当成时钟源漂移）；
- 抢占式多任务调度（见 [03](./03-scheduler-and-concurrency.md)）。

---

## 2. 双域混合架构（Hybrid Double-Domain，ADR-0009 Option C）

```text
┌─────────────────────────────────────────────────────────┐
│  JS 域：理想物理量（按键按下、距离 32cm、温度 25℃）       │
│         + 故障配置 + 时钟控制；不做微时序仿真            │
└───────────────────────────┬─────────────────────────────┘
                            │ Worker 消息协议 / cwrap
                            ▼
┌─────────────────────────────────────────────────────────┐
│  C/wasm 域：本地信号退化（抖动、丢包、噪声）             │
│   时钟纯内存读出（零跨边界成本）；算法在 wink_sim_physical │
└─────────────────────────────────────────────────────────┘
```

UI 主线程 ↔ UniSim Worker（VirtualClock bigint → WasmPhysicalBridge → SimWorker）↔ wasm sandbox（`pal_osal_wasm.c`、`pal_wasm_physical.c`、`pal_hal_wasm.c`、common 算法库）。

**为什么这样分**：宏观光速变化（人按按钮、旋转电位器）适合 JS 表达且需要和 UI/3D 联动；微秒级信号退化（按键抖动、I2C 丢包）必须在 C 侧靠近读取路径，才能影响同源 DAL 协议逻辑。

---

## 3. 故障注入三层纪律（强制）

| 层 | 位置 | 注入内容 | 对上层 | 落地 |
|---|---|---|---|---|
| **L1 HAL 引脚中间件**（**Fault-L1**） | `pal_hal_wasm.c`（经 PinArbiter / 退化引擎） | GPIO 断线/抖动/上下拉失效/高阻 | 透明 | Landed |
| **L2 总线中间件**（**Fault-L2**） | `pal_hal_wasm.c::pal_i2c_transfer` 等 | I2C ACK 丢失、SPI 位翻转、总线超时 | 透明 | Partial（I2C 丢包 Landed；SPI 翻转等 Planned） |
| **L3 器件错误语义**（**Fault-L3**） | **JS Plugin / `wasm_dev_*` / PAL 注入**（非 DAL） | 传感器超量程、电机失速、EEPROM 坏块等**错误码或物理源异常** | 显式（非透明） | Partial～Planned |

**禁止的反模式**：
- DAL 驱动在 attachEvents/read/write 里自己仿真断线或返回业务捷径；
- 每个外设各写一套抖动/噪声/丢包（应复用 L1/L2 + `wink_sim_physical`）；
- DAL 调用 PinArbiter / `setDriver`（L1/L2 是 PAL/HAL 中间件职责）；
- 新增 `dal/*_sim.c` 或 DAL `#ifdef SIMULATION` 业务 stub（与 [08](./08-channel-routing.md) 同源铁律冲突；历史薄接线须标 **Deprecated** 并迁出）。

### 3.1 `wink_sim_physical` 职责分区

| 分区 | 内容 | 说明 |
|---|---|---|
| **信号退化** | 去抖、RC、预热、总线丢包、PRNG | 本文件主体；host/wasm 共用算法 |
| **Plant 动力学** | 电机/转子等差分方程（若启用） | 同属 `wink-micro-os/targets/common`，**模块/符号须与信号退化分区隔离命名**；不得塞进 DAL；见 ADR-0047 / [`09-timer-and-pwm-semantics`](./09-timer-and-pwm-semantics.md) |

---

## 4. target 无关算法库（`wink_sim_physical.h`）

### 4.1 故障配置

```c
typedef struct {
    uint32_t bounce_us;          // 按键抖动时长（0=禁用）
    uint32_t warmup_us;          // 传感器上电预热
    uint32_t sample_interval_us; // 最小采样间隔
    float    adc_noise_v;        // ADC 噪声幅度 ±V（0=禁用）
    float    rc_tau_s;           // RC 低通时间常数（<=0=禁用）
    uint16_t i2c_drop_permil;    // 总线丢包千分比（0=禁用）
    uint32_t prng_seed;          // 确定性 PRNG 种子
} wink_sim_faults_t;

extern const wink_sim_faults_t WINK_SIM_FAULTS_IDEAL; // 全 0 = 理想直通
```

全 0 = 理想直通（零开销默认，退化路径在阈值检查后才生效）。

### 4.2 算法 API

| API | 语义 |
|---|---|
| `wink_phys_prng_next(seed)` | 确定性 LCG，推进 `*seed` 返回 [0,1)；caller 持有 seed |
| `wink_phys_debounce_step(ctx, target, now_us, bounce_us)` | 抖动状态机，返回抖动后物理电平 |
| `wink_phys_rc_lowpass(ctx, target, now_us, tau_s, noise_v, seed)` | 一阶 RC 低通 + 高斯噪声，离散近似**无 expf**（不依赖 libm） |
| `wink_phys_warmup_check(now_us, power_on_us, warmup_us, sample_interval_us, last_sample_us)` | 预热内 `WINK_ERR_BUSY`；采样过近 `WINK_ERR_TIMEOUT`；否则 OK |
| `wink_phys_bus_drop(drop_permil, seed)` | 千分比丢包判定，PRNG 驱动，true=丢弃 |

### 4.3 抖动模型（强制翻转）

```c
typedef struct {
    bool     stable_level;      // 上次已稳定电平
    bool     in_bounce;         // 是否正处抖动期
    uint64_t bounce_start_us;
    bool     bounce_flip;       // 抖动期翻转位（每次采样取反，强制交替）
} wink_phys_debounce_ctx_t;
```

- 跃变（target ≠ stable_level）进入抖动窗；窗内每次采样 `bounce_flip ^= 1`，**采样周期无关、100% 确定、最恶劣抖动**。
- **模型修订**：ADR-0009 骨架的 `(now/1000)%2` 在默认 `WINK_RUNTIME_TICK_MS=10` 下静默失效（商每 tick 增 10，恒偶），改为强制翻转。
- RC 噪声与总线丢包仍用 PRNG。

### 4.4 确定性守卫与零污染

- 所有时间基准由 caller 传入虚拟时钟值；严禁 `rand()`/`Math.random()`/`clock()`/`time()`/墙钟；
- 本单元仅进 `pal_host` OBJECT 库；esp32/baremetal/wasm 不直接链接算法库（wasm 经 `pal_wasm_physical.c` 调 common）；
- 无 libm 依赖（RC 用一阶离散近似）；
- `SIM_TRACE=1` 调试追踪宏（`SIM_TRACE_DEBOUNCE/RC/WARMUP/BUS`），不改变算法行为。

---

## 5. Wasm 退化引擎（`pal_wasm_physical.c`）

### 5.1 BSS 状态布局（零动态分配）

```c
#define WASM_SIM_MAX_PINS 128   // 覆盖 ESP32-S3(49)/Cortex-M(<100)
static wink_sim_faults_t s_faults;            // {0}=理想
static uint32_t          s_prng;
static wink_phys_debounce_ctx_t s_pin_ctx[WASM_SIM_MAX_PINS];
```

依赖 C11 §6.7.9 p10 的 BSS 零初始化。

### 5.2 C→JS 导出（EMSCRIPTEN_KEEPALIVE，经 cwrap）

| 符号 | 参数 ↔ JS 类型 | 用途 |
|---|---|---|
| `pal_wasm_advance_virtual_clock` | uint64 ↔ bigint | （时钟 Gate，见 [02](./02-virtual-clock.md)） |
| `pal_wasm_set_bounce_us` | uint32 ↔ number | 抖动 |
| `pal_wasm_set_warmup_us` | uint32 | 预热 |
| `pal_wasm_set_sample_interval_us` | uint32 | 采样间隔 |
| `pal_wasm_set_adc_noise_v` | float ↔ number | ADC 噪声 |
| `pal_wasm_set_rc_tau_s` | float | RC 时间常数 |
| `pal_wasm_set_i2c_drop_permil` | uint16 | 丢包千分比 |
| `pal_wasm_set_prng_seed` | uint32 | 种子 |
| `pal_wasm_get_prng_state` / `set_prng_state` | uint32 | 回归 / SessionRecorder 回放 |
| `pal_wasm_get_abi_hash` | uint32 | ABI 布局锁（SimFaults/snapshot 变更须 bump） |
| `pal_wasm_reset_physical` | — | 复位 faults/PRNG/per-pin ctx/故障域/锁存（等效运行期 BSS 零初始化） |

PRNG 推进：HAL 中间件 `get_prng_state → 传算法 → advance_prng_state 写回`。

### 5.3 边界安全

- 每 pin 访问：`if ((unsigned)pin >= WASM_SIM_MAX_PINS) return /* 直通 */;`——无 BSS 越界；越界 pin 视为无退化（可观测直通，优于静默崩溃）；
- `get_debounce_ctx` 越界返回 NULL，HAL 视为该 pin 无退化；
- 这是"零动态分配 + 静态上限"的设计，非内存安全漏洞。

---

## 6. 跨语言契约

### 6.1 BigInt ABI

- CMake 必须链 `-sWASM_BIGINT=1`，否则 uint64 拆成两个 i32；
- JS 传 `number` 给 bigint 导出会抛 `TypeError`（TS 编译期检查的运行期兜底）；
- 时钟/时间字段 TS 全链 `bigint`。

### 6.2 Worker 消息协议（SimWorker.ts）

| Request | 字段 | wasm 调用 |
|---|---|---|
| `INIT` | — | bind Module + reset VirtualClock + `pal_wasm_reset_physical` |
| `SET_FAULTS` | `faults: SimFaultsConfig` | 批量调所有 `pal_wasm_set_*` |
| `STEP_CLOCK` | `us: bigint` | `pal_wasm_advance_virtual_clock(us)` |
| `SET_GPIO_IDEAL` | `pin, level` | 写 wasm 侧理想电平 |
| `READ_GPIO_DEGRADED` | `pin` | `pal_gpio_read(pin)`（含抖动） |
| `TEST_I2C_TRANSFER` | `port, devAddr, writeBuf, readLen` | `pal_i2c_transfer()`（含丢包） |

每条消息带 `id: number` 做响应关联（前端 `await` 单次往返）。

---

## 7. PRNG 全局设计（有意为之）

单一全局 `s_prng` 是架构决策，不是缺陷：ADR-0009 §4.1 要求"一种子 → 全轨迹 1:1"。per-peripheral PRNG 会爆炸种子空间。未来可用 `hash(global_seed, peripheral_id)` 派生独立子流，但当前全局种子足以做确定性回归。

**Golden 稳定性后果（须知）**：任意 HAL/中间件**消费 PRNG 的顺序**变更，会静默改写所有下游轨迹并打破跨版本 golden。约定：

- golden vector **与代码版本绑定**；重构消费序 → **必须重基** golden，不得假装旧向量仍有效；
- domain id / 子流派生（稳定 `peripheral_id`）为 **Planned**（实现前仅靠纪律 + 版本绑定）。

---

## 8. 浮点确定性契约（[ADR-0055](../../../decisions/unisim/0055-sim-fp-determinism-and-golden-policy.md)）

`wink_phys_rc_lowpass` 等已避免 `expf` 等易漂 libm，但 **host（x86-64）vs wasm** 的 FPU 语义不会天然逐位一致。

| 规则 | 状态 |
|---|---|
| 禁止对物理算法 / golden 路径开 `-ffast-math`（host gcc 与 emcc） | **契约 Accepted**；构建核查 **Planned** |
| 固定/声明 FP contract（避免隐式 FMA 收缩导致跨 ISA 漂移） | **Planned** |
| **同** toolchain + **同** binary 重复跑 | 可主张 bit-exact（Test-L3「1000 次零偏差」仅对此） |
| **host vs wasm** golden | 默认 **tolerance**（`fp_mode=tolerance`）；升格 bit-exact 须单独证明 |
| 中间量用 float 还是 double | 算法实现须固定并写入单测注释 |

容差数表第一版 **Planned**（assurance / 单测头）。执行细节 SSOT：ADR-0055。

> **命名**：本节「测试矩阵 Test-L0–L3」≠ 故障注入层 Fault-L1–L3（§2）≠ Accuracy 证据级 Evidence-L1/L2（[`11`](./11-accuracy-observation-lifecycle.md)）。消歧见 [`05-glossary.md`](../01-overview/05-glossary.md)。

---

## 9. 测试矩阵

| 层（**Test-L***） | 内容 |
|---|---|
| Test-L0 编译 | wasm/host/esp32/baremetal 全构建；`tsc --noEmit` 零警告 |
| Test-L0.5 静态架构 | grep 断言 `pal_delay_ms` 体不调 advance；`-sWASM_BIGINT=1` 在链接参数；`WASM_SIM_MAX_PINS` 边界检查存在；真机 target 无 `wink_sim_physical` 符号 |
| Test-L1 C 单测 | 算法 golden：同 toolchain 内可 bit-exact；跨 host/wasm 见 §8 tolerance |
| Test-L1 TS 单测 | VirtualClock bigint 边界/负数拒绝；WasmPhysicalBridge setter 顺序；SimWorker 派发 |
| Test-L2 集成 | 按键去抖 e2e wasm ↔ host（容差或分 toolchain 基线） |
| Test-L3 确定性 | 同 seed + 同输入 + **同 binary** → byte-identical；1000 次连续运行零偏差 |

### 零编译污染验证（持续）

`grep wink_sim_physical|pal_wasm_physical targets/esp32 targets/baremetal` 必须为空。算法源仅由 `pal_host`、`pal_wasm` CMake OBJECT 库编译；esp32/baremetal CMakeLists 显式枚举源文件（非 glob）。

---

## 10. 降级与回滚

1. **运行期**：`SET_FAULTS` 全零 → 所有退化在阈值检查后旁路，直通，无需重编译；
2. **Git revert**：回退 Wave 2 提交即回基线（算法源保留，wasm setter/中间件移除）；
3. **编译期**：从 `pal_wasm` CMake 移除 `pal_wasm_physical.c` 并还原 `pal_gpio_read`/`pal_i2c_transfer` 退化。

---

## 11. 历史常量参考（ADR-0009，示例器件）

| 参数 | 值 |
|---|---|
| `BOUNCE_DURATION_US` | 10000（10ms） |
| DHT11 预热 | 1,000,000 µs |
| DHT11 最小采样间隔 | 2,000,000 µs |
| ADC RC tau | 0.05 s |
| ADC 噪声 | ±0.02 V |
| JSON 故障键 | `key_bounce_us`/`dht11_warmup_us`/`adc_noise_v`/`i2c_packet_drop_rate` |

> 故障域隔离与功耗模型是 Wave3 预埋 stub，见 [05 §5](./05-memory-and-faults.md)。

