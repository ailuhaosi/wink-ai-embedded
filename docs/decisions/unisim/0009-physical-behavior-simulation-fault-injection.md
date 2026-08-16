# ADR-0009：物理特性模拟与故障注入架构设计

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-06-27 |
| 触发 | 仿真一致性逃逸：“仿真通过，真机死锁”（Fidelity Escape）。DAL 直通旁路（Value Bypass）舍弃了微观电气与时序特性，导致软件消抖、传感器预热延迟、物理噪点过滤及驱动超时等防御性代码在 Web 端未经验证。 |
| 影响范围 | `targets/wasm` (Wasm HAL 适配层)、DAL 设备驱动模型、Wasm 仿真内核 (UniSim) 与前端测试面板交互协议 |
| 决策者 | 主架构师、仿真引擎开发团队 |

---

## 1. 背景 (Context)

在 [ADR-0003](./0003-simulation-fidelity-boundary.md) 中，WinkOS 明确了当前仿真为**“行为级高保真仿真”**，即仅保证业务逻辑的因果顺序与逻辑正确性，不保证电气及微秒级时序级保真。

然而，在实际开发与部署中，仿真与真机之间存在严重的**“一致性逃逸（Fidelity Escape）”**，其致命痛点表现在以下几个方面：

1. **按键抖动（Contact Bounce）缺失**：仿真端 GPIO 输入是“干净的理想跃变”（即 0 直接变 1）。开发人员在仿真中未编写按键去抖算法也能完美运行；但烧录到物理板子后，会由于机械按键抖动触发频繁的中断嵌套冲突或误触发，导致真机彻底死锁或逻辑混乱。
2. **传感器物理时序限制未建模**：诸如温湿度传感器（DHT11/DHT22）、超声波雷达等器件，在物理现实中存在**上电预热延迟（Warm-up Delay）**以及**最小采样间隔约束**（如两次读取需间隔 >2s）。若在仿真中以理想值直通，将无法暴露由于高频轮询导致的传感器无响应（Busy/Timeout）故障。
3. **模拟信号噪声与衰减缺失**：仿真中的 ADC 采样通常是完美的静态值。真机电路中由于电源纹波、电磁干扰和 RC 充放电效应，电平存在高频噪点和充放电滑移。缺少这一特性导致应用层的均值滤波、卡尔曼滤波等抗噪算法在仿真中无法得到验证。
4. **总线级瞬态故障无法验证**：I2C/SPI 总线由于导线接触不良、时钟拉伸（Clock Stretching）等原因可能导致通信暂时失败。仿真端默认总线 100% 可用，导致驱动代码中的**超时退回机制（Timeout Sentinel）**形同虚设，常在真机挂死。

为了在不大幅损耗 Web 端仿真性能（不引入昂贵的电信号网格仿真如 ngspice）的前提下，暴露出这些防御性代码漏洞，我们需要设计一个**轻量、高效且行为可信的物理特性模拟与故障注入机制**。

---

## 2. 方案比选 (Options)

### 方案 A：完全在 Web 前端 (JS/TS) 侧模拟物理特性
* **做法**：JS 侧在虚拟引脚电平变化时，向 Wasm 注入一连串的定时高频电平脉冲（模拟抖动）；在 I2C 传输回调中返回状态错误。
* **优点**：无需修改 Wasm 固件代码，JS 侧容易编写复杂的仿真时间线和可视化测试配置。
* **缺点**：
  * **IPC 开销大**：10ms 的按键抖动可能会产生数十次引脚电平改变，这会导致频繁触发 JS-Wasm 的边界调用，使浏览器主线程帧率骤降。
  * **时序不准**：JS 定时器（`setTimeout`）受浏览器线程调度及后台标签页限制，微秒/毫秒级时序极不精准。

### 方案 B：完全在 C/Wasm 侧 (Wasm 适配层) 内置物理模型
* **做法**：在编译 WASM 目标时，直接在 C 侧的驱动仿真层编写物理噪声和抖动逻辑。
* **优点**：运行性能高，无需跨越 JS-Wasm 边界；能直接结合 WASM 自身的虚拟微秒 Tick（SimTime），时序 100% 确定且可复现。
* **缺点**：
  * **缺乏环境联动**：C 侧代码是一个死沙箱，无法感知用户在前端 3D 渲染里的行为（例如小车撞到 3D 墙壁的事件），难以做动态交互仿真。
  * **代码侵入性高**：大量的 Mock 物理算法堆积在 C 侧，会导致大量的编译条件宏（`#ifdef`）破坏固件代码的可读性。

