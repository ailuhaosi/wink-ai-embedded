# PLAN-20260705-APP-LOWCODE: App 层低代码统一架构实施计划

> 📋 **本文档是 App 层低代码统一架构（codegen + 设备树收拢 + BAL helper 降噪）的分阶段实施计划。**
> 🎯 **计划版本**：v1.0（2026-07-05）
> 📚 **关联技术设计**：[tech-designs/app-layer-lowcode-unification-design.md](../../tech-designs/tools/app-layer-lowcode-unification-design.md)
> 🤖 **开发角色**：Claude Code（主）+ Antigravity Pair（复核）

---

## 1. 元数据表

| 字段 | 内容 |
|---|---|
| **计划编号** | `PLAN-20260705-APP-LOWCODE` |
| **创建日期** | 2026-07-05 |
| **目标平台/SoC** | `host` / `wasm` / `ESP32-DevKitC` |
| **工具链/SDK 版本** | `ESP-IDF v6.0.1` / `GCC (WinLibs)` / `Emscripten` |
| **计划状态** | 🟢 已完成 |
| **总体优先级** | 🟡 P1（配合低代码 codegen 主线；不阻塞真机冒烟） |
| **预计总工时** | P0 1 天 / P1 4-5 天 / P2 2 天 / P3 1 天（合计约 8-9 人天） |
| **关联 ADR** | ADR-0001、ADR-0002、ADR-0004、ADR-0012、ADR-0013/0014、ADR-0018 |
| **关联设计规范** | [02-wink-micro-os/03-directory-architecture.md](../../design/02-wink-micro-os/03-directory-architecture.md)、[03-app-codegen/01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md) |
| **关联前置计划** | [2026-07-04-wmos-comprehensive-hardening-plan.md](../core/2026-07-04-wmos-comprehensive-hardening-plan.md)、[2026-07-05-wmos-hierarchical-logging-hardening-plan.md](../core/2026-07-05-wmos-hierarchical-logging-hardening-plan.md) |
| **依赖的硬化工件** | Wave 6 `app_callbacks.c` 已压缩到 149 行、wink_selftest 可用、分级日志稳定 |
| **替代/废弃** | 无，纯叠加式重构 |
| **计划负责人** | Wink-AI 嵌入式团队 |
| **所需子代理技能** | `embedded-best-practice`、`subagent-driven-development`、`test-driven-development`、`systematic-debugging` |

---

## 2. 背景与目标

### 2.1 问题陈述

当前 App 层（以 `samples/devkitc_smoke/app_callbacks.c` 为代表）虽然已通过 Wave 5/6 重构压到 149 行，但仍存在三类**对 AI 代码生成不友好**的样板噪音：
1. **执行器 Thunk 注册仪式**：每个执行器需要 `WINK_DEFINE_ACTUATOR_THUNK` + `wink_actuator_register` 两行样板，且注册顺序隐含安全语义（fault 时先停谁）；
2. **返回值宏视觉噪音**：`WINK_IGNORE_RESULT(...)` 出现在大量非关键调用处，掩盖了真正需要检查的位置；
3. **显式 poll 义务**：`app_loop` 必须 `dal_button_poll()` ，否则按键失效，属于"不写就跑不通但写错了也不报错"的隐性契约。

低代码平台的核心约束是 **AI/UI 工具生成的应该是声明式配置（JSON/YAML），而不是过程式 C 代码**——过程式生成易幻觉、难静态校验、难 diff review。

### 2.2 总体目标

对齐 tech-design §1.3：
- App 层业务代码 100% 硬件解耦（零引脚、零 thunk、零 `WINK_IGNORE_RESULT` 样板）；
- 单一 `wink-app.json` 驱动 codegen 生成设备树/glue/CMake 选项；
- 契约诚实：不引入隐式框架行为破坏 init/deinit 对称；
- 严格对齐现有 ADR（静态分发、协作调度、IRQ 收窄、契约诚实）；
- 三 target 同源，ESP32 build 0 warn 0 error，host 单测 100% PASS。

### 2.3 成功指标（验收出口）

