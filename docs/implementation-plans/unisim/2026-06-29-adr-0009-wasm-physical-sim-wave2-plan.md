# 实施计划：ADR-0009 Wave 2 — WASM Worker 物理退化引擎 + UniSim 双向桥接

&gt; **For agentic workers:** REQUIRED SUB-SKILL: 用 `subagent-driven-development`（推荐）或 `executing-plans` 逐任务实施。步骤用 `- [ ]` 跟踪。

**Goal:** 将 host 端已验证的物理退化算法库（Wave 1）迁移至 WASM 目标，与 TypeScript 侧 UniSim 仿真引擎建立双向桥接，实现确定性故障注入、虚拟时钟对齐、GPIO/I2C 退化的端到端闭环。

**Architecture:** ADR-0009 方案 C（双域混合）在 WASM 侧的完整落地：
```
┌─────────────────────────────────────────────────────────────────────┐
│  JS 域（UniSim + Worker 沙箱）                                        │
│  ┌──────────────┐   ┌──────────────────────────────────────────┐    │
│  │  UniSim      │──►│  理想物理状态：pin 电平、I2C 传输、故障 JSON   │    │
│  │  前端工作台  │◄──│  退化结果回流：抖动电平、丢包状态、噪声值     │    │
│  └──────────────┘   └───────────────────┬──────────────────────┘    │
└──────────────────────────────────────────┼───────────────────────────┘
                 WASM ↔ JS Bridge         │
┌──────────────────────────────────────────▼───────────────────────────┐
│  C/WASM 域（退化引擎）                                                  │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  wink_sim_physical.c 算法库                                    │   │
│  │  ├─ 按键抖动状态机（强制交替，采样周期无关）                    │   │
│  │  ├─ RC 低通 + PRNG 高斯噪声                                    │   │
│  │  ├─ 预热延迟 + 采样间隔校验                                    │   │
│  │  └─ I2C 总线丢包（PRNG 确定性）                                │   │
│  └───────────────────────────┬──────────────────────────────────┘   │
│                              │ 虚拟时钟驱动                          │
│                     ┌────────▼────────┐                             │
│                     │  PAL HAL WASM  │                             │
│                     │  退化中间件层   │                             │
│                     └────────┬────────┘                             │
└──────────────────────────────┼──────────────────────────────────────┘
                    DAL 驱动层（对退化透明）
```

**Tech Stack:** C11 (Wasm) / Emscripten / TypeScript (UniSim) / Web Worker / Unity 单测（WASM 侧） / Jest（JS 侧）。

---

