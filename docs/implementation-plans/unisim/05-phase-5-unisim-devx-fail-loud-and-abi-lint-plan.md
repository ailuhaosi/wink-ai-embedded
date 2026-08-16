# 阶段五计划：UniSim DevX 增强、Fail-Loud 诊断卡片、ABI Sync Lint 与 C 侧架构终极收敛

| 项 | Content |
|---|---|
| **计划名称** | Phase 5: UniSim DevX Enhancement, Fail-Loud Diagnostic, ABI Sync Lint & C Architecture Final Convergence |
| **所属总纲** | [`00-master-execution-plan.md`](./00-master-execution-plan.md) |
| **对齐提案** | [`06-c-target-architecture-and-refactoring-proposal.md`](./06-c-target-architecture-and-refactoring-proposal.md) (v2.0) |
| **状态** | **Draft (Aligned with v2.0 Architecture)** |
| **核心目标** | 增强 Web 开发者体验，提供 UI 层 Fail-Loud 诊断卡片，落地 C↔TS ABI 防腐 Lint，并完成 C 侧目录终极重命名、万能头解耦与空壳文件淘汰 |

---

## 1. 背景与提升点

在前四个阶段平摊完成 `ch2_bus`、`ch2_uart`、`ch2b_pwm`、`ch3_adc`、`ch1_gpio`、`ch4_buffer` 物理通道搬迁的基础上，Phase 5 集中完成两项任务：
1. **DevX 与 Lint 建设**：Fail-Loud 可视化诊断卡片与 C↔TS ABI 自动比对 Lint 脚本。
2. **C 侧架构终极收敛**：重命名剩余物理/中断文件、完成万能头解耦拆分、彻底淘汰空壳文件 `pal_hal_wasm.c` 与 `devices/` 目录，落地铁律 5 (CI Dependency Gate)。

---

## 2. 详细改动方案

### 2.1 TypeScript 侧（@wink-ai/unisim）

1. **[MODIFY] [peripheral-registry.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/core/peripheral-registry.ts)**:
   - 在 `validateDeviceTree(deviceTree)` 阶段加入深度的 Fail-Loud 规则校验（未注册 type、引脚绑定冲突、引脚类型不匹配）。
   - 抛出结构化的 `SimDiagnosticError` 数组。
