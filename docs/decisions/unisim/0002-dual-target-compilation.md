# ADR-0002：wasm + xtensa 双 target 同源编译可行性 Spike

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-06-22（Proposed）／ 2026-06-28（Accepted） |
| 触发 | 架构评审 P0 项（见 [2026-06-22 评审报告](../../reviews/core/2026-06-22-architecture-review.md) §五） |
| 影响范围 | 平台技术命门——虚实同源成立的前提 |
| 决策者 | 内核负责人 + 仿真负责人（结论由后续 ADR 实战验证确立） |

---

## 背景（Context）

平台北极星是"仿真→烧录行为一致"，其技术根基是**同一份 BAL/DAL/PAL C 源码既能被 emscripten 编译为 `wasm32` 跑浏览器仿真、又能被 ESP-IDF（xtensa 工具链）编译链接到 ESP32 真机**。

但这个根基**至今未被工程验证**。具体未论证的风险点：

1. **双工具链兼容**：同一份 C 代码能否同时被 `emcc`（wasm32）和 `xtensa-esp32-elf-gcc`（ESP-IDF）干净编译？尤其是：
   - 编译器扩展差异（GCC vs clang/emcc 的内置/属性支持）
   - 标准库差异（newlib vs emscripten libc）
   - 浮点模型差异（ESP32 Xtensa 单精度 FPU vs wasm IEEE-754；影响轻微，详见决策章节「静态核查」降级处理）
2. **Asyncify 语义对齐**：`pal_delay_ms` 在 wasm 端用 Emscripten Asyncify 挂起协程，在真机端用 `vTaskDelay` 阻塞——同一 API 在两端是"挂起让出"还是"阻塞占 CPU"，行为语义是否真的等价？
3. **OSAL 抽象完备性**：`pal_delay_ms/pal_get_us/pal_mutex_*` 在 wasm 端（单线程 + Asyncify）与真机端（FreeRTOS 多任务）的实现差异是否被 OSAL 接口正确吸收？
4. **中断/回调映射**：wasm 端用 Wasm Table 索引回环模拟中断，真机端是真实 ISR——`pal_gpio_isr_t` 回调签名在两端是否一致、调用上下文约束（可重入性）是否对齐？
5. **`#ifdef SIMULATION` 切换的正确性**：双模分支编译后，两份产物的 DAL 接口契约是否真的"同源同构"？
6. **FreeRTOS 多任务在 Wasm 单栈下的表达**：真机端跑在 ESP32 双核 FreeRTOS（抢占式多任务、队列、信号量），而 Wasm 仿真端是单线程单栈 + Asyncify 协作式挂起——多任务抢占与任务间通信在仿真侧如何表达尚无方案。评审 §三、[ADR-0003](./0003-simulation-fidelity-boundary.md) 决策3 均标记此为"blink demo → 真业务"的核心鸿沟。

**这是整个平台的技术命门。若不成立，"虚实同源"破产，MVP 北极星（仿真→烧录一致）直接失效。**

---

## 决策（Decision）

**在 Phase 0 启动前，立一个有明确验收标准、有时间盒（time-boxed）的技术 Spike。** Spike 不产出产品代码，只产出"可行性结论 + 风险清单 + 必要的架构调整建议"。

### Spike 范围与验收标准

根据架构评审与精简范围建议，Spike 验证项分为**硬门槛（运行期验证）**与**静态核查（编译期/规范层面）**两类，以优化时间盒分配并规避无效/过度验证。

#### 1. 硬门槛验证项（Spike 编码验证）