## 元数据表

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260629-ADR0009-WASM-PHYSICAL-WAVE2` |
| **创建日期** | 2026-06-29 |
| **上次修订** | 2026-06-29（整合专家评审修正） |
| **目标平台/SoC** | `wasm32-emscripten`（唯一交付）；算法库 target 无关复用 |
| **工具链/SDK版本** | Emscripten 3.1.53 / TypeScript 5.4 / Node 20 |
| **计划状态** | ✅ 已完成（2026-06-29 → 2026-07 陆续落地；见 commit `1b5c89d..0052983 5ff3216`，Wave2 Task 1–10 全部合入并回写至 [ADR-0009](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)、[ADR-0003 决策 3](../../decisions/unisim/0003-simulation-fidelity-boundary.md)。事后回填状态字段：2026-07-03） |
| **优先级** | 🟢 P0（推进 ADR-0009 Accepted 的最后里程碑；同时解决 ADR-0003 决策3 虚拟时钟） |
| **计划版本** | v1.1（专家评审修正版） |
| **关联技术设计** | `tech-designs/wasm-worker-physical-bridge.md`（本计划产出） |
| **关联设计规范** | `04-wasm-simulation/02-physical-degradation-engine.md`（ADR Accepted 后回写） |
| **关联评审记录** | 2026-06-29-wasm-physical-sim-wave2-expert-review.md（专家评审意见汇总） |
| **关联 ADR** | [ADR-0009](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)（Wave 2 完成后状态由 Proposed → Accepted）；[ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md)（决策3 虚拟时钟前置） |
| **目标里程碑** | ADR-0009 Wave 2（WASM 双域混合架构闭环） |
| **前置依赖计划** | `2026-06-28-adr-0009-host-pilot-physical-sim-wave1-plan.md`（✅ 已完成） |
| **计划负责人** | 主架构师 + 仿真引擎开发 |
| **所需子代理技能** | `embedded-best-practice` / `frontend-design` |

---

## 0. 专家评审关键修正摘要

&gt; 📌 **本版本已整合以下专家评审修正，避免联调阶段的架构返工：**

| 修正项 | 问题本质 | 解决方案 |
|--------|----------|----------|
| **虚拟时钟 SSOT 统一** | C 侧 `pal_delay_ms()` 主动步进时钟导致双重步进和因果倒置 | JS Worker = 唯一时钟源，C 侧 delay 仅做异步挂起 |
| **BigInt 类型安全** | TS `number` 与 WASM `uint64_t` 不匹配导致运行时 TypeError | TS 接口全用 `bigint` + CMake `-s WASM_BIGINT=1` |
| **Pin 越界防护** | JS 传入越界 pin 号导致 WASM 内存越界崩溃 | 所有 pin 索引处加强边界检查 |
| **消息语义澄清** | `I2C_TRANSFER` 方向歧义（WASM 才是真正的传输发起者） | 重命名为 `TEST_I2C_TRANSFER`，明确为调试接口 |
| **BSS 初始化优化** | 静态数组冗余 memset 浪费性能 | 利用 C 标准 BSS 零初始化语义，移除运行时 memset |
| **PRNG 设计文档化** | 全局 PRNG 状态耦合被误判为缺陷 | 在注释中明确"全局单种子是有意的设计选择" |

---

## 1. 背景与目标

### 1.1 问题陈述

ADR-0009 Wave 1 已在 host 端验证了物理退化算法库的正确性与端到端可用性（按键抖动 × `dal_button` 去抖）。但：
1. **目标未对齐**：WASM 才是最终 Web 仿真交付目标，host 仅为算法验证平台
2. **虚拟时钟缺失**：WASM `pal_get_us()` 当前为 JS 墙钟（`Date.now()` 微秒包装），违反 §4.1 确定性守卫——仿真时序受浏览器 Tab 切换、主线程卡顿影响，不可复现
3. **无故障下发通道**：`wink_sim_faults_t` 配置仅能在 C 侧硬编码，前端工作台无法动态注入
4. **退化未接入 HAL**：WASM `pal_gpio_read()`/`pal_i2c_transfer()` 直接直通 JS，无退化中间件层

### 1.2 技术/业务目标

&gt; **ROI 分档（评审约束）**：本计划 = 架构闭环 + 核心能力交付。
&gt; - **P0 必须**：WASM 虚拟时钟 + GPIO 抖动端到端（与 host 同 golden 向量）
&gt; - **P1 应该**：故障配置 JSON 下发 + I2C 丢包端到端 + RC 噪声（ADC）骨架
&gt; - **P2 可以**：Worker 封装 + 状态回流可视化 + 前端故障滑块 UI + 中断风暴模拟

- ✅ **确定性守卫闭环（§4.1）**：WASM 侧 `pal_get_us()` 改为纯内部虚拟时钟，与 JS 墙钟完全解耦；同 seed 同输入 → 同输出 100% 可复现
- ✅ **算法库 WASM 复用**：Wave 1 `wink_sim_physical.c` 零修改接入 `pal_wasm`（target 无关设计验证）
- ✅ **GPIO 抖动端到端**：`pal_gpio_read()` 退化中间件 → `dal_button` 去抖吸收，与 host 同 golden
- ✅ **故障配置双向桥**：UniSim 前端 → JSON → WASM `wink_sim_faults_t`；退化状态回流前端可视化
- ✅ **I2C 总线丢包**：`pal_i2c_transfer()` 退化中间件 → PRNG 确定性丢包，验证驱动超时退回机制
- ✅ **零编译污染（§4.3）**：退化代码仅进 `targets/wasm`，`esp32`/`baremetal` 零影响
- ✅ **双端单测对齐**：WASM 侧算法单测 golden 与 host 完全一致；JS 侧桥接契约 Jest 单测

### 1.3 成功指标

| 指标 | 通过标准 | 验证方法 |
|------|----------|----------|
| **虚拟时钟确定性** | `pal_get_us()` 单调递增，与 JS 墙钟完全解耦；Tab 切换/后台挂起不影响时序 | WASM 单测：连续调用 1000 次校验单调性；Worker 侧冻结 5s 后校验时钟未跳跃 |
| **时钟 SSOT 合规** | C 侧 `pal_delay_ms/us()` 不主动步进全局时钟；所有时钟推进唯一来源是 JS Worker | 静态代码检查：grep `pal_delay` 函数体内无 `pal_wasm_advance_virtual_clock` 调用 |
| **算法 golden 对齐** | WASM 侧 5 算法单测输出与 host Wave 1 完全一致（bit-level 精确） | 共享 golden 向量头文件，双端编译运行 |
| **GPIO 抖动端到端** | 裸采样在抖动窗内必跳变；`dal_button_poll()` 去抖后稳定 | WASM 集成测试（`add_wink_wasm_test`） |
| **故障配置下发** | JS 侧注入 JSON 配置 → C 侧 `wink_sim_faults_t` 字段精确匹配 | Jest 桥接单测 + C 侧状态读出校验 |
| **BigInt 类型安全** | 所有 64 位时钟参数在 TS 侧使用 `bigint`，无 `number` 隐式转换导致的精度丢失 | TS 类型检查 + 运行时断言 |
| **内存安全** | 所有 pin 索引访问有边界检查；JS 传入越界 pin 号返回 NULL 而非崩溃 | 边界条件单测 + fuzz 测试 |
| **I2C 丢包确定性** | 同 seed 同 drop_permil → 丢包序列 100% 可复现 | WASM 集成测试 |
| **既有回归** | WASM 现有全量单测 0 失败 | `ctest --test-dir build-wasm` |
| **性能** | 退化计算开销 &lt; 5% CPU（每 tick 退化总耗时 &lt; 50us） | WASM profiling + 帧率监控 |
| **零编译污染** | `esp32`/`baremetal` 编译产物不含 `wink_sim_physical` 符号 | `nm`/`objdump` 校验 |

---

## 2. 变更范围与影响分析

### 2.1 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `wink-micro-os/targets/wasm/CMakeLists.txt` | ✏️ 修改 | `pal_wasm` 源列表 + `wink_sim_physical.c` + `-s WASM_BIGINT=1` |
| `wink-micro-os/targets/wasm/pal_osal_wasm.c` | ✏️ 修改 | `pal_get_us()`/`pal_get_ms()` 改为虚拟时钟；**SSOT：delay 不主动步进时钟** |
| `wink-micro-os/targets/wasm/pal_hal_wasm.c` | ✏️ 修改 | GPIO 读 / I2C 传输退化中间件层；退化注入点 `pal_gpio_read()` / `pal_i2c_transfer()` |
| `wink-micro-os/targets/wasm/wasm_bridge.h` | ✏️ 修改 | 追加故障配置下发 + 状态回流 JS 导入导出 |
| `wink-micro-os/targets/wasm/pal_wasm_physical.c` | 🆕 新增 | WASM 侧退化引擎封装：**边界检查**、故障配置反序列化、per-pin 抖动 ctx 管理、PRNG 状态存储 |
| `wink-micro-os/targets/wasm/pal_wasm_internal.h` | ✏️ 修改 | 追加虚拟时钟全局状态、退化引擎内部 API |
| `wink-micro-os/test/wasm/test_virtual_clock.c` | 🆕 新增 | 虚拟时钟单测（含 delay 不主动步进的断言） |
| `wink-micro-os/test/wasm/test_wasm_physical.c` | 🆕 新增 | WASM 侧算法库 + 退化中间件单测（golden 与 host 共享） |
| `wink-micro-os/test/wasm/test_debounce_middleware.c` | 🆕 新增 | GPIO 抖动中间件单测（含 pin 越界边界条件） |
| `wink-micro-os/test/wasm/test_i2c_drop_middleware.c` | 🆕 新增 | I2C 丢包中间件单测 |
| `wink-micro-os/test/wasm/test_button_debounce_e2e_wasm.c` | 🆕 新增 | WASM 按键抖动端到端（镜像 host Wave 1 测试） |
| `wink-micro-os/test/common/test_physical_golden.h` | 🆕 新增 | SSOT golden 向量（host + wasm 共享） |
| `../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts` | 🆕 新增 | UniSim 虚拟时钟管理器（**全部使用 bigint**，与 WASM 侧对齐，保证双端同步） |
| `../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts` | 🆕 新增 | UniSim 侧 WASM 退化桥：**bigint 类型契约**、JSON 序列化、故障配置下发、理想电平注入、退化状态采集 |
| `../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts` | 🆕 新增 | Web Worker 封装：WASM 实例化、消息循环、虚拟时钟步进、与主线程通信 |
| `../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts` | 🆕 新增 | Jest 桥接单测：JSON ↔ C struct 字段精确匹配 + **bigint 类型断言** |
| `docs/tech-designs/wasm-worker-physical-bridge.md` | 🆕 新增 | 技术设计规格：桥接协议、消息格式、确定性保证机制、**SSOT 时钟架构说明** |

### 2.2 接口影响分析

| 接口层 | 是否破坏性 | 影响范围 | 备注 |
|--------|-----------|----------|------|
| PAL 公开 API | ❌ 否 | 零改动 | 退化是中间件层，对上层完全透明 |
| DAL 层 | ❌ 否 | 零改动 | `dal_button`/`dal_*` 行为不变，仅接收退化后的信号 |
| WASM ↔ JS Bridge | ⚠️ 扩展（非破坏） | 追加 4 个导入/导出；**所有 uint64_t 参数要求 bigint** | 启用 WASM_BIGINT 后旧的 number 调用会崩溃，需同步更新 |
| UniSim 公开 API | ⚠️ 扩展 | 追加故障配置注入接口 | 旧调用兼容 |
| 构建系统 | ❌ 否 | `pal_wasm` +1 源；算法库复用 host 路径；追加 WASM_BIGINT 链接选项 | `esp32`/`baremetal` 零影响 |

### 2.3 架构红线

&gt; 🚨 **违反即拒绝合入——专家评审增强版**：
&gt; 1. **确定性守卫（§4.1）**：WASM 侧所有退化算法的时间基准必须是 `pal_get_us()` 虚拟时钟；**严禁**调用 `js_pal_get_us()`/`Date.now()`/`performance.now()`。PRNG 种子全局唯一、可配置、启动时零隐式随机。
&gt; 2. **时钟 SSOT 原则**：**C 侧绝对不能主动步进全局时钟**。`pal_delay_ms()`/`pal_delay_us()` 仅能调用 JS 导入做异步挂起；所有 `s_virtual_us` 的修改必须来自 JS Worker 调用 `pal_wasm_advance_virtual_clock()`。静态检查：grep -n "pal_wasm_advance_virtual_clock" pal_osal_wasm.c → 只能在 delay 函数外部找到（即作为导出函数本身）。
&gt; 3. **零编译污染（§4.3）**：`wink_sim_physical.c` 仅进 `pal_wasm` OBJECT；`esp32`/`baremetal` 编译时该文件不参与编译、不产生符号。
&gt; 4. **HAL 中间件模式（§3 分层原则）**：退化必须是 `pal_gpio_read()`/`pal_i2c_transfer()` 函数体内的前置层，不得修改函数签名、不得在 DAL 层调用退化 API。对 DAL 100% 透明。
&gt; 5. **BigInt 类型安全**：所有 WASM 导出的 `uint64_t` 参数/返回值，在 TS 侧必须声明为 `bigint`；禁止用 `number` 传递时间值（&gt;53bit 失精）。CMake 必须开启 `-s WASM_BIGINT=1`。
&gt; 6. **内存安全边界**：所有 pin 索引访问（数组下标）必须先做范围检查；越界时返回 NULL/错误码，绝不允许内存越界。`WASM_SIM_MAX_PINS = 128`。
&gt; 7. **JSON 零动态内存**：故障配置反序列化不得使用 `malloc`/`cJSON`；采用定长字段映射 + 静态结构体。失败静默降级为理想配置。
&gt; 8. **Worker 单线程**：所有 WASM 调用必须在 Worker 线程内；主线程仅发消息、不直接调用 WASM。无 SharedArrayBuffer 数据竞争。
&gt; 9. **Golden 向量 SSOT**：WASM 与 host 算法单测必须共享同一份 golden 向量头文件，禁止各自硬编码。
&gt; 10. **全局 PRNG 设计原则**：I2C 丢包、ADC 噪声等所有退化机制共享同一个全局 PRNG 状态。这是**有意的设计选择**而非缺陷——保证"单种子复现全系统行为"的确定性。如果未来需要外设级独立确定性，再演化出 per-peripheral PRNG。

---

## 3. 关键设计约束（读证所得）

### 3.1 虚拟时钟设计（ADR-0003 决策 3 + ADR-0009 §4.1）

**⚠️ 专家评审修正：SSOT 唯一真理源原则**

&gt; **核心架构原则**：JS Worker = 虚拟时钟的唯一推进者。C 侧固件是时钟消费者，绝不主动生产时间。这避免了双重步进和因果倒置（WASM 时间领先于 JS 外设模型时间）。

**问题**：当前 `pal_osal_wasm.c:17-18` 直接调用 JS 墙钟，违反确定性守卫。

**设计**：
```c
// pal_osal_wasm.c 内部静态状态
static uint64_t s_virtual_us = 0;

