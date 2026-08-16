# 内存配额、OOM、Fault 锁存与消毒器

| 项 | 内容 |
|---|---|
| 文档层级 | ① 设计规范（UniSim 3.0 / mechanisms） |
| 文档状态 | **Active**（2026-08-02 切换；Wasm 仿真现行 SSOT） |
| **落地** | **Partial**：Fault 锁存 / safe-off / host_fault **Landed**；固定堆配额（ADR-0045 三链接标志）**Planned**（CMake 未落地）；故障域/功耗 **Stub** |
| 支撑轴 | **F（primary）** |
| 关联代码 | `wink-micro-os/targets/wasm/pal_wasm_fault.c`、`wink-micro-os/targets/wasm/pal_wasm_fault_domain.c`、`wink-micro-os/targets/wasm/pal_wasm_internal.h`、`wink-micro-os/targets/wasm/wasm_bridge.h` |
| 上次核对 | 2026-08-02 |
| 管辖 ADR | 0024（safe-off）、0045、0012（契约诚实）、0042 |
| 迁自 | `04-wasm-simulation-2.0/06-memory-and-faults.md` |

> 本文件回答：仿真堆有多大、OOM 如何处理、Fault 如何锁存并 safe-off、宿主异常如何兜底、ASan/UBSan 在哪一层跑。对应轴 F 与 C6、C15、C25。

---

## 1. 内存配额与 OOM（ADR-0045）

### 1.1 设计原则

- 配额在 **target 层**强制，**绝不在平台无关的 `pal/`** 里实现（不新增 `pal_malloc`，避免污染真机构建，也才能拦截第三方分配）。
- 仿真配额（默认 **256 KiB**）是**仿真断言基线（Simulation Assertion Baseline）**，用来暴露泄漏与缺失的 NULL 检查，**不是**对 ESP32 真实 DRAM 的 1:1 镜像。

### 1.2 Wasm 方案与落地状态

ADR-0045 规定用 Emscripten 链接标志在物理内存层封顶，零代码拦截所有原生 `malloc/calloc/realloc`：

```text
-sINITIAL_MEMORY=${WINK_SIM_MEMORY_BYTES}
-sMAXIMUM_MEMORY=${WINK_SIM_MEMORY_BYTES}
-sALLOW_MEMORY_GROWTH=0
```

> **落地状态（2026-08-02 核对）**：上述三个标志在当前 `wink-micro-os/CMakeLists.txt` 与 `wink-micro-os/targets/wasm/wink_binary_import.cmake` 中**未检出**——当前仅设置了 `WASM_BIGINT`/`ASYNCIFY_*`/`STACK_OVERFLOW_CHECK` 等。即固定堆封顶**尚未在构建中落地**，属 ADR-0045 待实施项。落地前 wasm 堆可增长，配额门禁不生效。文档不臆造已实现状态。

OOM 路径（设计）：分配失败不静默返回 NULL、不裸崩，而是调用 `pal_wasm_invoke_fault(WINK_ERR_NO_MEM)`（错误码 **-13**），写 Fault Ring Buffer（记录分配大小/位点），并触发 `app_on_fault()` 做故障安全隔离。

### 1.3 Host 与真机

- Host 原生仿真：可选链接包装器 `-Wl,--wrap=malloc` 做计量/拦截（仅 host-sim 启用）。
- 真机（ESP32/baremetal）：保持原样，用 FreeRTOS heap / `heap_caps` 语义，不加 `s_sim_heap` 数组或分配器。
- **App/BAL 禁止直接 `malloc/free`**：**Planned**（设计意图）。
  - 文档旧路径 `wink-micro-os/tools/lint/rules/memory.yaml` **不存在**；
  - 现行 lint 根在 `wink-tools/tools/lint/rules/`（ADR-0043），当前仅有 `layering.yaml` / `api.yaml` / `user_surface.yaml`，**尚无** `memory.yaml`；
  - 落地前不得宣称「NO-MALLOC lint 已门禁」。威胁模型澄清：固定堆封顶（ADR-0045，亦 **Planned**）拦的是 **wasm 运行期原生分配**（含第三方/Emscripten）；App/BAL 静态对象池是分层纪律，二者互补。