### 方案 C：双域混合架构（Hybrid / Double-Domain）—— 采纳方案
* **做法**：
  1. **JS 域（环境状态与大颗粒输入）**：仅维护宏观的“理想物理世界状态”（如当前空间温度 25°C、用户按下按键动作、3D 避障理想距离 32cm），并持有故障注入的配置。
  2. **C/Wasm 域（信号退化与微观时序适配）**：在 Wasm 适配层（`targets/wasm/pal_hal_wasm.c`）和驱动仿真桩中，接收来自 JS 的理想值，然后**就地（Local）利用 C 代码算法进行物理有损转换**（如抖动状态机展开、高斯白噪声叠加、RC 一阶低通仿真、预热时间差判定）。
* **比选结论**：**方案 C** 将大物理环境的交互性（留给 JS）与微观信号退化的时序精度及性能（留给 C/Wasm）做到了完美的隔离与解耦，是兼顾性能与保真度的最佳选择。

---

## 3. 详细设计 (Detailed Design)

```
 [ Web 前端 (JS/TS) ] ──( 理想物理状态: 32.0cm, 按钮Pressed )──>
                                  │
                                  ▼ (Wasm 导入导出契约)
 [ Wasm 适配层 (C) ]   ──( 信号退化变换 & 虚拟时钟 Tick )──> [ DAL 驱动及应用 (C) ]
    ├─ 1. 按钮抖动展开：按键变化时触发 10ms 的 0-1 振荡电平
    ├─ 2. ADC 噪声叠加：物理理想值 + RC 充放电公式 + 伪随机高斯噪点
    └─ 3. 时序约束判断：根据 pal_timer_get_us() 计算时间差，注入 WINK_ERR_BUSY/TIMEOUT
```

### 3.0 故障注入分层架构原则（强制执行）

**核心架构纪律**：采用「非侵入式中间件模式」，三层故障严格分离，确保外设逻辑保持纯净。

| 层级 | 处理位置 | 故障类型 | 对上层是否透明 |
|------|---------|---------|--------------|
| **第一层：PinManager 中间件** | `targets/*/pal_hal_*.c` | ✅ GPIO 断线（disconnect）、抖动（jitter）、上拉/下拉电阻失效、高阻态传播 | 是，`pal_gpio_read()` 自动返回退化后的值 |
| **第二层：总线控制器中间件** | `targets/*/pal_i2c_*.c` 等 | ✅ I2C ACK 丢失、SPI 位翻转、UART 帧错误、总线超时、仲裁丢失 | 是，`pal_i2c_write()` 自动返回退化后的错误码 |
| **第三层：外设驱动桩（业务层）** | `dal/*_sim.c` | ✅ 传感器超量程（Out of Range）、电机堵转、EEPROM 坏块等业务特有故障 | 否，驱动显式实现 |

**强制执行的反模式清单**：
- ❌ **禁止**：在外设驱动 `attachEvents()`/`read()`/`write()` 方法中直接操作引脚电平模拟断线
- ❌ **禁止**：每个外设各自实现抖动/噪声算法
- ❌ **禁止**：外设直接调用 `pinManager.setDriverLevel()` 模拟故障

**正确范例**：
```c
// ✅ 正确：DAL 驱动只关心正常逻辑，完全不知道故障注入的存在
bool button_level = pal_gpio_read(pin);  // PinManager 已透明应用了抖动
if (debounce(button_level)) {  // 驱动只需要实现正常的消抖逻辑
    trigger_callback();
}
```

---

### 3.1 按键抖动（Contact Bounce）的微观时序模拟

> ✅ **Wave 1 验证结论（2026-06-28，host PoC）**：下方骨架用 `(now/1000)%2` 生成抖动电平，该模型**强依赖采样周期**——系统默认 `WINK_RUNTIME_TICK_MS=10`（`wink_status.h:63`）下商每 tick 增 10（偶），电平锁死、抖动**静默失效**。host 试点已将抖动改为**每次采样强制翻转电平**（ctx 内 `bounce_flip` 位）：采样周期无关、100% 确定、且是最严苛抖动（每次采样必跳）。RC 噪声 / 总线丢包仍用 PRNG（§3.3/§4）。此修订已正式纳入架构规范。