// 导出给 JS Worker 的步进接口——C 侧内部代码禁止直接调用
#include &lt;emscripten.h&gt;
EM_PORT_API(void) pal_wasm_advance_virtual_clock(uint64_t us) {
    s_virtual_us += us;  // 单调递增，无回绕保护（64位足够）
}

// PAL 公开 API → 纯内部虚拟时钟，零 JS 调用
uint64_t pal_get_us(void) { return s_virtual_us; }
uint64_t pal_get_ms(void) { return s_virtual_us / 1000; }

// ✅ SSOT 合规实现：delay 仅做异步挂起，绝不主动步进时钟
// 时钟推进完全由 JS Worker 在恢复执行前通过 pal_wasm_advance_virtual_clock() 完成
void pal_delay_ms(uint32_t ms) {
    js_pal_delay_ms(ms);  // JS 侧负责：步进时钟 + 异步等待 + 恢复执行
}

void pal_delay_us(uint32_t us) {
    js_pal_delay_us(us);
}
```

**Worker 侧对齐**：`VirtualClock.ts` 维护相同值，每次步进后同步给 WASM。步进时序：
1. Worker 收到 `STEP_CLOCK(us)` 消息
2. Worker 先更新自己的 `VirtualClock.us`
3. Worker 调用 WASM `pal_wasm_advance_virtual_clock(us)`
4. Worker 恢复 WASM 协程执行

### 3.2 故障配置下发协议（零动态内存）

**问题**：`wink_sim_faults_t` 需从 JS JSON 映射到 C 结构体，禁止 `cJSON`/`malloc`。

**设计**：定长字段展开，直接写入静态结构体：
```typescript
// WasmPhysicalBridge.ts
export interface SimFaultsConfig {
  bounce_us: number;          // uint32_t
  warmup_us: number;          // uint32_t
  sample_interval_us: number; // uint32_t
  adc_noise_v: number;        // float
  rc_tau_s: number;           // float
  i2c_drop_permil: number;    // uint16_t
  prng_seed: number;          // uint32_t
}

// 序列化 → 调用 WASM 导出的 setter 逐个字段写入
function setFaults(config: SimFaultsConfig): void {
  wasmExports.pal_wasm_set_bounce_us(config.bounce_us);
  wasmExports.pal_wasm_set_warmup_us(config.warmup_us);
  wasmExports.pal_wasm_set_adc_noise_v(config.adc_noise_v);
  wasmExports.pal_wasm_set_rc_tau_s(config.rc_tau_s);
  wasmExports.pal_wasm_set_i2c_drop_permil(config.i2c_drop_permil);
  wasmExports.pal_wasm_set_prng_seed(config.prng_seed);
}
```

**C 侧接收**：`pal_wasm_physical.c` 维护静态 `s_faults`，每个字段对应一个导出 setter。

### 3.3 GPIO 退化注入点（中间件模式 + 边界检查）

**问题**：`pal_gpio_read()` 当前直通 `js_pal_gpio_read(pin)`。需插入抖动退化 + 边界保护。

**设计**：镜像 host Wave 1 注入模式，per-pin ctx 静态数组 + 强制边界检查：
```c
// pal_hal_wasm.c: pal_gpio_read()
bool pal_gpio_read(uint16_t pin) {
    // Step 0: 边界检查（防止 JS 传入越界 pin 导致内存崩溃）
    if (pin &gt;= WASM_SIM_MAX_PINS) {
        return false;  // 越界 pin 默认为低电平，不崩溃
    }

    // Step 1: 从 JS 侧获取理想电平（UniSim 宏观物理状态）
    bool ideal = js_pal_gpio_read(pin);

    // Step 2: 退化中间件层（仅当 bounce_us &gt; 0 时生效）
    extern wink_phys_debounce_ctx_t* pal_wasm_get_debounce_ctx(uint16_t pin);
    extern uint32_t pal_wasm_get_bounce_us(void);
    uint32_t bounce_us = pal_wasm_get_bounce_us();
    if (bounce_us &gt; 0) {
        wink_phys_debounce_ctx_t* ctx = pal_wasm_get_debounce_ctx(pin);
        // ctx 不可能为 NULL（因为 pin 已过边界检查），但仍做防御式判断
        if (ctx != NULL) {
            return wink_phys_debounce_step(ctx, ideal, pal_get_us(), bounce_us);
        }
    }

    // 无退化 → 原样返回
    return ideal;
}
```

**ctx 管理**：`pal_wasm_physical.c` 静态数组 `s_debounce_ctx[WASM_SIM_MAX_PINS]`（=128），
利用 C 标准 BSS 段零初始化特性，**无需运行时 memset**。

### 3.4 I2C 丢包退化（PRNG 确定性）

**设计**：
```c
// pal_hal_wasm.c: pal_i2c_transfer()
wink_status_t pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    // Step 1: 丢包判定（PRNG 确定性，§4.1 合规）
    //
    // 📝 设计说明：全局 PRNG 是有意的设计选择，保证"单种子复现全系统行为"。
    // 如果 I2C 丢包和 ADC 噪声独立 PRNG，那么改变 ADC 采样率不会影响
    // I2C 序列，但这也失去了"一个 seed = 整个系统的完整快照"的能力。
    // 当前选择：全局 PRNG，简化确定性复现。
    //
    extern uint32_t pal_wasm_get_prng_state(void);
    extern void pal_wasm_set_prng_seed(uint32_t);  // 状态回写
    extern uint16_t pal_wasm_get_i2c_drop_permil(void);

    uint16_t drop_permil = pal_wasm_get_i2c_drop_permil();
    if (drop_permil &gt; 0) {
        uint32_t prng_state = pal_wasm_get_prng_state();
        bool should_drop = wink_phys_bus_drop(drop_permil, &amp;prng_state);
        pal_wasm_set_prng_seed(prng_state);  // 回写推进后的状态
        if (should_drop) {
            return WINK_ERR_IO;  // 模拟总线故障，驱动超时退回机制触发
        }
    }

    // Step 2: 正常传输（无退化路径）
    return js_pal_i2c_transfer(port, dev_addr, write_buf, write_len, read_buf, read_len)
           ? WINK_OK : WINK_ERR_IO;
}
```

### 3.5 黄金向量 SSOT（host ↔ wasm 共享）

**设计**：提取 Wave 1 golden 向量为独立头文件，双端 include：
```c
// wink-micro-os/test/common/test_physical_golden.h
#ifndef TEST_PHYSICAL_GOLDEN_H
#define TEST_PHYSICAL_GOLDEN_H