| 指标 | 通过标准 | 验证方法 |
|---|---|---|
| P0 收尾 | devkitc_smoke `app_callbacks.c` 再压至 ~80 行；设备 init/thunk 全部收拢到 `device_tree.c`；BAL API 按分级降噪；host/wasm/esp32 三端 S1-S10 全 PASS | 读代码 + `python wink-tools/wink.py test` + 烧录验证 |
| P1 codegen v1 | `app_codegen.py` 从一份 `wink-app.json` 正确生成 device_tree.c/h、app_support.c、app_options.cmake；金标准 diff 测试通过 | 单元测试 + 实际构建 sample |
| P1 button_helper | 新 BAL 组件三 target 单测通过；回调 ISR-like 约束在头文件显式标注；误用阻塞 API 在 host 单测中能被断言捕获 | 单测 + 真机按键测试 |
| P2 CMake 裁剪 | 关掉未用驱动的 `WINK_USE_XXX` 后，对应 API 触发编译期 `__attribute__((unavailable))` 友好报错；CI 构建时间下降 ≥15% | 构建对比 |
| 回归 | 重构全程 devkitc_smoke S1-S10 全 PASS；ESP32 0 warn 0 error；现有其它 sample 无需修改即可继续构建 | CI 全量 + 烧录 |
| 活文档回写 | P1 完成后更新 Layer ① 活文档 `03-app-codegen/01-app-business-logic.md`，将 codegen 契约加入 SSOT | 文档 review |

---

## 3. 变更范围与影响分析

### 3.1 文件变更清单（按阶段）

#### P0 阶段（手工重构，1 天）

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `wink-micro-os/samples/devkitc_smoke/device_tree.h` | ✏️ 修改 | 新增 `wink_device_tree_init()/deinit()` 声明；移除引脚宏（移入 .c） |
| `wink-micro-os/samples/devkitc_smoke/device_tree.c` | ✏️ 修改 | 从"纯静态实例"扩展为"实例 + init 序列 + actuator 注册 + deinit 序列" |
| `wink-micro-os/samples/devkitc_smoke/app_callbacks.c` | ✏️ 修改 | 删除分散的 init/thunk/register；`app_init` 改为调 `wink_device_tree_init()` + 业务逻辑；app_loop 保持 poll（等 P1 button_helper） |
| `wink-micro-os/samples/common/include/wink_blink_helper.h` | ✏️ 修改 | 去掉 `wink_led_blink_start/stop` 的 `WINK_WARN_UNUSED_RESULT` |
| `wink-micro-os/samples/common/src/wink_blink_helper.c` | ✏️ 修改 | 内部失败改 `LOG_D` 自记，不向上抛（fire-and-forget 语义） |
| `wink-micro-os/samples/common/include/wink_default_telemetry.h` | － | 保持 `warn_unused_result`（Normal 级，服务启动类） |
| `wink-micro-os/samples/common/src/wink_sim_ultrasonic_echo.*` | － | 保持 `warn_unused_result`（Normal 级） |

#### P1 阶段（codegen v1 + button_helper，4-5 天）

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `tools/codegen/app_codegen.py` | 🆕 新增 | codegen 主程序，<300 行；读 JSON 渲染 Jinja2 模板 |
| `tools/codegen/drivers/led.py` | 🆕 新增 | LED 驱动插件（生成 config 结构体、init 调用、thunk、deinit） |
| `tools/codegen/drivers/button.py` | 🆕 新增 | 按键驱动插件 |
| `tools/codegen/drivers/ultrasonic.py` | 🆕 新增 | 超声波驱动插件 |
| `tools/codegen/templates/device_tree.h.j2` | 🆕 新增 | Jinja2 模板 |
| `tools/codegen/templates/device_tree.c.j2` | 🆕 新增 | Jinja2 模板 |
| `tools/codegen/templates/app_support.c.j2` | 🆕 新增 | Jinja2 模板 |
| `tools/codegen/templates/app_options.cmake.j2` | 🆕 新增 | Jinja2 模板 |
| `wink-micro-os/samples/common/include/wink_button_helper.h` | 🆕 新增 | BAL 组件：soft_timer 周期 poll 封装 |
| `wink-micro-os/samples/common/src/wink_button_helper.c` | 🆕 新增 | 跨三 target 实现；内部静态实例表 |
| `wink-micro-os/dal/include/dal_button.h` | ✏️ 修改 | 加 `dal_button_deinit()` 对称 API（当前可能缺失或未暴露） |
| `wink-micro-os/test/test_button_helper.c` | 🆕 新增 | host 单测：短按/长按/连发/重复 start 拒绝/上下文阻塞检测 |
| `wink-micro-os/samples/devkitc_smoke/wink-app.json` | 🆕 新增 | devkitc_smoke 的声明式配置 |
| `wink-micro-os/samples/devkitc_smoke/app_callbacks.c` | ✏️ 修改 | 改为"codegen 样板"：手写业务回调 + `wink_app_get_callbacks` 工厂 |
| `wink-micro-os/samples/devkitc_smoke/CMakeLists.txt` | ✏️ 修改 | 接入 codegen：build 阶段调 `app_codegen.py`，把生成文件加入 target |
| `docs/design/03-app-codegen/01-app-business-logic.md` | ✏️ 修改 | Layer ① 活文档：补 codegen 契约（SSOT 更新） |