### 1.4 BSS 零初值 ≠ 语义默认（通用规则）

BSS/`memset(0)` 只保证数值 0，**不**等于业务「上电默认」。凡 stub ABI / 物理 ctx 字段语义默认**非 0**（例：armed=true），必须在 `pal_wasm_reset_physical()`（或等价复位序）显式初始化；不得依赖「没写过所以是对的」。（审阅提炼；场景清单 Wave 4 应收录。）

---

## 2. Fault 锁存与安全关断

### 2.1 锁存状态机

`wink-micro-os/targets/wasm/pal_wasm_fault.c` 维护 `static bool s_wasm_faulted`：

| API | 行为 |
|---|---|
| `pal_wasm_is_faulted()` | 查询锁存（只读 getter 在 faulted 态仍可用） |
| `pal_wasm_invoke_fault(code)` | **内部** fault 注入（当前唯一内部调用者：scheduler WCET 兜底，code=8002）。置位 + trace + safe-off + on_fault。幂等：已 latch 后仅 trace |
| `pal_wasm_host_fault(code, msg)` | **宿主→C** fault（JS safeWrap 捕获 plugin 异常，code=8003）。置位 + trace + safe-off + on_fault。幂等 |
| `pal_wasm_clear_fault_latch()` | 清锁存并清空 App callbacks 引用（每轮 `scheduler_run` 入口内部调） |
| `pal_wasm_fault_set_callbacks(cb)` | Scheduler ↔ fault 显式绑定；每轮 scheduler_run 入口重新注册（clear 会清引用） |

**仿真 / 宿主故障码注册表（8xxx 与相关；集中于此，防码段冲突）**：

| code | 含义 | 触发方 | 落地 |
|---|---|---|---|
| 8001 | boot-reset（启动/复位语义） | 设计保留 | **Partial～Planned**：码段预留；**本文件不声称**已有统一 boot-reset 注入点——新增触发须回写本表 |
| 8002 | WCET 超时（调度器单片执行超阈值，默认 5ms 墙钟） | `pal_wasm_invoke_fault` ← scheduler | **Landed** |
| 8003 | JS host plugin fault（override 抛异常或 Promise reject） | `pal_wasm_host_fault` ← safeWrap | **Landed** |
| -13 | `WINK_ERR_NO_MEM`（OOM） | 设计：配额失败 → fault | **Planned**（随 ADR-0045 固定堆） |

### 2.2 Safe-off 序列

首次 fault 时：

1. 置位 `s_wasm_faulted`；
2. `wink_trace_fault(code)` 写审计环；
3. `wink_actuator_safe_off_all()` 安全关断所有执行器（ADR-0024）；
4. 若调度器已启动（`s_app_callbacks != NULL`），调 `on_fault(code)` 回调。

后续调用仅 trace，不重复 safe-off。`on_fault` 可能延迟到下一个调度 tick。

### 2.3 fast-fail guards

fault latch 后，所有 state-mutating 的 `pal_wasm_*` 导出通过宏快速 no-op，避免 fault 后宿主继续驱动状态变更：

```c
WASM_FAULT_GUARD_VOID()    // → if (faulted) return;
WASM_FAULT_GUARD_WINKERR() // → if (faulted) return WINK_ERR_INVALID_STATE;
WASM_FAULT_GUARD_BOOL()    // → if (faulted) return false;
```

豁免：`pal_wasm_reset_physical()`（latched 态唯一允许运行的 mutator，它自己解锁）；只读 getter（不腐化状态且诊断必需）。

---

## 3. Host→C 异常兜底（P0-3 safeWrap）

`pal_wasm_host_fault` 的 JS 侧对端是 `createUnisimImports` 的 `safeWrap`/`safeWrapAsync` 高阶函数：