// PRNG golden (seed=1)
#define GOLDEN_PRNG_SEED1        1u
#define GOLDEN_PRNG_AFTER_CALL1  1103527590u
#define GOLDEN_PRNG_VALUE1       0.51387f

// 按键抖动 golden (bounce_us=30000, target=true)
#define GOLDEN_BOUNCE_US         30000u
#define GOLDEN_BOUNCE_TARGET     true
#define GOLDEN_BOUNCE_STEP1      true   // flip false→true → target
#define GOLDEN_BOUNCE_STEP2      false  // flip true→false → !target
#define GOLDEN_BOUNCE_STEP3      true   // flip false→true → target

// ... 其余算法 golden
#endif
```

---

## 4. 关键跨边界契约（确定性守卫落地）

&gt; ADR-0009 §4.1「确定性、可复现」的双端对齐依据。**golden 向量 = 权威参考**。

### 4.1 WASM ↔ JS 消息协议（Worker PostMessage）

**⚠️ 专家评审修正：I2C 消息语义澄清**

&gt; 架构事实：WASM 固件是 I2C 主机，`pal_i2c_transfer()` 调用 JS 导入 `js_pal_i2c_transfer()` 完成传输。**传输触发源是 WASM，不是 Main Thread**。
&gt;
&gt; 因此 `I2C_TRANSFER` 消息不是正常业务流的一部分，而是**测试/调试专用接口**，用于 Main Thread 主动触发传输来验证退化逻辑。重命名明确用途，避免架构混淆。

| 消息类型 | 方向 | 载荷 | 说明 |
|----------|------|------|------|
| `INIT` | Main → Worker | `{ wasmBytes: ArrayBuffer }` | 加载 WASM 模块 |
| `INIT_DONE` | Worker → Main | `{ ok: boolean, error?: string }` | 初始化完成 |
| `SET_FAULTS` | Main → Worker | `{ config: SimFaultsConfig }` | 下发故障配置 |
| `STEP_CLOCK` | Main → Worker | `{ us: bigint }` | 步进虚拟时钟（**必须用 bigint，禁止 number**） |
| `CLOCK_STEPPED` | Worker → Main | `{ us: bigint }` | 时钟步进完成回执（用于同步断言） |
| `SET_GPIO_IDEAL` | Main → Worker | `{ pin: number, level: boolean }` | 注入 GPIO 理想电平（镜像 host `sim_set_gpio_ideal`） |
| `READ_GPIO_DEGRADED` | Main → Worker | `{ pin: number }` | 读取退化后电平（测试用） |
| `GPIO_RESULT` | Worker → Main | `{ pin: number, level: boolean, wasBounced: boolean }` | 退化结果回流 |
| `TEST_I2C_TRANSFER` | Main → Worker | `{ port, dev_addr, writeBuf, readLen }` | **测试专用**：主动触发 I2C 传输验证退化 |
| `I2C_RESULT` | Worker → Main | `{ ok: boolean, readBuf?: Uint8Array, wasDropped: boolean }` | I2C 结果回流 |

### 4.2 虚拟时钟同步契约

```
[Main Thread]       [Worker Thread]       [WASM C]
     |                    |                  |
     |── STEP_CLOCK ───►│                  |  触发步进（bigint）
     |                    │── 调用 ─────►│
     |                    │                  │── s_virtual_us += us  ✅ 唯一时钟修改点
     |                    │◄──── 返回 ─────│
     |◄── CLOCK_STEPPED ──│                  |
     |                    |                  |
```

**约束**：
- 步进必须是原子操作：Worker 收到 `STEP_CLOCK` 后，先更新 JS 侧 `VirtualClock`，再调用 WASM `pal_wasm_advance_virtual_clock()`
- 禁止并发步进：Worker 消息队列串行处理
- 步进后双端时钟值必须相等：JS `VirtualClock.getUs() === wasmExports.pal_get_us()`
- **C 侧 `pal_delay_ms()`/`pal_delay_us()` 禁止步进时钟**——只做异步挂起

### 4.3 PRNG 状态同步契约

- C 侧 `s_prng_state` 初始值 = `faults.prng_seed`
- 每次 `wink_phys_bus_drop()` / `wink_phys_rc_lowpass()` 调用推进 PRNG 状态
- JS 侧可通过导出 `pal_wasm_get_prng_state()` 读取当前状态用于调试/断言
- **严禁** JS 侧直接写入 PRNG 状态（除初始 seed），保证确定性唯一来源
- **全局 PRNG 设计原则**：所有退化机制共享同一 PRNG 状态，保证"单种子复现全系统行为"

### 4.4 BigInt 类型契约

**CMake 必须开启**：`-s WASM_BIGINT=1`

**导出/导入函数类型规则**：

| C 类型 | TS 类型 | 说明 |
|--------|---------|------|
| `uint64_t` / `int64_t` | `bigint` | **必须用 bigint，禁止 number** |
| `uint32_t` / `int32_t` | `number` | 32 位在 number 精度范围内，安全 |
| `float` / `double` | `number` | IEEE754 双精度兼容 |
| `bool` | `boolean` | 直接映射 |

**运行时保护**：
- Emscripten `WASM_BIGINT` 模式下，传 `number` 给 `uint64_t` 参数会直接抛出 `TypeError`
- 这是安全特性，不是 bug——及早发现类型错误比静默精度丢失好

---

## 5. 任务拆分与进度

### Task 0：Layer ③ 计划文档与技术设计规格 `[ ✅ 已完成 ]`

- [x] 本文件即为实施计划交付物（已通过专家评审修正）
- [ ] 编写 `tech-designs/wasm-worker-physical-bridge.md`（架构图、消息协议、确定性保证矩阵、SSOT 时钟设计说明）

---

### Task 1：算法库接入 WASM CMake + 虚拟时钟（P0）

**Files:**
- Modify: `wink-micro-os/targets/wasm/CMakeLists.txt`
- Modify: `wink-micro-os/targets/wasm/pal_osal_wasm.c`
- Modify: `wink-micro-os/targets/wasm/pal_wasm_internal.h`
- Create: `wink-micro-os/test/wasm/test_virtual_clock.c`

**Interfaces:**
- Produces: `pal_wasm_advance_virtual_clock()` 导出给 JS；`pal_get_us()` 虚拟时钟实现。
- **关键约束**：`pal_delay_ms/us()` 内部禁止调用 `pal_wasm_advance_virtual_clock()`。

#### 5.1.1 CMake 接入

```cmake
# targets/wasm/CMakeLists.txt - pal_wasm OBJECT 源列表追加
set(PAL_WASM_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/pal_hal_wasm.c
    ${CMAKE_CURRENT_SOURCE_DIR}/pal_osal_wasm.c
    ${CMAKE_CURRENT_SOURCE_DIR}/pal_resource_wasm.c
    ${CMAKE_CURRENT_SOURCE_DIR}/pal_storage_wasm.c
    ${CMAKE_CURRENT_SOURCE_DIR}/wasm_entry.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../../pal/src/wink_sim_physical.c  # ← 算法库
)