#### P2 阶段（CMake 静态裁剪，2 天）

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `wink-micro-os/dal/CMakeLists.txt` | ✏️ 修改 | 按 `WINK_USE_XXX` option 条件加入源文件 |
| `wink-micro-os/dal/include/dal_*.h`（所有驱动公共头） | ✏️ 修改 | 每个驱动加一个 `#ifndef WINK_USE_XXX` 分支下的 `__attribute__((unavailable(...)))` 声明 |
| `tools/codegen/gen_driver_options.py` | 🆕 新增 | 扫描 drivers 插件目录自动生成 CMake option 列表 + 头文件 unavailable 片段，避免手工漂移 |
| `wink-micro-os/test/test_cmake_pruning.c` | 🆕 新增 | 编译期测试：关掉某驱动后 `#include` 其头文件并调用 API，验证触发 unavailable |

#### P3 阶段（BAL 目录正规化 + Future Work 占位，1 天）

| 文件路径 | 变更类型 | 说明 |
|---|---|---|
| `wink-micro-os/samples/common/` → `wink-micro-os/bal/` | 📂 重命名 | 仅当累计组件数 ≥5 时执行；预计在本计划完成后自然达到 |
| `docs/tech-designs/tools/app-layer-lowcode-unification-design.md` §9 Future Work | ✏️ 补 ADR 占位 | 为 event queue / mbox 立项 ADR 编号，但不实现 |

### 3.2 接口影响分析

| 接口层 | 是否破坏性变更 | 影响范围 | 缓解措施 |
|---|---|---|---|
| **DAL 公共 API** | ⚠️ 小 | 可能新增 `dal_button_deinit()`（对称 API）；现有 init/其他 API 签名不变 | 先 Grep 全局是否已有 deinit；若无则新增，有则复用 |
| **BAL helper API** | ⚠️ 是 | `wink_led_blink_start/stop` 去掉 `warn_unused_result`；返回值从"必须处理"变为"可忽略" | 两 API 目前调用方都在 samples/ 下，全局 Grep 确认调用点 ≤5 个，逐一 review |
| **App 回调契约 (`wink_app_callbacks_t`)** | ❌ 否 | 签名完全不变；on_boot 等可选字段继续保留 | — |
| **Actuator registry** | ❌ 否 | 仅改变"谁注册"的位置（从 app_init → device_tree/codegen），API 不变 | — |
| **构建系统** | ✏️ 新增 codegen 阶段 | samples/ 目录下接入 codegen 的 target 多一个预处理步骤 | 用 CMake `add_custom_command`，生成文件放 `build/generated/`，不污染源树 |

### 3.3 架构红线（Tech-Design 强约束回顾）

1. **严禁给 DAL 设备 POD 结构体加任何函数指针字段**（ADR-0004 静态分发）。
2. **严禁在 DAL `init()` 内部做 `wink_actuator_register` 自动注册**——注册归 codegen/device_tree 层统一管理。
3. **严禁在 `wink_button_helper` 的 soft_timer 回调里调用可能 yield/block 的 API**——头文件必须用 `@warning` 红色标注上下文限制。
4. **严禁通过"一刀切取消 warn_unused_result"掩盖服务启动类 API 的失败**——必须按 §6.1 三级分级。
5. **严禁 big-bang 切换**——每个阶段独立 PR、独立验证、可回滚。
6. **零 malloc 约束**：device_tree 静态实例、button_helper 静态数组、codegen 生成全部静态内存；运行期零动态分配。

---

## 4. 分阶段任务拆解

### Phase P0：手工收拢 + BAL API 分级（~1 天）

**目标**：不动 codegen、不动 CMake，纯手工把样板从 `app_callbacks.c` 推到 `device_tree.c`，把 BAL fire-and-forget API 降噪。这一阶段不依赖任何新机制，纯粹是现有代码的整理，风险最低、立即可做。

#### Task P0-1：扩展 device_tree 承担 init/register/deinit（2h）

- [x] **Step 1**：扩展 `device_tree.h`，声明 `wink_device_tree_init()/deinit()`；保留 `extern dal_xxx_t` 实例导出；把 `BOARD_LED_PIN`/`BOARD_BUTTON_PIN` 宏从 .h 移到 .c（不对外泄漏）。
- [x] **Step 2**：把 `app_callbacks.c` 中以下内容搬到 `device_tree.c`：
  - LED config 字面量 + `dal_led_init` + board_led_safe_off thunk + `wink_actuator_register`
  - Button config 字面量 + `dal_button_init` + `dal_button_set_long_press_ms` + `dal_button_enable_isr_counter`
  - Ultrasonic config 字面量 + `dal_ultrasonic_init`（`s_sonar` 是 app 业务状态，留在 app_callbacks.c）