当 JS 检测到虚拟按键状态改变时，仅通过 Bridge 发生单次通知。在 C 侧的 `pal_wasm_dispatch_pending_interrupts`（Wasm tick 边界）中拦截并实现抖动状态机：

```c
// targets/wasm/pal_hal_wasm.c 内部实现
static bool s_btn_real_state = false;
static uint64_t s_last_bounce_time = 0;
#define BOUNCE_DURATION_US 10000 // 10ms 抖动时间

void pal_wasm_dispatch_pending_interrupts(void) {
    bool target_state = js_pal_gpio_read(KEY_PIN); // 从 JS 获取大颗粒理想状态
    uint64_t now = pal_timer_get_us();            // 使用 Wasm 虚拟微秒时钟

    if (target_state != s_btn_real_state) {
        if (s_last_bounce_time == 0) {
            s_last_bounce_time = now;
        }
        
        if (now - s_last_bounce_time < BOUNCE_DURATION_US) {
            // 抖动期内：生成微秒级快速交替的物理电平
            bool bounced_level = ((now / 1000) % 2 == 0) ? target_state : !target_state;  /* ⚠ Wave 1 已改为强制交替，见本节顶部修订预告 */
            trigger_key_isr(bounced_level);
        } else {
            // 抖动结束：稳定在新电平
            s_btn_real_state = target_state;
            s_last_bounce_time = 0;
            trigger_key_isr(s_btn_real_state);
        }
    }
}
```

### 3.2 传感器时序约束与预热延迟模拟
在 Wasm 仿真对应的驱动适配层中，记录虚拟上电时间和读取间隔，强制暴露不合理的调用周期：

```c
// dal/dal_dht11_sim.c (仿真专属驱动桩)
wink_status_t dal_dht11_read(float* temp, float* humi) {
    uint64_t now = pal_timer_get_us(); // 虚拟时钟
    
    // 1. 模拟 DHT11 物理上电后 1 秒的预热延迟 (Warm-up Period)
    if (now < 1000000) {
        return WINK_ERR_BUSY; // 此时读取直接报错，逼迫应用层编写初始化等待
    }
    
    // 2. 模拟 DHT11 两次采样间隔必须大于 2 秒的物理限制
    static uint64_t last_read_time = 0;
    if (now - last_read_time < 2000000) {
        return WINK_ERR_TIMEOUT; // 轮询过快则返回超时错误
    }
    
    last_read_time = now;
    // 获取 JS 环境的理想物理温度值，随后加上噪点返回
    return js_sim_read_dht11_values(temp, humi);
}
```

### 3.3 模拟量 ADC 的噪声与电平滑移（一阶 RC 低通滤波）
为了模拟电容充放电引起的信号平滑过渡，以及热噪声带来的抖动：

$$V_{out}(t) = V_{target} + (V_{initial} - V_{target}) \cdot e^{-\Delta t/\tau} + Noise$$

```c
// targets/wasm/pal_hal_wasm.c 内部实现
static float s_current_adc_val = 0.0f;
static uint64_t s_last_adc_time = 0;

float pal_adc_read_voltage(uint8_t channel) {
    float target_val = js_pal_adc_get_ideal_voltage(channel);
    uint64_t now = pal_timer_get_us();
    float dt = (float)(now - s_last_adc_time) / 1000000.0f; // 转换为秒
    s_last_adc_time = now;

    // 1. 模拟一阶 RC 滤波延迟 (τ = 0.05s)
    float tau = 0.05f;
    if (dt > 0.0f) {
        s_current_adc_val = target_val + (s_current_adc_val - target_val) * expf(-dt / tau);
    } else {
        s_current_adc_val = target_val;
    }

    // 2. 叠加伪随机噪声 (PRNG 保证仿真确定性)
    static uint32_t rand_seed = 98765;
    rand_seed = (rand_seed * 1103515245 + 12345) & 0x7fffffff;
    float noise = ((float)(rand_seed % 1000) / 1000.0f - 0.5f) * 0.04f; // ±0.02V 噪点

    return s_current_adc_val + noise;
}
```

---

## 4. 关键设计纪律 (Safeguards & Compliance)