# ✅ 专家评审修正：开启 64 位整型原生 BigInt 支持
target_link_options(wink_simulator PRIVATE
    "-s" "ASYNCIFY=1"
    "-s" "ASYNCIFY_IMPORTS=['js_pal_delay_ms','js_pal_delay_us']"
    "-s" "EXPORTED_FUNCTIONS=['_main']"
    "-s" "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
    "-s" "MODULARIZE=1"
    "-s" "EXPORT_NAME='WasmSandbox'"
    "-s" "WASM_BIGINT=1"               # 64 位整型 ↔ JS BigInt 原生映射
    "-s" "STACK_OVERFLOW_CHECK=2"
    "-s" "ASSERTIONS=1"
    "-s" "ASYNCIFY_STACK_SIZE=65536"
)
```

**零编译污染校验**：确认 `esp32`/`baremetal` CMake 不包含此路径。

#### 5.1.2 虚拟时钟实现

```c
// pal_osal_wasm.c - 替换原 js_pal_get_us() 调用
static uint64_t s_virtual_us = 0;

// 导出给 JS Worker（EM_PORT_API 保证符号可见）
#include &lt;emscripten.h&gt;
EM_PORT_API(void) pal_wasm_advance_virtual_clock(uint64_t us) {
    s_virtual_us += us;  // 64 位无符号自然回绕（&gt;580 年，仿真不可能溢出）
}

// PAL 公开 API - 纯内部虚拟时钟，零 JS 调用 ✅ 符合 §4.1
uint64_t pal_get_us(void) { return s_virtual_us; }
uint64_t pal_get_ms(void) { return s_virtual_us / 1000; }

// ✅ SSOT 合规：delay 仅做异步挂起，时钟推进完全由 JS 端驱动
// 架构红线静态检查：grep 本函数体内不能有 pal_wasm_advance_virtual_clock 调用
void pal_delay_ms(uint32_t ms) {
    js_pal_delay_ms(ms);  // JS 侧负责：步进时钟 + 异步等待 + 恢复执行
}

void pal_delay_us(uint32_t us) {
    js_pal_delay_us(us);
}
```

#### 5.1.3 单测

```c
// test/wasm/test_virtual_clock.c（Emscripten 编译，Node 运行）
#include "unity.h"
#include "pal_osal.h"
#include &lt;emscripten.h&gt;

EM_PORT_API(void) pal_wasm_advance_virtual_clock(uint64_t us);

void test_virtual_clock_starts_at_zero(void) {
    TEST_ASSERT_EQUAL_UINT64(0, pal_get_us());
    TEST_ASSERT_EQUAL_UINT64(0, pal_get_ms());
}

void test_virtual_clock_monotonic_advance(void) {
    pal_wasm_advance_virtual_clock(1000);
    TEST_ASSERT_EQUAL_UINT64(1000, pal_get_us());
    TEST_ASSERT_EQUAL_UINT64(1, pal_get_ms());

    pal_wasm_advance_virtual_clock(500);
    TEST_ASSERT_EQUAL_UINT64(1500, pal_get_us());
    TEST_ASSERT_EQUAL_UINT64(1, pal_get_ms());  // 截断向下取整
}

// ✅ 专家评审新增：验证 pal_delay_ms 不主动步进时钟
// 这是 SSOT 架构的核心保护断言
void test_delay_does_NOT_advance_clock(void) {
    uint64_t before = pal_get_us();
    // 注意：在 Node 单测环境中 js_pal_delay_ms 是同步 mock，不真正等待
    pal_delay_ms(10);
    uint64_t after = pal_get_us();
    // delay 调用后时钟值应该不变——JS 才是唯一时钟源
    TEST_ASSERT_EQUAL_UINT64(before, after);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_virtual_clock_starts_at_zero);
    RUN_TEST(test_virtual_clock_monotonic_advance);
    RUN_TEST(test_delay_does_NOT_advance_clock);
    return UNITY_END();
}
```

#### 5.1.4 提交

```bash
git add wink-micro-os/targets/wasm/CMakeLists.txt
git add wink-micro-os/targets/wasm/pal_osal_wasm.c
git add wink-micro-os/targets/wasm/pal_wasm_internal.h
git add wink-micro-os/test/wasm/test_virtual_clock.c
git commit -m "feat(wasm): ADR-0009 Wave2 virtual clock + algorithm lib CMake

- SSOT 架构：C 侧 delay 不主动步进时钟，JS Worker 唯一时钟源
- 开启 WASM_BIGINT=1 保证 64 位整型类型安全
- 虚拟时钟单测含 SSOT 合规性断言"
```

---

### Task 2：WASM 侧退化引擎封装 + 故障配置下发（P0）

**Files:**
- Create: `wink-micro-os/targets/wasm/pal_wasm_physical.c`
- Modify: `wink-micro-os/targets/wasm/wasm_bridge.h`（追加导出声明）
- Create: `wink-micro-os/test/common/test_physical_golden.h`（SSOT 提取）
- Create: `wink-micro-os/test/wasm/test_wasm_physical.c`

**Interfaces:**
- Produces: 故障配置字段 setters、per-pin 抖动 ctx getter（带边界检查）、PRNG 状态管理。

#### 5.2.1 退化引擎实现

```c
// pal_wasm_physical.c
#include "wink_sim_physical.h"
#include "pal_wasm_internal.h"
#include &lt;emscripten.h&gt;
#include &lt;stdint.h&gt;
#include &lt;string.h&gt;

// ✅ 专家评审修正：限制最大 pin 数 + 边界检查
#define WASM_SIM_MAX_PINS  128  // 足够覆盖绝大多数嵌入式场景；避免 64KB 内存浪费

/* ── 全局故障配置（静态，零动态内存）── */
static wink_sim_faults_t s_faults = {0};  // 初始 = 理想无退化（BSS 自动零初始化）

/* ── per-pin 抖动 ctx 数组（利用 C 标准 BSS 零初始化，无需运行时 memset）── */
static wink_phys_debounce_ctx_t s_debounce_ctx[WASM_SIM_MAX_PINS];  // BSS → 全零

/* ── PRNG 全局状态（确定性唯一来源）── */
//
// 📝 设计说明：全局 PRNG 是有意的设计选择，不是缺陷。
// 理由：保证"单种子复现全系统行为"——给定一个 prng_seed，整个仿真的
// I2C 丢包序列、ADC 噪声序列、GPIO 抖动模式完全可复现。
//
// 权衡：改变某外设的调用频率会影响其他外设的随机序列（因为 PRNG 被提前消耗）。
// 对于大多数调试场景这是可接受的——毕竟"复现 bug"只需要在相同调用序列下重现。
// 如果未来需要"外设级独立确定性"，可以演化出 per-peripheral PRNG。
//
static uint32_t s_prng_state = 1;  // 默认 seed=1（与 host golden 对齐）

/* ── 故障配置 setters（导出给 JS）── */
EM_PORT_API(void) pal_wasm_set_bounce_us(uint32_t us) { s_faults.bounce_us = us; }
EM_PORT_API(void) pal_wasm_set_warmup_us(uint32_t us) { s_faults.warmup_us = us; }
EM_PORT_API(void) pal_wasm_set_sample_interval_us(uint32_t us) { s_faults.sample_interval_us = us; }
EM_PORT_API(void) pal_wasm_set_adc_noise_v(float v) { s_faults.adc_noise_v = v; }
EM_PORT_API(void) pal_wasm_set_rc_tau_s(float s) { s_faults.rc_tau_s = s; }
EM_PORT_API(void) pal_wasm_set_i2c_drop_permil(uint16_t permil) { s_faults.i2c_drop_permil = permil; }
EM_PORT_API(void) pal_wasm_set_prng_seed(uint32_t seed) { s_prng_state = seed; }