- [x] **Step 3**：实现 **Actuator 反注册机制** 与 `wink_device_tree_deinit()`：
  - 在 `wink_actuator_registry.h` 与 `.c` 中实现 `wink_status_t wink_actuator_unregister(wink_actuator_safe_off_fn fn, void *ctx)`，当反注册时，从静态数组中移出对应槽并左移元素，以保证运行期析构对称性。
  - 在 `device_tree.c` 中编写 `wink_device_tree_deinit()`，按 init 反序 deinit（led ← button ← sonar），先 unregister actuator 再 deinit 设备。
- [x] **Step 4**：`app_init` 改为第一行 `WINK_CHECK(wink_device_tree_init(), WINK_FAULT_APP(0));`，删除分散的 init/thunk/register 调用。
- [x] **验收**：host 编译 0 warn 0 error；跑 devkitc_smoke host 单测 S1-S10 全 PASS；Actuator 单测中新增反注册成功与隔离验证。

#### Task P0-2：BAL API 错误处理分级（1h）

- [x] **Step 1**：`wink_blink_helper.h` 中 `wink_led_blink_start/stop` 去掉 `WINK_WARN_UNUSED_RESULT`；
- [x] **Step 2**：`wink_blink_helper.c` 内部失败改 `LOG_D("blink_start failed: %d", status)` 自记日志，返回正常 status 但上层不必处理；
- [x] **Step 3**：`wink_default_telemetry.h`、`wink_sim_ultrasonic_echo.h` 保持 `WINK_WARN_UNUSED_RESULT`（Normal 级）；
- [x] **Step 4**：删除 `app_callbacks.c` 中 `WINK_IGNORE_RESULT(wink_led_blink_start(...))` 的外层宏包裹，保留裸调用。
- [x] **验收**：host build 0 warn；ESP32 build 0 warn 0 error；代码读起来无 `WINK_IGNORE_RESULT` 噪音在 blink 调用处。

#### Task P0-3：三 target 回归（1h）

- [x] Host：`python wink-tools/wink.py test` 全 PASS；
- [x] WASM：`idf.py --preview set-target wasm` 或等效 wasm 构建流程 0 warn 0 error，浏览器仿真 S1-S10 全 PASS；
- [x] ESP32：`idf.py -C wink-micro-os/samples/devkitc_smoke build flash monitor`，S1-S10 全 PASS，WDT 复位测试 OK；
- [x] **Commit**：按 CLAUDE.md 原子提交规范，拆为 `refactor(samples/devkitc_smoke): centralize init/register into device_tree` 和 `refactor(samples/common): classify BAL API error-handling levels` 两个 commit。

**P0 出口检查**：`app_callbacks.c` 行数从 149 降至 ~80 行；所有引脚号、thunk 宏、WINK_IGNORE_RESULT 在 blink 处全部消失。

---

### Phase P1：Codegen v1 + button_helper（4-5 天）

#### Task P1-1：Codegen 基础设施（1 天）

- [x] **Step 1**：选模板引擎——推荐 **Jinja2**（Python 生态成熟，和 ESP-IDF 代码生成、Kconfig、dts 生态一致；不引入额外依赖，ESP-IDF 已自带）；
- [x] **Step 2**：写 `tools/codegen/app_codegen.py` 主框架：
  - argparse：`--config wink-app.json --out-dir build/generated/`
  - 读 JSON → 校验 schema（用轻量手写校验，暂不引入 pydantic）→ 加载 drivers/ 插件 → 渲染模板；
  - **依赖拓扑排序与校验**：解析设备时，静态分析其总线/配置依赖（如 I2C/SPI 等），执行拓扑排序（Topological Sort），以确定安全的 `wink_device_tree_init()` 顺序（总线类外设优先），并对非法/循环/缺失的依赖进行静态校验；
  - 命令行返回码：校验失败返回非 0，给出类似"device 'foo_led' has unknown type 'ledd'（did you mean 'led'?）"的友好错误；
- [x] **Step 3**：Driver 插件接口定义：
  ```python
  # drivers/base.py
  class DriverBase:
      type: str                     # "led" / "button" / "ultrasonic"
      is_actuator: bool = False     # 是否要生成 safe-off thunk
      required_fields: list[str]    # JSON 中必填字段，如 ["pin"]
      def get_headers(self) -> list[str]: ...     # 返回需要的头文件列表，如 ["dal_led.h"]
      def get_device_type(self) -> str: ...       # 返回对应的 C 类型名，如 "dal_led_t"
      def render_config_init(self, dev_name: str, spec: dict) -> str: ... # 返回配置字面量 + dal_xxx_init 调用段
      def render_deinit(self, dev_name: str) -> str: ...                 # 返回 dal_xxx_deinit 调用段
  ```
