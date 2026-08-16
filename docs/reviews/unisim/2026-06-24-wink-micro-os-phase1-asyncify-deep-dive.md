# Wink-AI 嵌入式（WinkMicroOS）· Phase 1（Wasm Asyncify）深挖评审报告

| 项 | 内容 |
|---|---|
| 评审日期 | 2026-06-24 |
| 评审对象 | [Phase 1 实施 plan](../../implementation-plans/core/01-wasm-asyncify-stack-safety.md) + 对照源码（`targets/wasm/*`、`runtime/src/wink_runtime.c`、`wink-micro-os/CMakeLists.txt`、`dal/src/dal_ultrasonic.c`） |
| 评审基线 | Phase 1 plan · [代码评审 H1](../core/2026-06-24-wink-micro-os-code-review.md) · [补充评审 #5](../core/2026-06-24-wink-micro-os-supplemental-review.md) · [综合评审 P0-1](../core/2026-06-24-wink-micro-os-integrated-review.md) · [ADR-0002](../../decisions/unisim/0002-dual-target-compilation.md) · [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md) |
| 评审视角 | Emscripten Asyncify 运行时机制 + 嵌入式架构师（识别"修复 A 激活 B"的次生风险） |
| 评审方法 | plan 逐 Task 核验「Source-of-truth」声明 → 源码 `file:line` 对照 → Asyncify 挂起/恢复机制推演 → 跨 Phase 依赖反查 |
| Plan 成熟度 | **地面事实准确度 9/10**｜**次生风险预见度 4/10**（D1 为修好 P0-1 必然激活的活跃 bug，计划未预见） |
| 关联评审 | [2026-06-24 代码评审](../core/2026-06-24-wink-micro-os-code-review.md)（H1）、[2026-06-24 补充评审](../core/2026-06-24-wink-micro-os-supplemental-review.md)（#5）—— 本报告为二者在 Asyncify 维度的纵深延伸 |

---

## 一、总体判断

Phase 1 plan 是这套 7 阶段里技术深度最高的一篇，其「Source-of-truth check」声明经逐项对照源码**全部属实**——死符号 `js_sim_get_ultrasonic_distance` 全仓无 C 调用点、真挂起点在 `pal_osal_wasm.c:9-15`、import 裸函数名与 `wasm_bridge.h:33-34` 一致、`js_pal_delay_us` 当前确无仿真侧 C 调用点（"防御性列入"判断成立）。Task 1-1/1-2 的 C/CMake 修正是**正确且必要**的。

**但 plan 的严谨恰恰集中在"已核验的地面"，真正会咬人的是它没碰的地方。** 本报告的核心结论：

> 🔴 **Phase 1 修好 P0-1（让 `js_pal_delay_ms` 真挂起）的那一刻，会把一个被"卡死"表象长期掩盖的活跃 bug 激活为必然崩溃——JS 中断桥 `_trigger_wasm_interrupt` 的 Asyncify 重入。** 这是 D1，比 plan 要修的死符号严重一个量级，且是 Phase 4（超声波 echo 中断）的硬前置。

此外有 3 处中危计划盲区（`js_pal_i2c_transfer` 的 Asyncify 归属矛盾、Task 1-4 契约文件归属误判、AI 生成递归对 Asyncify 栈的项目特有风险）与 1 处低危契约缺口（`callMain` 与永不返回的 `main`）。

按既有整改规则，**P0-1 不得仅凭 Task 1-1/1-2 完成即关闭**——须追加 D1 的中断重入验证（见第六节）。

---

## 二、核验结论（plan 地面事实全部属实，建立可信基线）

| Plan 声明 | 源码核验 | 结论 |
|---|---|---|
| `CMakeLists.txt:33` 为死符号、`:32` 为 `ASYNCIFY=1` | `wink-micro-os/CMakeLists.txt:32-33` | ✅ |
| 真挂起点 `pal_osal_wasm.c:9-15` → `js_pal_delay_ms/us` | `targets/wasm/pal_osal_wasm.c:9-15` | ✅ |
| import 裸函数名与 `wasm_bridge.h:33-34` 一致 | `targets/wasm/wasm_bridge.h:33-34` | ✅ |
| 死符号 `js_sim_get_ultrasonic_distance` 全仓无 C 调用点 | grep 仅命中文档/skill 副本，无 `.c` 调用 | ✅ |
| `js_pal_delay_us` "防御性"列入（当前无调用点） | `dal/src/dal_ultrasonic.c:24` 仿真分支 bypass，真机分支 `:42` 才用 `pal_delay_us(10)`；仿真路径不达 | ✅（判断准确） |

> 即 plan 写进文档的每一条 `file:line` 都是真的。**下面的发现全部落在 plan 没写到的地方。**

---

## 三、发现清单（按严重性分级）

> 分级沿用 [代码评审](../core/2026-06-24-wink-micro-os-code-review.md) 第三节体系：**致命**（系统崩溃）｜**高**（真实 bug / 架构违背）｜**中**（SSOT / 契约缺口 / 流程缺陷）｜**低**（细节）。

### 🔴 高 — D1：修好挂起会激活 `_trigger_wasm_interrupt` 的 Asyncify 重入崩溃

**位置**：[`targets/wasm/wasm_entry.c:23-29`](../../../../wink-micro-os/targets/wasm/wasm_entry.c#L23-L29)（导出函数）+ [`wink-micro-os/CMakeLists.txt:34`](../../../../wink-micro-os/CMakeLists.txt#L34)（`EXPORTED_FUNCTIONS=['_main','_trigger_wasm_interrupt']`）+ [`runtime/src/wink_runtime.c:21-27`](../../../../wink-micro-os/runtime/src/wink_runtime.c#L21-L27)（每 tick 挂起）

**机制（三段推演）**：

1. **Phase 1 的 KPI 就是让 `pal_delay_ms → js_pal_delay_ms` 真挂起**。而主循环 `wink_runtime_run`（`wink_runtime.c:21-27`）是**每个 tick 末尾调用 `wink_app_delay_ms` 触发一次挂起**的无限循环——意味着修好之后，**每个 tick 都打开一个挂起窗口**。
2. Emscripten classic Asyncify（`ASYNCIFY=1`）的挂起/恢复基于**栈快照**：unwind 把整个 wasm 调用栈写入 `ASYNCIFY_STACK_SIZE` 缓冲、控制权交还 JS，rewind 时恢复。在 unwind 完成、尚未 rewind 的 "sleeping" 窗口内，wasm 实例的调用栈是**中间态**。Emscripten 官方文档明确警告：**挂起期间不得从 JS 回调任何 wasm 导出函数**，否则与已保存的挂起栈冲突，典型表现为 `RuntimeError: invalid Asyncify state` / abort / 栈损坏。
3. 而 `trigger_wasm_interrupt`（`wasm_entry.c:24`）被导出为 `_trigger_wasm_interrupt`，设计意图是**随时可被 JS 调用**来模拟硬件中断（GPIO echo 上升沿、按键），且内部 `(pal_gpio_isr_t)(uintptr_t)callback_index` 强转回函数指针并 `isr(arg)` 调用——一次完整的有状态 wasm 调用。

**核心悖论**：P0-1 未修时，`js_pal_delay_ms` 不挂起 → wasm 霸占 JS 主循环卡死 → 中断重入 bug 被"卡死"表象**长期掩盖**。**Phase 1 一旦修通挂起，每个 tick 都对中断暴露一个 sleeping 窗口，而 GPIO 中断恰好最可能在"等待"语义窗口里到达** → 重入崩溃从"理论隐患"升级为**必然触发的活跃 bug**。

**计划与既有评审漏在哪**：
- Phase 1 Task 1-4 的 JS 契约只写"`js_pal_delay_ms` 怎么用 `handleSleep` 挂起"，**未写"挂起窗口内禁止重入 wasm 导出"**。
- 既有评审至今把中断桥标为"健壮性待验证"（[ADR-0002](../../decisions/unisim/0002-dual-target-compilation.md) 关联风险、`realtime-hardware.md`）——定性过弱。这是**确定性**运行时崩溃路径，不是概率性的。

**依据**：[Emscripten Asyncify 文档](https://emscripten.org/docs/porting/asyncify.html)（挂起期间不可重入）、ADR-0002（Wasm 中断桥已知薄弱点）、c-code.md §3（双 target 同源）。

**建议（须写进 Task 1-4 契约，并升级为 Phase 1→4 横切红线）**：
- **(A) 中断排队 + tick 边界注入（推荐）**：JS 侧中断入 ring buffer，只在 wasm rewind 后、下一次 `delay` 前的 tick 边界 flush；sleeping 期间拒绝直调 `_trigger_wasm_interrupt`。
- **(B) Asyncify state 守卫**：JS 侧用 `Asyncify` 暴露的运行态判断是否处于 sleeping，sleeping 时缓存中断。
- **(C) 架构级（治本）**：把"JS 随时注入中断"改成"wasm 主动 poll pending 中断"（轮询模型），从根上消除重入面——需重设 `wasm_entry.c` 中断桥契约。
- **次生收益**：Task 1-2 加的 `ASSERTIONS=1` + `STACK_OVERFLOW_CHECK=2` 会让这个崩溃**带清晰断言地更早 abort**——它不只是"防栈溢出"，同时是 D1 的早期报警器。Task 1-2 的语义说明应据此扩写。

---

### 🟡 中 — D2：`js_pal_i2c_transfer` 的 Asyncify 归属矛盾（Task 1-3 的 SSOT 漏改点）

**位置**：[`docs/design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md:79`](../../design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md#L79)（文档）vs [`targets/wasm/wasm_bridge.h:26`](../../../../wink-micro-os/targets/wasm/wasm_bridge.h#L26)、[`targets/wasm/pal_hal_wasm.c:44-48`](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/targets/wasm/pal_hal_wasm.c#L44-L48)（代码）

**问题**：`01-wasm-sandbox-lifecycle.md:79` 的编译参数写的是
```bash
-s ASYNCIFY_IMPORTS=["js_pal_delay_ms", "js_pal_i2c_transfer"]
```
即**把 `js_pal_i2c_transfer` 当作异步挂起 import**。但 `wasm_bridge.h:26` 与 `pal_hal_wasm.c:44-48` 明明是**同步 `bool` 返回的零拷贝 transfer**（§3「共享内存零拷贝」明确为同步直读）。2026-06-22 架构评审 L148 已记录此矛盾（"04-01 声明异步，04-03 实现同步零拷贝"），**至今未裁决**。

**计划漏在哪**：Task 1-3 要改的正是这份 `01-wasm-sandbox-lifecycle.md`，但其 Precise change 只说"更新 import 列表为 `js_pal_delay_ms/us`"，对 `js_pal_i2c_transfer` **一字未提**。机械替换的后果二选一都不好：保留 → SSOT 仍未闭合（文档异步 / 代码同步）；删除 → 未来 i2c 若真需 asyncify 又得重加。

**依据**：docs-adr.md §2（SSOT）、ADR-0003（同步零拷贝语义）、2026-06-22 架构评审 L148。

**建议**：Task 1-3 必须**显式裁决** `js_pal_i2c_transfer` 为**同步零拷贝、非挂起点**，从 IMPORTS 移除，并在文档注明依据（ADR-0003）。这是一项需 ADR-0002/0003 联动定性的小决策，不可藏在机械替换里。

---

### 🟡 中 — D3：Task 1-4 契约"完全缺失"的判断有误，将制造新的 SSOT 分裂

**位置**：[Phase 1 plan Task 1-4](../../implementation-plans/core/01-wasm-asyncify-stack-safety.md#L90-L124) vs [`docs/design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md:60-71`](../../design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md#L60-L71)

**问题**：Task 1-4 开头称"这是原计划完全缺失、却决定成败的 Task，要新建 `02-asyncify-suspend-contract.md`"。但 `01-wasm-sandbox-lifecycle.md:60-71` **已有一份基本正确的 JS 契约**（`Asyncify.handleSleep(wake => setTimeout(wake, ms))`）。

这就自相矛盾了：**同一份 `01` 文档，在 Task 1-3 里是要清理的"旧文档"，在 Task 1-4 里却被当作"契约完全缺失、需新建载体"**。真正的问题不是"缺失"，而是"契约散落在 `01 §2.2.2`、且其 import 列表与代码不一致"。

**风险**：新建 `02` 会得到**两份契约文件**（`01 §2.2.2` 的旧 + `02` 的新），制造新的 SSOT 分裂——正好踩中本项目反复栽过的"同一符号多处漂移"老坑（`pitfalls.md:31` 活样本）。

**依据**：docs-adr.md §2、`pitfalls.md` 陷阱3。

**建议**：**不新建 `02`**，直接**修正 + 强化 `01 §2.2.2` 既有契约**：补 D1 的重入约束、D5 的 `callMain` 语义、D4 的栈实测维度，并修正 D2 的 import 列表。把"新建文件"的 Task 1-4 重定义为"原地补强 `01 §2.2.2`"。

---

### 🟡 中 — D4：AI 生成业务逻辑的递归调用链对 Asyncify 栈的项目特有风险

**位置**：Phase 1 Task 1-2（`ASYNCIFY_STACK_SIZE=65536`）+ Task 1-4 实测清单第 6 项

**问题**：plan 说 64KB 是"安全起步值、须实测"，但**未识别本项目独有的风险维度**。WinkMicroOS 的业务逻辑（BAL 之上）是**可视化拖拽 / AI 生成**的，可能产生**人脑无法预判的深递归调用链**（表达式求值递归下降、嵌套状态机）。Asyncify 栈消耗 ≈ O(递归深度 × 帧大小 + per-frame overhead)，一条深度递归的生成路径就能打穿 64KB → 栈恢复失败；且因其发生在"AI 写的代码"里，**复现极难、定位极慢**。

plan 的实测清单只覆盖固定链 `wink_runtime_run → app_loop → pal_delay_ms`，对"最深 AI 生成链"无压测。

**依据**：ADR-0002（Asyncify 栈税已知风险）、[00-README 第八节「AI 友好的 OS 契约」](../../superpowers/plans/wink-micro-os-arch-restructure/00-README.md)（长期演进方向）。

**建议**：
- Task 1-4 实测清单追加：用**最深 AI 生成调用链**做 Asyncify 栈压测，记录安全余量。
- 治本：在 BAL/Codegen 层**静态约束递归深度上限**（生成期拦截），把风险挡在代码生成阶段而非运行期——呼应 00-README 第八节"机器可读 OS 契约清单"。

---

### 🟢 低 — D5：`callMain()` 与"永不返回的 `main`"（Task 1-4 契约细节缺口）

**位置**：Phase 1 Task 1-4 契约（`Module._main` 句柄表述）vs [`targets/wasm/wasm_entry.c:31-35`](../../../../wink-micro-os/targets/wasm/wasm_entry.c#L31-L35) + [`runtime/src/wink_runtime.c:21`](../../../../wink-micro-os/runtime/src/wink_runtime.c#L21)

**问题**：`main` 是无限循环（`wink_runtime_run(cb, 0)`，`max_ticks=0`），ASYNCIFY 下靠内部 `delay` 反复挂起-唤醒推进，**永不返回**。Task 1-4 契约写"JS 侧用 `Module._main` 句柄调度"，但在 `MODULARIZE=1` + `ASYNCIFY=1` 下，正确入口是 `Module.callMain()`，且它永不返回——JS 侧不能 `await callMain()` 等其结束。前端若按 `Module._main()` 直调，会偶发挂起/重入异常（与 D1 同源）。

**依据**：Emscripten MODULARIZE/ASYNCIFY 文档、`CMakeLists.txt:36-37`（`MODULARIZE=1` / `EXPORT_NAME='WasmSandbox'`）。

**建议**：契约写明"入口用 `Module.callMain()`，且为永不返回的驱动循环，JS 侧不得阻塞等待其返回"。

---

## 四、Safety Review（按 `embedded-best-practice` 编辑后安全审查协议输出）

```text
Safety review:
- Risk level: 高（D1 为"修好 P0-1 必然激活"的确定性运行时崩溃；D2/D3 为 SSOT 与流程缺陷；D4 为难复现的栈风险）
- Checklist phases run: 2（逻辑正确性）、3（内存/栈安全）、4（并发/重入）、
  8（硬件交互：中断桥）、9（鲁棒性）、12（影响分析）
- Findings:
  · 致命: 0
  · 高:   D1（_trigger_wasm_interrupt 在 Asyncify sleeping 窗口被 JS 调用 → 重入崩溃；
           修好 P0-1 即激活，是 Phase 4 中断路径的硬前置）
  · 中:   D2（js_pal_i2c_transfer 文档异步/代码同步，Task 1-3 漏裁决，SSOT 未闭合）、
          D3（Task 1-4 误判契约"缺失"将新建文件，制造新 SSOT 分裂）、
          D4（AI 生成递归调用链打穿 Asyncify 栈，难复现）
  · 低:   D5（callMain / 永不返回的 main 契约缺口）
- Fixed: 无（本次为只读评审，未改动 plan 或代码）
- Assumptions:
  · D1 的精确 Emscripten 报错字符串随版本变化，机制（挂起期间不可重入）为确定；
    建议在 Emscripten 环境用真实 GPIO 中断时序实测确认
  · D4 的"最深 AI 生成链"形态取决于 BAL/Codegen 产出，待 Codegen 成熟后量化
  · plan 的 Task 1-1/1-2 修正确实必要，本报告不否定其价值，仅补其盲区
- Commands run: 全程只读（Glob/Read/Grep），未执行构建/测试
```

---

## 五、整改跟踪（映射到 Phase 1 Task）

| 发现 | 整改方式 | 落地位置 | 状态 |
|---|---|---|---|
| **D1** — Asyncify sleeping 窗口中断重入崩溃 | Task 1-4 契约补"挂起窗口禁止重入 wasm"+ 中断排队/tick 边界注入；Task 1-2 扩写断言为 D1 早期报警器；00-README 标 Phase 1→4 横切红线 | `01` plan Task 1-2/1-4、`00-README`、跨仓 JS 中断注入逻辑 | ⬜ 未开始 |
| **D2** — `js_pal_i2c_transfer` 异步/同步矛盾 | Task 1-3 显式裁决为同步、移出 IMPORTS，注明 ADR-0003 依据 | `01-wasm-sandbox-lifecycle.md:79`、Phase 1 plan Task 1-3 | ⬜ 未开始 |
| **D3** — Task 1-4 误判契约"缺失"将新建文件 | 不新建 `02`，重定义为"原地补强 `01 §2.2.2`" | Phase 1 plan Task 1-4 | ⬜ 未开始 |
| **D4** — AI 生成递归打穿 Asyncify 栈 | Task 1-4 实测加"最深 AI 生成链"压测；BAL/Codegen 加递归深度静态上限 | Phase 1 plan Task 1-4、BAL/Codegen（长期） | ⬜ 未开始 |
| **D5** — callMain / 永不返回的 main | Task 1-4 契约补入口与不阻塞语义 | Phase 1 plan Task 1-4 | ⬜ 未开始 |

> **P0-1 关闭条件升级**：综合评审 P0-1 须在 Task 1-1/1-2 + Task 1-4 跨仓联调 + **D1 中断重入不再可触发**三项全部通过后方可关闭。未追加 D1 验证前，P0-1 即便挂起修通也只能标"部分完成"。

---

## 六、Phase 1 Task 增补清单（可直接落 plan）

| Task | 增补内容 |
|---|---|
| **1-1** | 无需改（`js_pal_delay_ms/us` 列入正确；`us` 防御性判断经核验准确）。 |
| **1-2** | `ASSERTIONS=1`/`STACK_OVERFLOW_CHECK=2` 语义说明扩写为"兼作 D1 中断重入的早期报警器"，不仅防栈溢出。 |
| **1-3** | **裁决 `js_pal_i2c_transfer` 为同步零拷贝、移出 IMPORTS**（D2），注明 ADR-0003 依据；不新建文件（D3），直接在 `01 §2.2.2` 原地改。 |
| **1-4** | 契约补四段：① 挂起窗口**禁止重入 wasm**，中断排队到 tick 边界（D1，阻断 Phase 4）；② 入口 `callMain()` + 永不返回（D5）；③ 栈实测含**最深 AI 生成链**压测（D4）；④ 强化 `01 §2.2.2` 既有契约而非新建 `02`（D3）。 |
| **00-README** | 依赖图把"中断重入约束"标为 Phase 1→4 横切红线；Phase 1 出口验收增"中断重入不再可触发"一条。 |

---

## 七、与既有评审的关系（增量定位）

- 本报告 **不推翻** 代码评审 H1 / 补充评审 #5 / 综合评审 P0-1 的任何结论——它们的"死符号 + 缺挂起"诊断正确，Task 1-1/1-2 的修法正确。
- 本报告的增量在于：**把"修好 P0-1 会激活什么"的次生风险（D1）与 plan 内三处盲区（D2/D3/D4）显性化**，使 Phase 1 的关闭条件从"挂起修通"升级为"挂起修通 + 重入不可触发 + 契约 SSOT 闭合"。
- D1 同时是对"中断桥健壮性待验证"（ADR-0002 关联、`realtime-hardware.md`）这一**长期模糊定性**的升级：给出**确定性**结论与三条解法路径。

---

*评审人立场：本报告为 2026-06-24 时点对 Phase 1 plan 及其源码对照的深挖判断快照。归档后按 reviews 约定只读；plan 据 D1–D5 增补、或相关 ADR / 设计规范 / 代码整改回写后，本报告中的相关表述不再代表当前事实。*