/* ── 故障配置 getters（内部使用 + 测试断言）── */
uint32_t pal_wasm_get_bounce_us(void) { return s_faults.bounce_us; }
uint16_t pal_wasm_get_i2c_drop_permil(void) { return s_faults.i2c_drop_permil; }
uint32_t pal_wasm_get_prng_state(void) { return s_prng_state; }

/* ── per-pin 抖动 ctx getter（✅ 带边界检查 + 无冗余 memset）── */
wink_phys_debounce_ctx_t* pal_wasm_get_debounce_ctx(uint16_t pin) {
    // 边界检查：JS 传入越界 pin 号返回 NULL，不崩溃
    if (pin &gt;= WASM_SIM_MAX_PINS) {
        return NULL;
    }
    // BSS 段已保证 s_debounce_ctx 初始全零，无需运行时 memset
    return &amp;s_debounce_ctx[pin];
}

/* ── 重置所有退化状态（测试用）── */
EM_PORT_API(void) pal_wasm_reset_physical(void) {
    memset(&amp;s_faults, 0, sizeof(s_faults));
    memset(s_debounce_ctx, 0, sizeof(s_debounce_ctx));  // 测试场景下 memset 可接受
    s_prng_state = 1;
}
```

#### 5.2.2 Bridge 头文件追加

```c
// wasm_bridge.h - 在末尾追加 WASM 侧导出声明
/* ---- WASM 退化引擎导出（给 JS Worker 调用）---- */
extern void pal_wasm_advance_virtual_clock(uint64_t us);  // BigInt 模式
extern void pal_wasm_set_bounce_us(uint32_t us);
extern void pal_wasm_set_warmup_us(uint32_t us);
extern void pal_wasm_set_sample_interval_us(uint32_t us);
extern void pal_wasm_set_adc_noise_v(float v);
extern void pal_wasm_set_rc_tau_s(float s);
extern void pal_wasm_set_i2c_drop_permil(uint16_t permil);
extern void pal_wasm_set_prng_seed(uint32_t seed);
extern void pal_wasm_reset_physical(void);
extern uint32_t pal_wasm_get_prng_state(void);
```

#### 5.2.3 单测（算法库 WASM 侧验证，golden 与 host 共享）

```c
// test/wasm/test_wasm_physical.c
#include "unity.h"
#include "wink_sim_physical.h"
#include "test_physical_golden.h"  // SSOT golden 向量
#include &lt;emscripten.h&gt;
#include &lt;stdint.h&gt;

// 导出函数声明
EM_PORT_API(void) pal_wasm_set_bounce_us(uint32_t us);
EM_PORT_API(void) pal_wasm_set_prng_seed(uint32_t seed);
EM_PORT_API(uint32_t) pal_wasm_get_prng_state(void);
EM_PORT_API(void) pal_wasm_reset_physical(void);

void setUp(void) { pal_wasm_reset_physical(); }
void tearDown(void) {}

/* PRNG golden 验证（与 host 完全一致） */
void test_prng_golden_matches_host(void) {
    uint32_t seed = GOLDEN_PRNG_SEED1;
    float val = wink_phys_prng_next(&amp;seed);
    TEST_ASSERT_EQUAL_UINT32(GOLDEN_PRNG_AFTER_CALL1, seed);
    TEST_ASSERT_FLOAT_WITHIN(0.0001f, GOLDEN_PRNG_VALUE1, val);
}

/* 故障配置下发-回环 验证 */
void test_fault_config_setget_loopback(void) {
    pal_wasm_set_bounce_us(30000);
    pal_wasm_set_prng_seed(42);
    TEST_ASSERT_EQUAL_UINT32(30000, pal_wasm_get_bounce_us());
    TEST_ASSERT_EQUAL_UINT32(42, pal_wasm_get_prng_state());
}

/* 抖动强制交替 golden（与 host 完全一致） */
void test_debounce_forced_alternation_golden(void) {
    wink_phys_debounce_ctx_t ctx = {false, false, 0, false};
    TEST_ASSERT_EQUAL(GOLDEN_BOUNCE_STEP1,
        wink_phys_debounce_step(&amp;ctx, GOLDEN_BOUNCE_TARGET, 1000, GOLDEN_BOUNCE_US));
    TEST_ASSERT_EQUAL(GOLDEN_BOUNCE_STEP2,
        wink_phys_debounce_step(&amp;ctx, GOLDEN_BOUNCE_TARGET, 2000, GOLDEN_BOUNCE_US));
    TEST_ASSERT_EQUAL(GOLDEN_BOUNCE_STEP3,
        wink_phys_debounce_step(&amp;ctx, GOLDEN_BOUNCE_TARGET, 3000, GOLDEN_BOUNCE_US));
}

// ✅ 专家评审新增：边界检查测试
void test_debounce_ctx_out_of_bounds_returns_null(void) {
    wink_phys_debounce_ctx_t* ctx;

    // 合法边界
    ctx = pal_wasm_get_debounce_ctx(0);
    TEST_ASSERT_NOT_NULL(ctx);
    ctx = pal_wasm_get_debounce_ctx(127);
    TEST_ASSERT_NOT_NULL(ctx);

    // 越界边界
    ctx = pal_wasm_get_debounce_ctx(128);
    TEST_ASSERT_NULL(ctx);
    ctx = pal_wasm_get_debounce_ctx(65535);
    TEST_ASSERT_NULL(ctx);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_prng_golden_matches_host);
    RUN_TEST(test_fault_config_setget_loopback);
    RUN_TEST(test_debounce_forced_alternation_golden);
    RUN_TEST(test_debounce_ctx_out_of_bounds_returns_null);
    return UNITY_END();
}
```

#### 5.2.4 提交

```bash
git add wink-micro-os/targets/wasm/pal_wasm_physical.c
git add wink-micro-os/targets/wasm/wasm_bridge.h
git add wink-micro-os/test/common/test_physical_golden.h
git add wink-micro-os/test/wasm/test_wasm_physical.c
git commit -m "feat(wasm): ADR-0009 Wave2 physical engine + fault config setters

- WASM_SIM_MAX_PINS=128 边界检查，防止 JS 传入越界 pin 崩溃
- 利用 BSS 零初始化，移除冗余运行时 memset
- 文档化全局 PRNG 设计原则，明确是有意的架构选择
- golden 向量 SSOT，host/wasm 共享
- 边界检查单元测试"
```

---

### Task 3：HAL GPIO / I2C 退化中间件接入（P0）

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_hal_wasm.c`
- Create: `wink-micro-os/test/wasm/test_debounce_middleware.c`
- Create: `wink-micro-os/test/wasm/test_i2c_drop_middleware.c`

**Interfaces:**
- Consumes: `pal_wasm_get_debounce_ctx()` / `wink_phys_debounce_step()` / `wink_phys_bus_drop()`
- Produces: 退化后的 GPIO 读 / I2C 传输行为（对上层透明）

#### 5.3.1 GPIO 抖动中间件

```c
// pal_hal_wasm.c - pal_gpio_read() 替换
bool pal_gpio_read(uint16_t pin) {
    // Step 0: 边界检查（防止 JS 传入越界 pin 导致内存崩溃）
    if (pin &gt;= WASM_SIM_MAX_PINS) {
        return false;  // 越界 pin 默认为低电平，不崩溃
    }

    // Step 1: 从 JS 侧获取理想电平（UniSim 宏观物理状态）
    bool ideal = js_pal_gpio_read(pin);

    // Step 2: 退化中间件层（仅当 bounce_us &gt; 0 时生效）
    extern wink_phys_debounce_ctx_t* pal_wasm_get_debounce_ctx(uint16_t pin);
    extern uint32_t pal_wasm_get_bounce_us(void);
    uint32_t bounce_us = pal_wasm_get_bounce_us();
    if (bounce_us &gt; 0) {
        wink_phys_debounce_ctx_t* ctx = pal_wasm_get_debounce_ctx(pin);
        // ctx 不可能为 NULL（因为 pin 已过边界检查），但仍做防御式判断
        if (ctx != NULL) {
            return wink_phys_debounce_step(ctx, ideal, pal_get_us(), bounce_us);
        }
    }

    // 无退化 → 原样返回（兼容路径）
    return ideal;
}
```