- [x] **Step 4**：写 Jinja2 模板四个（device_tree.h/c、app_support.c、app_options.cmake），模板内用 `{#- ... -#}` 控制空白，生成代码可读、可直接 GDB 调试；
- [x] **Step 5**：金标准测试：`tools/codegen/tests/golden_devkitc.json` → 生成，和 `tools/codegen/tests/golden_expected/` 下的预期输出做 diff；测试加入 host CI。
- [x] **验收**：金标准 diff 测试通过；驱动插件接口能用单个 driver 跑通端到端；拓扑排序能够正确排序总线-外设依赖。

#### Task P1-2：三个驱动插件（1 天）

- [x] **Step 1**：`drivers/led.py`：生成 config 字面量（owner/pin/active_high）、`dal_led_init` 调用、safe-off thunk（`is_actuator=True`）、`dal_led_deinit` 反注册+deinit；
- [x] **Step 2**：`drivers/button.py`：生成 config（owner/pin/active_low）+ `dal_button_init` + 可选的 `set_long_press_ms` + `enable_isr_counter` + auto_poll 时调 `wink_button_helper_start`；非 actuator；
- [x] **Step 3**：`drivers/ultrasonic.py`：生成 config（owner/trig_pin/echo_pin/use_rmt）+ `dal_ultrasonic_init` + 可选的 sim_echo 服务接入；非 actuator；
- [x] **Step 4**：写 `wink-app.json` schema 文档（放 `docs/design/03-app-codegen/` 下），字段、类型、默认值全列清楚；
- [x] **验收**：金标准测试扩展到三个驱动都覆盖；生成代码能通过 gcc -fsyntax-only。

#### Task P1-3：`wink_button_helper` BAL 组件（1 天）

- [x] **Step 1**：确认 `dal_button` 已有 `dal_button_deinit()`，没有就补（对称 API）；
- [x] **Step 2**：实现 `wink_button_helper_start/stop`：
  - **按需分配静态槽**：在 `app_support.c` 中，由 codegen 扫描 JSON 得到需要 auto_poll 的 button 数量 $N$，动态生成 `#define WINK_BUTTON_HELPER_MAX N`。Helper 内部静态实例表大小对齐该宏，消除多余的静态内存开销；
  - `start` 时分配 slot，起 soft_timer：`pal_os_soft_timer_create(poll_ms, button_helper_poll_cb, btn)`；
  - `stop` 时 cancel timer 并释放 slot；
  - 重复 start 同 button 实例返回 `WINK_ERR_INVALID_STATE`；
- [x] **Step 3**：三 target 适配：
  - host/wasm：soft_timer 走 pal 通用实现；
  - esp32：确认 soft_timer 回调在 FreeRTOS timer task 上下文，文档标注该上下文约束；
- [x] **Step 4**：头文件 doxygen 用 `@warning` 红色标注 ISR-like 上下文限制（§7.2 文案）；
- [x] **Step 5**：写 host 单测 `test_button_helper.c`：
  - 正常短按/长按检测；
  - 重复 start 返回 INVALID_STATE；
  - stop 后不再回调；
  - **虚拟时间仿真推进**：单测中严禁使用真实 `sleep()` 延时等待，统一通过 `extern void host_sim_advance_to(uint64_t us)` 快速推演虚拟时间流逝，确保 CI 执行速度；
  - **定时器回调上下文安全监视**：在定时器回调中，加入时间片统计与 `WINK_ASSERT_NONBLOCKING()`。在 host 侧（或真机 debug 下）当发现回调函数执行耗时超过 100μs 时，记录 `LOG_W` 警告以协助暴露 AI 或开发者编写的阻塞代码；
- [x] **验收**：host 单测全 PASS；ESP32 上手按 BOOT 键验证短按/长按；在 Host 单测中模拟耗时回调，验证能够正确触发 warn 警告。

#### Task P1-4：CMake 接入 + devkitc_smoke 全迁移（1 天）

- [x] **Step 1**：修改 `samples/devkitc_smoke/CMakeLists.txt`：
  - `add_custom_command` 调用 `app_codegen.py`，必须使用 `${PYTHON_EXECUTABLE}` 执行 Python 脚本以复用 ESP-IDF 已激活的 Python 虚拟环境依赖，且必须声明 `DEPENDS wink-app.json`，产出 `build/generated/device_tree.c/h`、`app_support.c`；
  - **增量构建依赖追踪**：在 `CMakeLists.txt` 中配置 `set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "wink-app.json")`，使 JSON 的修改能自动触发 CMake configure 阶段；
  - `target_include_directories(... PRIVATE ${CMAKE_BINARY_DIR}/generated)`；
  - 把生成的 .c 加进 target_sources；