2. **[MODIFY] [SimWorker.ts](file:///D:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts)**:
   - 捕获 `SimDiagnosticError` 时通过 `postMessage` 发送 `SIM_DIAGNOSTIC_EVENT`。

### 2.2 前端 UI 侧（embedded-frontend）

1. **[NEW] [SimDiagnosticCard.vue](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/embedded-frontend/src/components/peripherals/SimDiagnosticCard.vue)**:
   - 在 Workbench 顶端增加醒目的警告卡片，展示包含错误类型、受影响元件 ID 及修复建议。

### 2.3 构建与 Lint 工具链（wink-tools / unisim）

1. **[NEW] [abi_sync_check.py](file:///d:/MyWorkSpace_program/lowcode-nocode/ai-app/wink-ai-embedded/wink-tools/tools/lint/abi_sync_check.py)**:
   - 解析 `wasm_bridge.h` 里的 API 导出，比对 `createUnisimImports.ts` 参数签名与 `PAL_WASM_ABI_HASH`。
   - 对 `const uint8_t *` 等指针参数校验 TS 侧是否包含 `.slice()` 防御拷贝。
2. **[NEW] [layering.yaml](../../../../../wink-tools/tools/lint/rules/layering.yaml) (铁律 5 CI Dependency Gate)**:
   - 新增 AST / include 规则：断言 `pal_wasm_degradation.c` 与 `pal_wasm_fault*.c` **不得 `#include` 任何 `pal_wasm_ch*.h` 或通道内部头**。

### 2.4 C 侧 WASM Target 架构终极收敛 (遵从 06 v2.0 架构规范)

1. **前置 Gate 校验**：确认 Phase 2~4 功能分支已全量合入 main。
2. **文件重命名与混入函数迁移**：
   - 将 `pal_wasm_get_abi_hash()` 从 `pal_wasm_physical.c` 迁入 `pal_wasm_fault.c`。
   - 将 `pal_wasm_physical.c` 清理混入函数后重命名为 **`pal_wasm_degradation.c`**（轴归属纯化为 Axis F）。
   - 将 `pal_irq_wasm.c` 重命名为 **`pal_wasm_irq.c`**。
3. **`pal_wasm_internal.h` 万能头终极解耦**：
   - 完成剩余子头切出：`pal_wasm_degradation.h` 与 `pal_wasm_common.h`（全局常量 `WASM_SIM_MAX_PINS = 128`）。
   - 删除原万能头 `pal_wasm_internal.h`。
4. **淘汰空壳文件与遗留目录**：
   - **删除已为空壳的 `pal_hal_wasm.c`**。
   - **彻底删除 `devices/` 目录**（相关状态已在前序 Phase 完成迁移）。
   - 更新 `CMakeLists.txt` 为最终态显式源文件列表。

---

## 3. 任务列表 (Tasks)

- [ ] **Task 5.1**: 在 `@wink-ai/unisim` 实现 `validateDeviceTree` 的深度 Fail-Loud 规则引擎。
- [ ] **Task 5.2**: 在 `embedded-frontend` 开发 `SimDiagnosticCard.vue` 可视化诊断卡片（使用结构化错误码 + i18n 渲染）。
- [ ] **Task 5.3**: 编写 Python Lint 脚本 `abi_sync_check.py` 并挂载到 `wink lint`。
- [ ] **Task 5.4**: 在 `layering.yaml` 中增加铁律 5 (CI Dependency Gate) 规则，并补充 pytest。
  - **(G11)** 断言拆成**两个独立 test 函数**，不要混在 `test_lint_wasm_isolation.py` 的同一用例里：一个校验现有 `WASM-DAL-ISOLATION`（`dal/src` 不得出现 `#ifdef SIMULATION`）；另一个新增校验 `pal_wasm_degradation.c` / `pal_wasm_fault*.c` 不得 `#include` 任何 `pal_wasm_ch*.h`/通道内部头。反向用例：故意加非法 include 断言非 0 失败。
- [ ] **Task 5.5**: 建立回归基线 Snapshot 机制（Bun Test `--snapshot` 模式）。
- [ ] **Task 5.6**: 实现 `SimEngine.reset()` 热重载全清理协议。
- [ ] **Task 5.7** *(06 v2.0 终极收敛)*: **执行 C 侧文件重命名、万能头删除与空壳淘汰**。
  - 重命名 `pal_wasm_physical.c` $\rightarrow$ `pal_wasm_degradation.c`，重命名 `pal_irq_wasm.c` $\rightarrow$ `pal_wasm_irq.c`。
  - 完成 `pal_wasm_degradation.h` / `pal_wasm_common.h` 切出并删除 `pal_wasm_internal.h`。
  - 删除 `pal_hal_wasm.c` 与 `devices/` 目录。
  - 更新 `CMakeLists.txt` 为显式清单终极态并运行全量单测与回归快照。

---

## 4. 验证计划 (Verification)

### 自动化单元与 Lint 测试
- **ABI Lint 校验**：运行 `python3 wink-tools/tools/lint/abi_sync_check.py`，验证 `wasm_bridge.h` 与 TS 签名一致。
- **CI Dependency Gate 校验**：运行 `test_lint_wasm_isolation.py`，故意在 `pal_wasm_degradation.c` 中 `#include "pal_wasm_ch1_gpio.h"`，断言 CI 门禁直接报非 0 失败。
- **C 侧全量回归单测**：运行全套 C Unity 测试（`test_dal_*_sim.c`），断言文件重命名与万能头淘汰后全量构建与运行通过。
- **快照回归验证**：运行 `bun test --update-snapshots`，比对仿真快照。
