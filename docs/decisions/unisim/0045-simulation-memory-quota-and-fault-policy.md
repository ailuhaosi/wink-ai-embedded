# ADR-0045：仿真内存隔离配额建模、OOM 故障接入与隔离边界规约

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-25 |
| 触发 | [Phase 2 内存隔离与安全边界检测计划](../../../brain/deee889b-5046-42f8-a96d-13c39d7d282c/implementation_plan.md) |
| 影响范围 | targets (wasm/host/esp32) / OSAL / Fault 恢复域 / CodeGen / Lint 规则 |
| 决策者 | 核心架构师团队 |
| 关联既有 ADR | [ADR-0003 仿真可信度边界](0003-simulation-fidelity-boundary.md), [ADR-0009 物理行为仿真与故障注入](0009-physical-behavior-simulation-fault-injection.md), [ADR-0024 故障三阶段模型与 DAL Deinit 契约](../core/0024-fault-three-phase-model-and-dal-deinit-contract.md) |

---

## 背景（Context）

在当前 WinkOS 系统的 Wasm / Host 仿真环境下，由于宿主机内存几乎无限，运行代码默认不受 MCU（如 ESP32、Cortex-M）受限 SRAM 的物理约束。在早期讨论中曾考虑过自研静态数组与新增 `pal_malloc()` 接口的方式，但这暴露出了三大严重问题：
1. **真机构建污染风险**：若在平台无关的 `pal/` 层增加通用分配器，会将仿真专用的静态堆数组引入 ESP32 真机构建，破坏 FreeRTOS 物理堆与 `heap_caps` 分区语义。
2. **现网原生分配改道拦截失效**：现有系统组件直接调用 `malloc/calloc`，暴露非标 `pal_malloc()` API 无法有效拦截第三方或已有分配代码。
3. ** Fault 恢复流程脱节**：WinkOS 的安全设计原则规定“运行时路径不得任意引发未处理的内存溢出崩溃”。如果仿真 OOM 仅简单返回 `NULL`，将无法联动 [ADR-0024](../core/0024-fault-three-phase-model-and-dal-deinit-contract.md) 规定的故障恢复与上报流程。

---

## 决策（Decision）

为建立无缝、零代码修改且绝对隔离真机构建的内存安全边界，我们做出以下决策：

### 1. 物理隔离：仿真配额绝对收敛在 Target 层
* **真机（ESP32 / Baremetal）零污染**：禁止在 `pal/` 平台无关通用层增加任何 `s_sim_heap` 静态数组或仿真分配逻辑。真机代码保持原生 libc / FreeRTOS 堆语义不变。
* **Wasm 仿真层**：直接通过 Emscripten 链接标记构建物理 RAM 封顶：
  `-sINITIAL_MEMORY=${WINK_SIM_MEMORY_BYTES} -sMAXIMUM_MEMORY=${WINK_SIM_MEMORY_BYTES} -sALLOW_MEMORY_GROWTH=0`
  实现**零代码改动、自动拦截所有原生 `malloc/calloc`** 的内存封顶。
* **Host Native 仿真层**：在 `targets/host/` 中提供可选的链接包装器（`-Wl,--wrap=malloc`），仅在 Host 仿真启用时动态计费与拦截。

### 2. 内存断言定位澄清（Resource Assertion Baseline）
* 明确仿真侧设置的堆配额（如默认 256KB）为**仿真侧断言基线（Simulation Assertion Baseline）**，用于强制暴露内存泄漏与无判空逻辑，而非 100% 硬件物理 DRAM 镜像。

### 3. OOM 接入三阶段 Fault 模型（`WINK_ERR_NO_MEM`）
* 当仿真环境中由于堆限额导致 `malloc` 失败时，禁止默默吞没错误或裸崩溃。
* 必须统一触发故障派发：
  1. 调用 `pal_wasm_invoke_fault(WINK_ERR_NO_MEM)`（映射码 `-13`）；
  2. 写入 Fault Ring Buffer，记录分配尺寸与现场；
  3. 触发 [ADR-0024](../core/0024-fault-three-phase-model-and-dal-deinit-contract.md) 规定的 `app_on_fault()` 回调，驱动系统安全进入 Fail-Safe 隔离状态。

### 4. 构建 Pass 矩阵复用与 Windows 兼容
* Sanitizer 测试开关严格复用 [python wink-tools/wink.py test](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/python wink-tools/wink.py test) 既有的 Pass 矩阵，新增 `Pass 3 (ASan Pass)`。
* 考虑 Windows MinGW 工具链缺少 `libasan`，在 MinGW 下自动降级使用 `-fsanitize-undefined-trap-on-error`，完整 ASan 放在 Clang / Emscripten 环境中运行。

### 5. 治理规约：App / BAL 禁止裸调 `malloc`
* 在 `tools/lint/rules/memory.yaml` 中新增静态检查规则：强行禁止业务应用 `wink-micro-app` 以及业务抽象层 `BAL` 直接调用 `malloc/free`，强制使用框架静态对象池或确定性分配器。

---

## 后果（Consequences）

* **真机无缝零影响**：真机构建二进制文件不包含任何仿真隔离冗余代码，内存尺寸无增长。
* **零侵入性与高透明度**：无需改写 C 代码中的 `malloc` 符号，Wasm 链接参数自然拦截所有标准库和第三方库的动态分配。
* **架构合规性**：OOM 行为与 Fault 模型完整贯通，测试与诊断行为符合工业级嵌入式规范。

---

## 遵循与落地（Compliance & Implementation）

1. 创建并提交 [ADR-0045](0045-simulation-memory-quota-and-fault-policy.md) 规范文档。
2. 更新 [targets/wasm/CMakeLists.txt](../../wink-micro-os/targets/wasm/CMakeLists.txt) 增加 `-sMAXIMUM_MEMORY` 链接约束。
3. 扩展 [python wink-tools/wink.py test](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/python wink-tools/wink.py test) 增加 Pass 3 ASan pass。
4. 新增 [tools/lint/rules/memory.yaml](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/lint/rules/memory.yaml) 门禁规约。