- [x] **Step 2**：把 P0 阶段手工写的 `device_tree.c` 删/改为从模板生成（保留手写版作备份对比 1 轮，稳定后删）；
- [x] **Step 3**：`app_callbacks.c` 精简到只剩：`#include "device_tree.h"` + 业务回调（`on_boot_button`, `app_on_boot`, `app_on_fault`）+ `wink_app_get_callbacks` 工厂；`app_loop` 留空（因 button_helper 已接管 poll）；
- [x] **Step 4**：`wink-app.json` 里加 `"auto_poll_ms": 10` 触发 codegen 生成 button_helper_start 调用；
- [x] **验收**：全手工清掉后三 target 构建，S1-S10 全 PASS；此时 `app_callbacks.c` 目标 ~50-60 行（纯业务逻辑）；修改 `wink-app.json` 引脚，执行编译验证能够自动触发 codegen 并编译最新生成的 C 文件。

#### Task P1-5：文档回写 + P1 回归（0.5-1 天）

- [x] **Step 1**：更新 Layer ① 活文档 `03-app-codegen/01-app-business-logic.md`：加入 codegen 入口、wink-app.json schema、device_tree 生命周期契约、button_helper 上下文约束；
- [x] **Step 2**：在 tech-design 文档中把 status 从 "Design in Progress" 改为 "Implemented (P1)"；
- [x] **Step 3**：三 target 全回归 + 写 review 记录 `docs/tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md`；
- [x] **Commit**：按原子提交规范拆 5-7 个 commit（codegen 基础、每个 driver 插件、button_helper、cmake 接入、sample 迁移、文档）。

**P1 出口检查**：`app_callbacks.c` 只剩手写业务回调；改一个设备的引脚只需改 `wink-app.json` 一行，重新构建自动生效；AI/UI 工具只需输出 JSON 即可生成完整 sample。

---

### Phase P2：CMake 静态裁剪（2 天）

#### Task P2-1：DAL CMake option 化（1 天）

- [x] **Step 1**：枚举当前 DAL 驱动清单（`wink-micro-os/dal/src/**/*.c`），给每个驱动分配一个 option 名（`WINK_USE_LED`、`WINK_USE_BUTTON`、...）；
- [x] **Step 2**：写 `tools/codegen/gen_driver_options.py`——扫描 `tools/codegen/drivers/*.py` 自动生成：
  - `dal/CMakeLists.txt` 中的条件块；
  - 每个驱动头文件中的 `WINK_UNAVAILABLE_MSG(...)` 桩声明片段；
- [x] **Step 3**：修改 `dal/CMakeLists.txt` 使用 option 条件 add_library source；
- [x] **Step 4**：每个驱动公共头末尾加：
  ```c
  #if !defined(WINK_USE_LED) || !WINK_USE_LED
  /* 当 WINK_USE_LED=OFF 时提供友好的编译期错误，避免晦涩的 undefined reference */
  wink_status_t dal_led_init(dal_led_t *, const dal_led_config_t *)
      WINK_UNAVAILABLE_MSG("LED driver not enabled; add a led device to wink-app.json");
  /* ... 其他 API 同类处理 ... */
  #endif
  ```
  同时在 `wink_status.h` 中添加 `WINK_UNAVAILABLE_MSG(msg)` 编译器适配宏定义；
- [x] **验收**：默认所有 option 为 ON（向后兼容）；手动关掉 `WINK_USE_SERVO` 后，调用 `dal_servo_init` 的代码编译期报错，错误信息包含修复指引。

#### Task P2-2：codegen 生成 app_options.cmake（0.5 天）

- [x] **Step 1**：渲染 `app_options.cmake.j2` 模板，codegen 扫描 JSON 中用到的设备类型，对应 `set(WINK_USE_XXX ON CACHE BOOL "" FORCE)`；
- [x] **Step 2**：未用到的设备类型不 set（保持默认 OFF 或 ON 由顶层 CMake 默认值决定）；
- [x] **Step 3**：在 sample 的 CMakeLists.txt 中 `include()` 生成的 `app_options.cmake` 后再 `add_subdirectory(dal)`，保证 option 生效；
- [x] **验收**：JSON 只写 led+button 时，构建产物 map 文件中无 `dal_servo`、`dal_oled` 等符号；CI 构建时间（host 侧）对比 P1 基线下降 ≥15%。

#### Task P2-3：P2 回归（0.5 天）

- [x] 跑关闭特定驱动的负向测试（test_cmake_pruning）；
- [x] 三 target 全回归；
- [x] 写 P2 review 记录。

**P2 出口检查**：构建系统具备"按需裁剪驱动"能力；错误提示友好；构建时间可观测下降。

---

### Phase P3：BAL 目录正规化 + Future Work 占位（1 天）

#### Task P3-1：评估 BAL 组件数，触发条件成熟则迁目录