| # | 验证项 | 验收标准（必须可复现） | 备注/设计考量 |
|---|---|---|---|
| 1 | 双工具链零警告编译 | 一份最小 BAL/DAL/PAL 样例（含 HC-SR04 + Servo）同时用 `emcc -Wall -Wextra -Werror` 与 `idf.py build`（`-Wall -Wextra -Werror`）编译通过，零警告 | 验证 Clang (Emscripten) 与 GCC (Xtensa) 前端警告集兼容性 |
| 2 | Asyncify 挂起与真机阻塞因果等价量化 | `pal_delay_ms(100)` 在 wasm 端让出事件循环（不卡死 Worker 线程与 UI 60fps），在真机端通过 `vTaskDelay` 阻塞当前任务 100ms（其他任务正常调度）；记录并量化两端在不同负载下的因果时序偏差 | 不度量绝对时间等价，仅度量因果等价 |
| 3 | OSAL API 契约一致性与真机并发正确性 | `pal_delay_ms/pal_get_us/pal_mutex_*` 各出一版 Wasm 实现与 ESP32 实现。在 Wasm 侧验证 API 签名契约一致；在真机侧利用多任务并发测试用例验证 FreeRTOS 原语正确性 | Wasm 侧单线程无真并发，不强求"并发行为等价"（Wasm 侧 mutex 实际退化为无竞争锁） |
| 4 | `#ifdef SIMULATION` 切换正确性 | 测定重构后的新 bypass 形态（**基于 ADR-0003 决策2：只替换物理信号来源，保留解析与 CRC 逻辑**）。验证两种编译条件下，对外契约一致，实现干净分流 | **前置依赖**：必须先通过 ADR-0003 决策2，避免针对即将废弃的旧 Bypass 形态做无用功 |
| 5 | 双模 CMake 工程隔离与预编译缓存 | 验证一套工程通过配置可无缝切换编译目标，且 Web 仿真专有的 Emscripten API / 导入符号在真机构建时被完全宏隔离，不产生未定义引用，且引入预编译 `.a` 缓存机制 | 产出物将直接作为 Phase 0 基础设施交付物，具有极高重用价值 |
| 6 | 多任务可行性边界探测 | 在 Wasm 单线程单栈限制下，不实现完整调度器，仅测试 2-3 个 Asyncify 挂起点交错执行，探测是否会发生死锁或饥饿 | 评估是否需要将 MVP 的 BAL 范围收缩至单任务（裸 `while(1)`） |

#### 2. 降级为静态核查与编码规范（不占用 Spike 编码工时）

- **浮点编译选项与容差核查（原项 6 降级）**：通过静态检查 ESP-IDF 与 Emscripten 的默认编译 flag（如是否开启 `-ffast-math`、Xtensa FPU FTZ/DAZ 状态），将浮点偏差控制并入 Golden Trace 容差设计（不进行运行期高精量化）。**执行细节 SSOT（2026-08-02）**：[ADR-0055](./0055-sim-fp-determinism-and-golden-policy.md)（同 binary bit-exact；host↔wasm 默认 tolerance；禁 fast-math 契约）。
- **跨平台 POD 结构体打包规范（原项 7 降级）**：鉴于 Wasm 侧与 Xtensa 侧内存空间完全隔离，两端从不跨边界共享原始 DAL 结构体（仅存在 Web 侧按字节读取 buffer），故无需验证 struct 布局绝对一致。降级为静态编码规范：**禁止在跨平台结构体中使用 `#pragma pack` 或位域**，保证各自编译安全。
- **中断签名一致性与 Table 鲁棒性（原项 4 降级）**：中断回调签名一致性由 `pal_gpio_isr_t` 编译期强制保证；Wasm 侧的 Table 回环鲁棒性（多回调注册/注销/NULL 指针）留待后续 runtime 实现阶段处理，不放入 Spike 门槛。

### 时间盒与产出

- **时间盒**：3–5 人日（得益于结构体与浮点的降级与范围收窄，此工时预算趋于合理，但仍偏紧）。
- **产出**：
  1. **Phase 0 基础设施交付物**：可运行的双 target 最小 CMake 工程骨架（支持两端一键编译、宏隔离、`.a` 缓存）。
  2. 可行性评估报告：✅ 完全可行 / ⚠️ 可行但需架构调整 / ❌ 不可行。
  3. 风险清单与缓解措施（按 P0/P1 分级，含缓解措施）。
  4. 架构调整决策（如有，涉及架构调整则开新 ADR 记录）。

### 风险预判（Spike 可能暴露的问题）