### 4.1 仿真确定性守卫（SimTime Alignment）
* **纪律**：**所有物理特性的动态结算，严禁挂载在 JS 真实墙钟或 Wasm 物理时间上**。
* **实现**：必须使用 `pal_timer_get_us()` 或 `pal_timer_get_ms()` 作为时间基准。该时间完全由 Wasm 的虚拟时钟驱动，不受宿主机 CPU 卡顿、浏览器 Tab 切换后台挂起等影响。
* **随机数种子绑定**：所有物理噪声的生成，必须使用带初始 Seed 的伪随机数生成器（PRNG），禁止使用 `rand()` 或 `Math.random()`。确保同一个 Seed 运行能 100% 复现真机死锁。

### 4.2 参数化故障注入配置接口
前端工作台可以通过配置文件或调试控制台向 Wasm 传输故障配置 JSON：
```json
{
  "faults": {
    "key_bounce_us": 10000,
    "dht11_warmup_us": 1000000,
    "adc_noise_v": 0.02,
    "i2c_packet_drop_rate": 0.005
  }
}
```
Wasm Bridge 接收此配置并写入全局配置 POD，供 PAL 仿真层动态调节滤波常数与干扰强度。

### 4.3 零编译污染 (Zero Compiler Intrusion)
* **要求**：物理特性模拟的相关逻辑，必须严格隔离在 `targets/wasm` 及含有 `#if defined(SIMULATION)` 宏的驱动桩中。
* **检查**：编译 `targets/esp32` 或 `targets/baremetal` 时，编译产物中绝对不能存在任何关于“抖动模拟、高斯噪点、预热延迟”的代码与静态数据，避免损耗真机的 ROM/RAM 资源。

---

## 5. 后果与负面效应 (Consequences)

* **优点**：
  * **消除“虚假安全感”**：开发者在 Web 端仿真时如果不写消抖算法、不进行滤波处理，就会直接观察到引脚触发多次中断、波形漂移，极力逼迫开发者写出健壮的嵌入式防御性代码。
  * **保证仿真执行性能**：微观算法在 Wasm 内部以 C 执行，完全避免了高频跨越 Wasm-JS 桥的性能开销，Web 端动画依然能保持流畅的 60 FPS。
* **代价/风险**：
  * **开发复杂度增加**：在开发 Wasm 仿真适配器（`targets/wasm`）时，需要为常见外设定制其物理行为模型，增加了平台开发团队的维护工作量。
  * **仿真调试门槛**：应用层代码因为噪声的加入可能会在仿真中出现非预期的输出，开发人员必须适应在仿真中调试带噪声的信号，对初学者调试带来一定门槛（可提供“理想模式 / 物理噪声模式”一键切换）。

---

## 6. 状态记录与未来演进

* **2026-06-27**：Proposed（架构师提议，引入混合双域模型，以针对性修复仿真一致性逃逸）。
* **2026-06-28：host 试点 Wave 1 落地（状态仍 Proposed；本记录为 PoC 验证，非 Acceptance）**：
  target 无关物理退化算法库 `pal/src/wink_sim_physical.c`（抖动状态机 / RC 低通+噪声 / 确定性 PRNG /
  warmup+采样间隔 / 总线丢包，五算法 host 全单测）+ 按键抖动接 `dal_button` 端到端**含负对照**（无去抖裸采样
  误触发 vs `dal_button` 去抖稳定，证明 §3.1「不写去抖则误触发」）+ 参数化 `wink_sim_faults_t`。
  确定性守卫（§4.1）在 host 满足（虚拟时钟 `pal_get_us`）；零编译污染（§4.3）：算法库仅进 `pal_host` OBJECT
 （esp32/baremetal CMake **显式枚举**源，已核验非 glob）。
  **对 §3.1 的修订项**：抖动电平模型由骨架的 `(now/1000)%2` 改为**每次采样强制翻转**（ctx 内 1 个翻转位 `bounce_flip`）。
  原因：`(now/P)%2` 强依赖采样周期——系统默认 `WINK_RUNTIME_TICK_MS=10`（`wink_status.h:63`）下商每 tick 增 10（偶），
  电平锁死、抖动静默失效；改质数 997 亦仅对特定 tick 有效（凡 `Δnow/P` 商增量为偶即混叠）。强制交替：采样周期无关、
  100% 确定、且是最严苛抖动（每次采样必跳）。RC 噪声 / 总线丢包仍用 PRNG（§4.1）。
  详见 [Wave 1 计划](../../implementation-plans/unisim/2026-06-28-adr-0009-host-pilot-physical-sim-wave1-plan.md)。
  Wave 2（新外设端到端）：ADC PAL+DAL、DHT11 预热、I2C-drop 挂 ssd1306，后置。