- [x] **Step 1**：统计 BAL 组件数：blink_helper / default_telemetry / sim_ultrasonic_echo / button_helper = 4 个；
- [x] **Step 2**：若 P2 收尾时已新增 1+ 个 BAL 组件（如 motor_helper、buzzer_helper），凑齐 ≥5 则执行目录迁移；否则仅在 Future Work 占位，暂不搬；
- [x] **Step 3**：迁移时 CMake include 路径全量更新；旧路径加 `#warning "header moved to bal/"` 过渡一个版本再删除；
- [x] **验收**：include 路径一致；构建 0 warn 0 error。

#### Task P3-2：Future Work ADR 占位

- [x] 立 ADR-0019 占位（Event queue / mbox 异步原语）；状态为 Proposed；
- [x] 明确写出"P 系列不实现；App 层仍保留 app_loop 心跳契约"；
- [x] 为 board 预设层、PT 状态自动布局、config lint、wasm 热重载分别建立跟踪 issue/待立项项（不入本次计划）。

---

## 5. 验证矩阵（汇总）

| 验证点 | Host | WASM | ESP32 | 阶段 |
|---|---|---|---|---|
| `wink_device_tree_init()` 成功路径 | ✅ 手工验证 | ✅ | ✅ devkitc smoke | P0 |
| `wink_device_tree_deinit()` 对称反注册 | ✅ 单测：spy actuator_unregister 调用 | ⚪ | ⚪ | P1 |
| BAL API 分级：fire-and-forget 不强制接返回值 | ✅ `-Werror=unused-result` 编译 | ✅ | ✅ | P0 |
| BAL API 分级：Normal/Fatal 保留 warn_unused_result | ✅ 同上 | ✅ | ✅ | P0 |
| codegen 金标准 diff 测试 | ✅ Python 单测 | ⚪ | ⚪ | P1 |
| codegen schema 错误友好提示 | ✅ Python 单测 | ⚪ | ⚪ | P1 |
| wink_button_helper 短按/长按/连发 | ✅ Unity + mock 时钟 | ✅ 仿真交互 | ✅ 手按 | P1 |
| wink_button_helper 重复 start 拒绝 | ✅ 单测 | ⚪ | ⚪ | P1 |
| button_helper 回调上下文阻塞检测 | ✅ host 侧 runtime 检测 hook | ⚪ | ⚪ | P1 |
| CMake option 裁剪后 unavailable 友好报错 | ✅ 编译期负向测试 | ⚪ | ⚪ | P2 |
| CMake 裁剪后二进制体积（符号表验证） | ✅ nm 检查 | ✅ | ✅ | P2 |
| devkitc_smoke S1-S10 全 PASS（每阶段回归） | ✅ python wink-tools/wink.py test | ✅ 仿真 | ✅ 烧录 monitor | P0/P1/P2 各跑一次 |
| ESP32 build 0 warn 0 error | ⚪ | ⚪ | ✅ | P0/P1/P2 |
| AI 友好度：只写 JSON 能跑通 blink 样例 | ✅ 手工模拟 AI 输出 | ✅ | ✅ | P1 |

---

## 6. 风险登记与应对

| 风险 | 概率 | 影响 | 缓解策略 |
|---|---|---|---|
| Jinja2 未在 ESP-IDF 环境中默认安装，CI 上跑不了 codegen | 中 | 高 | codegen 启动前检测 Jinja2；CI 镜像 `pip install jinja2`；或准备一个无依赖的极简模板回退（string.Template），但首选 Jinja2 |
| button_helper 在 ESP32 上 soft_timer 回调上下文和 host 不一致，导致 ISR-like 约束在真机上不成立 | 中 | 中 | P1-3 Step 3 阶段在真机上做 ISR 上下文判定实验：在回调里读 xPortInIsrContext() 验证；若不在 ISR 上下文（在 timer task），文档相应修正措辞为"禁止阻塞/禁止 yield"即可，不一定是硬 ISR |
| codegen 生成的 deinit/反注册顺序错，导致 fault 时执行器没按正确顺序 safe-off | 低 | 高 | P1-2 金标准测试显式断言"多执行器场景下注册顺序与 deinit 顺序"；真机 fault 注入测试（短接 fault 引脚）观察执行器状态 |
| CMake `__attribute__((unavailable))` 在 MSVC/某些 GCC 版本不支持 | 低 | 低 | 统一 wrapped 到 `WINK_UNAVAILABLE(msg)` 宏；在不支持的编译器上 fallback 为 `#error` 预处理错误 |
| 大 PR 难 review，合入时冲突多 | 中 | 高 | 严格按 Task 边界拆 commit；每完成一个 Task 就 push 一个独立 PR；P0 先合入不阻塞主线，P1/P2 用 feature 分支 |
| BAL 组件数未达阈值就被强行迁目录，造成 churn | 低 | 低 | P3-1 设置硬阈值 ≥5；不满足就只占位不搬 |
| 生成的代码可读性差，用户/AI debug 时看不懂 | 中 | 中 | 模板里强制用 `{#- -#}` 控空白；每个生成块加注释 `/* Codegen from wink-app.json: devices.board_led */`；生成文件放 `build/generated/` 但加入 IDE 索引 |