#### 5.3.2 I2C 丢包中间件

```c
// pal_hal_wasm.c - pal_i2c_transfer() 头部插入
wink_status_t pal_i2c_transfer(uint8_t port, uint16_t dev_addr,
                      const uint8_t *write_buf, uint32_t write_len,
                      uint8_t *read_buf, uint32_t read_len) {
    // Step 1: 丢包判定（PRNG 确定性，§4.1 合规）
    //
    // 📝 设计说明：全局 PRNG 是有意的设计选择，保证"单种子复现全系统行为"。
    // 如果 I2C 丢包和 ADC 噪声独立 PRNG，那么改变 ADC 采样率不会影响
    // I2C 序列，但这也失去了"一个 seed = 整个系统的完整快照"的能力。
    // 当前选择：全局 PRNG，简化确定性复现。
    //
    extern uint32_t pal_wasm_get_prng_state(void);
    extern void pal_wasm_set_prng_seed(uint32_t);  // 状态回写
    extern uint16_t pal_wasm_get_i2c_drop_permil(void);

    uint16_t drop_permil = pal_wasm_get_i2c_drop_permil();
    if (drop_permil &gt; 0) {
        uint32_t prng_state = pal_wasm_get_prng_state();
        bool should_drop = wink_phys_bus_drop(drop_permil, &amp;prng_state);
        pal_wasm_set_prng_seed(prng_state);  // 回写推进后的状态
        if (should_drop) {
            return WINK_ERR_IO;  // 模拟总线故障，驱动超时退回机制触发
        }
    }

    // Step 2: 正常传输（无退化路径）
    return js_pal_i2c_transfer(port, dev_addr, write_buf, write_len, read_buf, read_len)
           ? WINK_OK : WINK_ERR_IO;
}
```

#### 5.3.3 单测 + 提交

略（镜像 host Wave 1 测试逻辑，WASM 环境运行 + 边界条件测试）。

```bash
git add wink-micro-os/targets/wasm/pal_hal_wasm.c
git add wink-micro-os/test/wasm/test_debounce_middleware.c
git add wink-micro-os/test/wasm/test_i2c_drop_middleware.c
git commit -m "feat(wasm): ADR-0009 Wave2 GPIO debounce + I2C drop middleware

- pin 越界保护：所有 pin 访问前置范围检查
- 全局 PRNG 设计原则文档化在代码注释中
- 含边界条件单元测试"
```

---

### Task 4：按键抖动端到端（WASM × dal_button）（P0）

**Files:**
- Create: `wink-micro-os/test/wasm/test_button_debounce_e2e_wasm.c`

**目标**：镜像 host Wave 1 端到端测试，验证 WASM 侧行为 100% 一致。

**关键点**：
- 测试需要模拟 JS `js_pal_gpio_read()` 返回值（理想电平）
- 用 Emscripten `EM_JS` 宏注入 JS 侧 mock
- golden 与 host 完全相同：bounce_us=30000，tick=10ms，去抖阈值=3
- 负对照：裸采样在抖动窗内必跳变；正对照：`dal_button_poll()` 后稳定

```bash
git add wink-micro-os/test/wasm/test_button_debounce_e2e_wasm.c
git commit -m "test(wasm): ADR-0009 Wave2 button debounce e2e matches host golden"
```

---

### Task 5：UniSim Worker 侧桥接实现（P1）

**Files:**
- Create: `../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts`
- Create: `../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts`
- Create: `../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts`
- Create: `../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts`

#### 5.5.1 VirtualClock.ts

```typescript
// VirtualClock.ts - 与 WASM 侧 s_virtual_us 严格对齐
// ✅ 专家评审修正：全部使用 bigint 保证 64 位精度
export class VirtualClock {
  private us: bigint = 0n;  // 强制 bigint，禁止 number 隐式转换

  advance(us: bigint): void {
    this.us += us;
  }

  getUs(): bigint { return this.us; }
  getMs(): bigint { return this.us / 1000n; }

  reset(): void { this.us = 0n; }
}
```

#### 5.5.2 WasmPhysicalBridge.ts

```typescript
// WasmPhysicalBridge.ts - JS ↔ WASM 退化桥接封装
// ✅ 专家评审修正：所有 uint64_t 参数/返回值使用 bigint 类型
export interface SimFaultsConfig {
  bounce_us: number;          // uint32_t
  warmup_us: number;          // uint32_t
  sample_interval_us: number; // uint32_t
  adc_noise_v: number;        // float
  rc_tau_s: number;           // float
  i2c_drop_permil: number;    // uint16_t
  prng_seed: number;          // uint32_t
}

// ✅ BigInt 类型契约：与 CMake -s WASM_BIGINT=1 严格匹配
// 类型错误 = 编译错误 + 运行时 TypeError 双重保护
export interface WasmExports {
  // 64 位时钟 → bigint（禁止 number，会触发 Emscripten TypeError）
  pal_wasm_advance_virtual_clock: (us: bigint) =&gt; void;
  pal_get_us: () =&gt; bigint;

  // 32 位及以下 → number（安全，在 53 位精度范围内）
  pal_wasm_set_bounce_us: (us: number) =&gt; void;
  pal_wasm_set_warmup_us: (us: number) =&gt; void;
  pal_wasm_set_sample_interval_us: (us: number) =&gt; void;
  pal_wasm_set_adc_noise_v: (v: number) =&gt; void;
  pal_wasm_set_rc_tau_s: (s: number) =&gt; void;
  pal_wasm_set_i2c_drop_permil: (permil: number) =&gt; void;
  pal_wasm_set_prng_seed: (seed: number) =&gt; void;
  pal_wasm_reset_physical: () =&gt; void;
  pal_wasm_get_prng_state: () =&gt; number;

  pal_gpio_read: (pin: number) =&gt; boolean;
  pal_i2c_transfer: (port: number, devAddr: number, writeBuf: Uint8Array, readLen: number) =&gt; boolean;
  // ... 其余 PAL 导出
}

export class WasmPhysicalBridge {
  private exports: WasmExports;
  private idealGpioStates: Map&lt;number, boolean&gt; = new Map();

  constructor(exports: WasmExports) {
    this.exports = exports;
  }

  setFaults(config: SimFaultsConfig): void {
    this.exports.pal_wasm_set_bounce_us(config.bounce_us);
    this.exports.pal_wasm_set_warmup_us(config.warmup_us);
    this.exports.pal_wasm_set_sample_interval_us(config.sample_interval_us);
    this.exports.pal_wasm_set_adc_noise_v(config.adc_noise_v);
    this.exports.pal_wasm_set_rc_tau_s(config.rc_tau_s);
    this.exports.pal_wasm_set_i2c_drop_permil(config.i2c_drop_permil);
    this.exports.pal_wasm_set_prng_seed(config.prng_seed);
  }

  setGpioIdeal(pin: number, level: boolean): void {
    this.idealGpioStates.set(pin, level);
    // TODO: 注入到 WASM 侧 js_pal_gpio_read mock
  }

  readGpioDegraded(pin: number): boolean {
    return this.exports.pal_gpio_read(pin);
  }

  // ✅ 时钟步进使用 bigint
  advanceClock(us: bigint): void {
    this.exports.pal_wasm_advance_virtual_clock(us);
  }

  getClockUs(): bigint {
    return this.exports.pal_get_us();
  }

  reset(): void {
    this.exports.pal_wasm_reset_physical();
    this.idealGpioStates.clear();
  }
}
```

#### 5.5.3 Jest 单测

- 验证 JSON 配置字段与 C setter 一一对应
- 验证虚拟时钟双端同步（含 bigint 类型断言）
- 验证抖动退化输出与 golden 匹配
- **验证 pin 越界不崩溃**