- 对所有用户可覆盖的 `js_*` import 包 try/catch + `Promise.catch`；
- 宿主抛错/reject **永远返回 resolved Promise** → Emscripten 永远看不到 throw/reject，不会 abort；
- 错误被 marshal 到 `pal_wasm_host_fault(8003, msg)` 走标准 fault 路径。

`msg_cstr` 契约：wasm 线性内存内 NUL 结尾 UTF-8 字符串指针（JS `_malloc` + `stringToUTF8` 写入，调用后 `_free`）；允许 NULL。

**为什么不做 `isWasmYielded` 状态机**：避免与 Asyncify 内部状态耦合，改由两层防线兜底：(a) safeWrap 永不抛给 Emscripten；(b) fault latch 后 mutator fast-fail。详见 [10 ABI #6](./10-wasm-js-bridge-abi.md)。

---

## 4. 故障审计环

`wink-micro-os/targets/wasm/pal_wasm_physical.c` 维护 **256 条**环形缓冲，记录所有物理退化事件（GPIO 抖动、I2C 丢包等）。CI 失败后 JS Worker 通过 cwrap 读回，重建"哪个故障在何时触发"的因果链。

```c
typedef struct {
    uint64_t timestamp_us;   // 与 pal_os_get_us 同源
    uint8_t  fault_type;     // wasm_fault_type_t
    uint16_t pin_or_bus;     // GPIO pin 或 I2C 总线号
    uint32_t sequence;       // 全局单调递增（首条=1；环形覆盖不回退）
} wasm_fault_event_t;
```

字段级访问器（避免 struct 跨语言 alignment/padding 风险）：JS 先 `pal_wasm_get_fault_log_count()`，再对每个 index 逐字段读出（timestamp 用 BigInt）。越界 getter 返回 0，调用方必须先判 count。故障类型枚举：`GPIO_BOUNCE=1`、`I2C_DROP=2`、`I2C_NOISE=3(预留)`、`CLOCK_DRIFT=4(预留)`。

---

## 5. 故障域与功耗模型（Wave3 预埋 stub）

`wink-micro-os/targets/wasm/pal_wasm_fault_domain.c` **ABI 已冻结、实现为 stub**（诚实标注未实现）：

- **故障域**：枚举 `WASM_FAULT_DOMAIN_GLOBAL/GPIO/I2C0/I2C1/SPI0/CLOCK/COUNT`。当前所有合法域都返回同一份全局 `s_faults`（等效单域）；`trigger_count` 恒 0；`armed` 默认 true（reset 后置位，BSS 零初值下 armed=false，故 JS Worker INIT 必须先 `pal_wasm_reset_physical()`）。
- **功耗模型**：`wasm_pin_power_model_t { active_current_ua, leakage_current_ua, transition_energy_nj }`；`set_pin_power_model` 仅校验参数不落存储，`get_total_energy_mj` 恒返回 0。

Wave3 点亮时无需改调用点/JS 桥，只在本文件内填逻辑。

---

## 6. ASan / UBSan 消毒（C25、C6.3）

- ASan 复用 `python wink-tools/wink.py test` pass 矩阵作为新的 **Pass 3（ASan Pass）**；
- Windows MinGW 缺 `libasan`，降级为 `-fsanitize-undefined-trap-on-error`；完整 ASan 在 Clang/Emscripten 上；
- UBSan 捕获有符号溢出/移位 UB、未对齐访问、NaN 传播等（C25）；
- Wasm 日间轨不全开 ASan（性能/支持限制），host/CI 全开。

| 问题 | 手段 | 归属 |
|---|---|---|
| UAF / 越界 / 溢出 | ASan | C6.3 |
| 未对齐 / 整数 UB | UBSan | C12.4/C25 |
| 竞态 | 影子内存 TSan（Phase 4） | C3 |
| 栈溢出 | `STACK_OVERFLOW_CHECK=2` + Fiber watermark | C6.5 |