- **ADR 依赖倒置风险**：若 ADR-0003 决策2 未提前拍板，则项 4 切换正确性验证将失去靶子。
- **Asyncify 栈税**：64KB `ASYNCIFY_STACK_SIZE` 面对深度嵌套可能不足，需进行 benchmark 评估（评审 §04 已标记）。
- **FreeRTOS 多任务 Wasm 表达受限**：若多任务探测（项 6）失败，可能被迫收敛 MVP 到单任务模式，显著削弱平台能力。

---

## 后果（Consequences）

- **若 ✅ 可行**：Phase 0/1 按既定 MVP 路线推进，本 ADR 转 Accepted。
- **若 ⚠️ 需调整**：可能影响 OSAL 接口设计、Asyncify 使用方式、或收敛 MVP 到单任务模式——这些会回写 `02-wink-micro-os` 与 `04-wasm-simulation` 文档。
- **若 ❌ 不可行**：需重新评估"虚实同源"核心承诺，可能退化为"仿真专用 BAL 子集 + 真机 BAL"，这是重大架构变更，需开新 ADR 并重排 MVP。

## 遵循与后续（Compliance）

- Spike 结论出来前，`02-wink-micro-os` 与 `04-wasm-simulation` 文档中的"100% 同源同构"措辞应降级为"目标同源，可行性待 Spike 验证"。
- Spike 完成后，结论回写本 ADR 并更新评审报告整改跟踪表。
- **2026-06-28 收口**：Spike 已由后续 ADR 实战验证通过（详见底部状态变更日志），上述"Spike 前降级措辞"要求解除——`02/03/04` 规范中的"100% 同源"措辞现为经实战验证的事实，无需降级。

---

*本 ADR 状态变更请在此记录：*
- 2026-06-22：Proposed（评审触发）
- 2026-06-23：按精简范围建议重构验收项——9 项压缩为「6 硬门槛 + 3 静态核查」；补充背景多任务风险点、修正浮点措辞。
- 2026-06-28：Accepted。Spike 立项的 6 项硬门槛 + 3 项静态核查已在后续实战中逐项验证，结论 **✅ 完全可行**：
  - ① 双工具链零警告编译 → [ADR-0006](../core/0006-esp-idf-v6-i2c-compatibility.md)（ESP-IDF v6.0.1 xtensa）+ host GCC16/MSVC 双链 0 warning；
  - ② Asyncify 挂起 vs 真机阻塞因果等价 → [ADR-0007](../core/0007-cooperative-loop-execution-model.md) 协作式执行模型（同源 `switch-case`，Wasm Asyncify 挂起 / 真机 `vTaskDelay` 阻塞因果对齐，含 ESP32 真机闭环验证）；
  - ③ OSAL API 契约一致性 → host/wasm/baremetal/esp32 四 target PAL 同源（[ADR-0010](../core/0010-boot-safe-lock-recovery-threshold.md) 四态 boot-count、[ADR-0008](../core/0008-dynamic-device-tree-config-flash.md) 三 target storage）；
  - ④ `#ifdef SIMULATION` 切换正确性 → [ADR-0003](./0003-simulation-fidelity-boundary.md) 决策 2 已收窄 bypass 至物理量来源层（`dal/src/dal_ultrasonic.c` 实证）；
  - ⑤ 双模 CMake 工程隔离 + 宏隔离 → 现行 `wink-micro-os/CMakeLists.txt` + 各 target CMake 已落地；
  - ⑥ 多任务可行性边界 → ADR-0007 收敛为单任务 + 协作式挂起模型，采纳了原风险预判的"MVP 收缩至单任务"路径，规避 Wasm 多任务抢占鸿沟。

  双 target 同源已是项目日常基础；`02/03/04` 规范的"100% 同源"措辞据此成立。决策者由"待定"更新为内核 + 仿真负责人。
- 2026-08-02：浮点/Golden 执行细节收口至 [ADR-0055](./0055-sim-fp-determinism-and-golden-policy.md)（Accepted）；本 ADR 静态核查项仍有效，细节不再双写。