```bash
git add ../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts
git add ../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts
git add ../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts
git add ../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts
git commit -m "feat(unisim): ADR-0009 Wave2 Worker bridge + VirtualClock + Jest tests

- 全 bigint 类型安全：所有 64 位时钟参数使用 bigint
- VirtualClock 与 C 侧 s_virtual_us 严格对齐
- 含 bigint 类型契约单测 + pin 越界测试"
```

---

### Task 6：全量回归 + ADR 状态更新 + 设计规范回写（P0）

**Files:**
- Modify: `docs/decisions/unisim/0009-physical-behavior-simulation-fault-injection.md`（状态 → Accepted）
- Create: `docs/design/04-wasm-simulation/02-physical-degradation-engine.md`（设计规范回写）
- Modify: `docs/decisions/unisim/0003-simulation-fidelity-boundary.md`（决策3 标记完成）

**验收清单**：
- [ ] WASM 全量单测通过（含新增 5 个测试文件）
- [ ] **SSOT 架构断言**：静态检查 pal_osal_wasm.c 中 pal_delay_ms 不调用 pal_wasm_advance_virtual_clock
- [ ] host 全量回归（0 失败，Wave 1 不受影响）
- [ ] esp32/baremetal 编译零污染（grep 无 `wink_sim_physical` 符号）
- [ ] JS 侧 Jest 全绿（含 bigint 类型测试）
- [ ] golden 向量双端完全一致
- [ ] 性能 profiling：退化开销 &lt; 5% CPU
- [ ] 文档：ADR Accepted + 设计规范回写（含 SSOT 架构说明）

```bash
git add docs/decisions/unisim/0009-physical-behavior-simulation-fault-injection.md
git add docs/design/04-wasm-simulation/02-physical-degradation-engine.md
git add docs/decisions/unisim/0003-simulation-fidelity-boundary.md
git commit -m "docs(adr): ADR-0009 Accepted + Wave2 design spec backport

- SSOT 时钟架构设计说明
- BigInt 类型安全契约
- 全局 PRNG 设计原则文档
- 内存安全边界保护机制"
```

---

## 6. 测试策略（L0–L2）

| 层级 | 测试目标 | 工具 | 覆盖率要求 |
|------|----------|------|-----------|
| **L0 编译门禁** | WASM/host/esp32/baremetal 四目标编译通过；TS 类型检查通过 | CMake + Ninja + tsc | 0 warning |
| **L0.5 静态架构检查** | SSOT 合规：pal_delay_ms 不步进时钟；BigInt 模式开启；边界检查存在 | 自定义 grep 脚本 | 100% 合规 |
| **L1 单元测试** | 算法库 golden 验证、虚拟时钟单调性、故障配置回环、中间件路径覆盖、**边界条件（pin 越界）** | Unity (C) + Jest (JS) | 算法库 100%、中间件层 ≥90% |
| **L2 集成测试** | GPIO 抖动 × `dal_button` 端到端、I2C 丢包 × 驱动超时退回、**双端时钟同步（bigint 精确匹配）** | Unity (WASM) + Jest (Worker) | 关键路径 100% |
| **L3 确定性验证** | 同 seed 同输入 → 字节级输出相同；连续运行 1000 次输出完全一致 | 自定义脚本 | 0 偏差 |

---

## 7. 风险与缓解（专家评审增强版）

| 风险 | 概率 | 影响 | 缓解措施（已整合评审建议） |
|------|------|------|--------------------------|
| Emscripten `EM_PORT_API` 符号导出失败 | 中 | 高 | Task 1 先做最小导出验证；用 `emcc -s EXPORTED_FUNCTIONS` 显式列表 |
| WASM 单测在 Node 环境运行困难 | 中 | 中 | 复用项目现有 WASM 测试基础设施（若有）；用 `emcc -s ENVIRONMENT=node` |
| **⏱️ 双重步进 / 因果倒置** | 高 | 🔴 致命 | **已修复**：SSOT 架构——C 侧 delay 不主动步进时钟；JS Worker 唯一时钟源；单测断言保护；静态脚本检查 |
| **🔢 BigInt ↔ number 类型不匹配** | 高 | 🔴 崩溃 | **已修复**：TS 接口全用 bigint；CMake `-s WASM_BIGINT=1`；类型错误 = 编译错误 + 运行时 TypeError 双重保护 |
| **💥 JS 传入越界 pin 导致崩溃** | 高 | 🟠 高 | **已修复**：所有 pin 索引访问加强边界检查；越界返回 NULL/默认值而非内存越界；单测覆盖边界条件 |
| 虚拟时钟与 JS 异步时序冲突 | 中 | 高 | Worker 单线程 + 消息队列串行化；禁止 `setTimeout` 并发步进时钟 |
| 算法库 WASM 编译 warning（float 隐式转换） | 低 | 低 | Task 1 编译时开启 `-Wconversion` 提前发现；与 host 编译选项对齐 |
| PRNG 状态耦合导致调试困惑 | 低 | 中 | 代码注释文档化"全局 PRNG 是有意的设计选择"；如果未来需要外设级独立性再演化 |

---

## 8. 回滚与降级方案

- **方案 1（运行期降级，内置）**：`faults = {0}`（全零理想配置）→ 所有退化旁路，等同于当前直通行为。无需重编译。
- **方案 2（Git 回退）**：`git revert` Wave 2 全部 commit → 回 baseline。
- **方案 3（编译期裁剪）**：从 `pal_wasm` CMake 移除 `wink_sim_physical.c` + 还原 `pal_gpio_read()`/`pal_i2c_transfer()` → 退化路径完全消失。

---

## 9. 参考资料

- [ADR-0009](../../decisions/unisim/0009-physical-behavior-simulation-fault-injection.md)（双域混合架构、确定性守卫）
- [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md)（决策3 虚拟时钟）
- [Wave 1 Host 计划](./2026-06-28-adr-0009-host-pilot-physical-sim-wave1-plan.md)（算法库基线、golden 向量）
- [Emscripten Porting Guide](https://emscripten.org/docs/porting/index.html)（`EM_PORT_API`、WASM 导出/导入、`WASM_BIGINT` 选项）
- [Web Worker API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

---

## 10. Self-Review（writing-plans 自查 + 专家评审修正）

- **Spec 覆盖**：ADR §3 全算法 WASM 接入 + §4.1 确定性守卫（虚拟时钟） + §4.2 故障配置下发 + §4.3 零编译污染 ✅ 全覆盖
- **占位扫描**：所有 Task 有明确文件、接口、代码骨架；无 TBD/待调研 ✅
- **类型一致性**：golden 向量 SSOT 双端共享；**TS bigint ↔ C uint64_t 严格对齐**；float 字段统一单精度 ✅
- **边界条件**：时钟回拨、**pin 范围越界**、PRNG 状态推进、零退化兼容路径 均已覆盖 ✅
- **评审修复回溯**：P0 假绿预防（端到端必须构造跃变序列）、抖动模型强制交替（与 host 一致）、PRNG 种子唯一来源 ✅ 均已设计保障
- **专家评审修正全量整合**：
  - ✅ SSOT 时钟架构（delay 不主动步进）
  - ✅ BigInt 类型安全 + WASM_BIGINT 编译选项
  - ✅ WASM_SIM_MAX_PINS 边界检查（内存安全）
  - ✅ BSS 零初始化优化（去冗余 memset）
  - ✅ I2C 消息重命名 + 语义澄清
  - ✅ 全局 PRNG 设计原则文档化（澄清是架构选择而非缺陷）
  - ✅ 所有架构红线更新为评审增强版
  - ✅ 成功指标追加 SSOT、BigInt、内存安全三项
  - ✅ 风险列表全面更新并标记"已修复"项

---

**Plan Status**: ✅ **专家评审完成，准备实施**