* **2026-06-29：Accepted（架构师确认，方案 C 双域混合架构正式采纳）**：
  host PoC 完整验证了 §3 所有核心算法的正确性与可行性，**架构决策已被证实为正确路径**。
  Wasm 虚拟时钟是 Wave 2 实施项（非架构决策前置），不影响本 ADR 的 Acceptance。
  **回写关联**：决策细节与 API 规范已同步至
  [`04-wasm-simulation/06-physical-degradation-engine.md`](../../design/04-wasm-simulation/archive/06-physical-degradation-engine.md)。
* **2026-06-29：Wave 2 落地（wasm 端到端实施完成）**：
  落地范围（六个 Task 全数完成，详见 [Wave 2 计划](../../implementation-plans/unisim/2026-06-29-adr-0009-wasm-physical-sim-wave2-plan.md)）：
  - **Task 1（SSOT 虚拟时钟 + 算法库 CMake）**：`targets/wasm/pal_osal_wasm.c` 中
    `s_virtual_us` 为 wasm 侧唯一时钟源；`pal_wasm_advance_virtual_clock(uint64_t us)`
    是唯一写入入口并以 `EMSCRIPTEN_KEEPALIVE` 导出；**架构红线**：`pal_delay_ms/us()`
    禁止主动步进时钟（避免双重步进 / 因果倒置），时钟推进由 JS Worker 在恢复
    wasm 协程前驱动。算法库 `targets/common/src/wink_sim_physical.c` 一份源码同时被
    `pal_host` 与 `pal_wasm` 编译，golden 向量双端共享（`test/common/test_physical_golden.h`）。
  - **Task 2（退化引擎 + 故障配置 setters + 边界保护）**：`targets/wasm/pal_wasm_physical.c`
    封装算法库，导出 `pal_wasm_set_*` setters + `pal_wasm_reset_physical()`。
    `WASM_SIM_MAX_PINS=128` 边界检查防止 JS 越界 pin 写入 BSS；PRNG 全局有意单实例
    （§4.1 单 seed 决定整机轨迹）；fault POD 初始 `{0}` 等同 ideal 直通。
  - **Task 3（GPIO 抖动中间件 + I2C 丢包中间件）**：`pal_hal_wasm.c::pal_gpio_read()`
    透明应用抖动状态机（与 host 算法库完全同源，每次采样强制翻转 `bounce_flip`）；
    `pal_i2c_transfer()` 在 PRNG 命中丢包阈值时返回 `WINK_ERR_TIMEOUT`，对驱动透明。
  - **Task 4（按键消抖端到端 WASM 测试）**：`test/wasm/test_button_debounce_e2e_wasm.c`
    构造跃变序列，断言「裸采样误触发 vs `dal_button` 消抖稳定」与 host
    golden 双端字节级一致。
  - **Task 5（UniSim Worker 桥接）**：`../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts` +
    `worker/WasmPhysicalBridge.ts` + `worker/SimWorker.ts`，bigint 严格契约
    （CMake `-s WASM_BIGINT=1`），消息协议 `INIT / SET_FAULTS / STEP_CLOCK /
    SET_GPIO_IDEAL / READ_GPIO_DEGRADED / TEST_I2C_TRANSFER`。Jest 76 用例全绿。
  - **Task 6（本条目）**：SSOT 静态断言通过（grep 验证 `pal_delay_ms` 体内不调
    `pal_wasm_advance_virtual_clock`），ADR 状态本次正式确认，设计规范回写完成。
  - 零编译污染（§4.3）持续生效：esp32 / baremetal 目录无 `wink_sim_physical` /
    `pal_wasm_physical` 符号引用。
  - 已知遗留：`targets/host/pal_hal_host.c` 因更早期 `wink_pin_t` HAL 签名重构
    （commit `7469aba`）存在编译错误，**与 Wave 2 无关**，将在独立提交修复。
* **下阶段演进**：
  * **Phase 4**：重构 `targets/wasm/pal_hal_wasm.c`，引入 ADC 物理滤镜试点（GPIO
    抖动 / I2C 丢包已于 Wave 2 落地，按键端到端已验证）。
  * **Phase 5**：定义并下发 `wink_sim_faults.json` 配置标准，在前端仿真控制面板
    提供“物理故障与噪声注入”调试滑块（Worker `SET_FAULTS` 协议已就位）。