---

## 7. 时间线（建议节奏）

| 日期 | 里程碑 |
|---|---|
| Day 1（07-06） | P0 收尾 + commit；devkitc_smoke 降至 ~80 行；三 target 回归 |
| Day 2-3（07-07 ~ 07-08） | P1-1 codegen 基础 + P1-2 三个驱动插件；金标准测试通过 |
| Day 4（07-09） | P1-3 button_helper + 单测 |
| Day 5（07-10） | P1-4 CMake 接入 + devkitc_smoke 全迁移；P1-5 文档回写 + P1 review |
| Day 6-7（07-11 ~ 07-12） | P2 CMake 静态裁剪；P2 回归 + review |
| Day 8（07-13） | P3 BAL 目录评估 + ADR 占位；整轮收口 |

如中途遇到阻塞（如 ESP32 soft_timer 上下文判定实验发现意外问题），按 [[embedded-debugging-rhythm]] 先补诊断再推进，不赶工跳步。

---

## 8. 不在本次计划范围内的事项（明确排除）

为避免 scope creep，以下事项**明确不做**：

1. Event queue / mbox 异步原语的实现（需独立 ADR，可能 ADR-0019）；
2. app_loop 强制留空的硬性规定（保留为业务扩展点）；
3. BAL 目录强制迁移（等组件数自然达标）；
4. PT 线程状态自动布局 / wasm 快照可视化（留待 Wave 2/3 codegen）；
5. board 预设层（`boards/<board>.json`）；
6. 把所有现有 samples（避障车、智能家居 demo 等）立即迁移到 codegen——仅用 devkitc_smoke 作为首个样板验证，其他 sample 在后续迭代逐步迁移；
7. 引入 pydantic 等重量级 schema 校验库（codegen 手写校验足够，依赖要克制）。

---

## 9. 与既有计划/工件的关系

| 关联项 | 关系 |
|---|---|
| [2026-07-04 综合加固计划](../core/2026-07-04-wmos-comprehensive-hardening-plan.md) | 本计划 P0 是综合加固"APP 层样板精简"目标的具体落地；P1/P2 超出去年 Q3 加固范围，属于低代码方向的向前推进 |
| [2026-07-05 分级日志加固](../core/2026-07-05-wmos-hierarchical-logging-hardening-plan.md) | P0 BAL 分级错误处理依赖分级日志的 `LOG_D` 自记机制；两者完成顺序可并行但 P0-2 需在日志加固合入后再收尾（取 fire-and-forget 用 LOG_D 打印） |
| `wink_selftest` (Wave 6) | P1 完成后 selftest 本身也可改为 codegen 生成（但不在本次计划范围） |
| ADR-0013/0014 协作调度器 | button_helper 依赖 soft_timer 原语，协作调度模型下 soft_timer 回调契约已经 ADR 固化，直接复用 |
| [Smoke 测试显式 PASS/FAIL 约定](../memory/smoke-test-explicit-pass-fail.md) | S1-S10 作为每阶段回归的硬门槛，遵守显式 PASS/FAIL 行约定 |

---

## 10. 执行准备 Checklist

- [x] Tech-design 评审通过（Embedded Best Practice 流程）；
- [x] 本计划评审通过；
- [x] ESP-IDF v6.0.1 环境可用（`idf.py --version` 输出 6.0.1）；
- [x] Python ≥3.8 可用（Jinja2 安装 `pip install jinja2`）；
- [x] Host GCC 工具链在 PATH（`gcc --version` 可用，WinLibs winget 安装）；
- [x] DevKitC 开发板可连接烧录；
- [x] 当前分支基于 `fix/devkitc-smoke-runtime-bugs` 最新 `master` 合并点。

准备就绪后按 §7 时间线启动，每个 Task 收尾时打 `[P1-3 done]` 标记并三 target 回归后再推进下一个 Task。

---

*本计划状态变更请在下方记录：*
- 2026-07-05：初稿，待评审
- 2026-07-06：完成 P0 + P1 阶段并通过评审，见 [app-layer-lowcode-p1-review.md](../../reviews/core/2026-07-06-app-layer-lowcode-p1-review.md)
- 2026-07-06：完成 P2 阶段并通过评审，见 [app-layer-lowcode-p2-review.md](../../reviews/core/2026-07-06-app-layer-lowcode-p2-review.md)
- 2026-07-06：完成 P3 阶段 BAL 目录正规化及 ADR-0022 占位，实施计划整体完成

