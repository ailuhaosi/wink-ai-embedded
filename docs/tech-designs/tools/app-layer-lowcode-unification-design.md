# App 层低代码统一架构（Low-Code Unification）技术设计规格

| 项 | 内容 |
|---|---|
| **文档版本** | v1.0 |
| **设计日期** | 2026-07-05 |
| **架构师** | Wink-AI 嵌入式团队 + Claude Code 评审 |
| **前置评审** | 基于 Antigravity/Gemini 草案的专家评审（见 §1.2 评审结论） |
| **状态** | **Implemented (P2)** — P0+P1+P2 已落地（codegen 框架 + 三个驱动插件 + button_helper + devkitc_smoke 全迁移 + CMake 静态裁剪 + WINK_UNAVAILABLE_MSG 友好报错）；P3（BAL 目录正规化）因组件数未达阈值暂不迁移，ADR-0022 占位 event queue |
| **关联 ADR** | ADR-0001（负错误码）、ADR-0002（双 target 同源编译）、ADR-0004（静态分发，无 vtable）、ADR-0012（契约诚实）、ADR-0013/0014（协作式确定性调度器）、ADR-0018（IRQ 三级收窄） |
| **关联设计规范** | [02-wink-micro-os/03-directory-architecture.md](../../design/02-wink-micro-os/03-directory-architecture.md)、[03-app-codegen/01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md) |
| **关联实施计划** | [implementation-plans/2026-07-05-app-layer-lowcode-unification-plan.md](../../implementation-plans/tools/2026-07-05-app-layer-lowcode-unification-plan.md) |

---

## 1. 背景与动机

### 1.1 当前痛点

以 `samples/devkitc_smoke/app_callbacks.c`（149 行，已是 Wave 6 精简后版本）为观察对象，App 层仍存在三类**视觉/心智噪音**：

1. **样板冗余**：每个执行器都需要 3 行固定仪式——config 结构体字面量 → `dal_xxx_init` + `WINK_CHECK` → `WINK_DEFINE_ACTUATOR_THUNK` + `wink_actuator_register`。
2. **返回值宏污染**：`WINK_IGNORE_RESULT(...)` 在非关键 API 调用中频繁出现，掩盖了真正需要检查错误的位置。
3. **手动轮询义务**：`app_loop()` 必须显式 `dal_button_poll()`，否则按键不响应——这违反了协作式调度器 "loop 是用户业务心跳" 的初衷。

这些噪音对手写代码只是"略烦"，但对 **AI 代码生成** 是显著的错误源：AI 可能漏掉 thunk、可能搞错 WINK_CHECK/WINK_IGNORE_RESULT 分级、可能忘记 poll 一个新加的传感器。低代码平台的目标是让 AI 输出声明式配置（JSON/YAML），而非过程式 C 代码。

### 1.2 外部草案评审结论

本次设计以 Antigravity/Gemini 团队产出的两份草案为起点：

- `devkit_architecture_analysis.md` — 现状观察与问题识别
- `wink_micro_os_unified_architecture_scheme.md` — 融合重构方案

评审结果：**大方向正确（声明式配置 + codegen + 分层减负），但三个核心"减负"措施都存在架构隐患**：

| 草案建议 | 评审结论 | 主要问题 |
|---|---|---|
| DAL `init()` 内自动 `actuator_register` | ❌ 否决 | 破坏 init/deinit 对称性；安全关停顺序变成 init 调用序，失去业务控制；违反 ADR-0004 静态分发（草案建议加 `safe_off` vtable 指针）；把"是否执行器"这一业务分类泄漏到驱动层 |
| BAL helper API 一刀切取消 `warn_unused_result` | ⚠️ 部分采纳 | 按 API 语义分级而非一刀切；fire-and-forget 类去强校验，服务启动/配置类保留 |
| Runtime 内部微任务自动 poll 按键 | ❌ 本次不动 | ADR-0013/0014 协作式调度下三种实现方式都有显著代价（soft_timer 回调走 ISR 上下文、独立 task 引入延迟抖动、GPIO 中断需 event queue 新原语），需单独 ADR；改走 BAL helper 封装软定时 poll 作为可选入口 |

**核心原则**：复杂度的正确"下沉"目的地是 **codegen（代码生成器）**，不是 DAL/Runtime 框架。生成器对每个应用是具体的、可溯源的、可调试的；框架对所有应用通用，一旦藏污纳垢全平台受难。

### 1.3 设计目标

1. **App 层 100% 硬件解耦**：用户/AI 业务代码不出现引脚号、通道号、极性常量、thunk 宏、`WINK_IGNORE_RESULT` 样板。
2. **声明式配置驱动**：单一 `wink-app.json` 描述设备实例、业务状态变量、回调绑定；codegen 产出所有 glue code。
3. **契约诚实**：不引入隐式框架行为破坏 init/deinit 对称；不通过取消错误检查掩盖失败。
4. **ADR 合规**：严格对齐 ADR-0004（静态分发、无 vtable）、ADR-0013/0014（协作调度）、ADR-0018（IRQ 三级）。
5. **双 target 同源**：任何新增抽象必须同时在 host/wasm/esp32 三 target 落地；ESP32 构建 0 warn 0 error，host 单测 100% 通过。
6. **小步提交**：每个重构阶段独立可回滚、可验证；不做 big-bang 切换。

### 1.4 非目标（明确不做）

- **不** 引入事件队列 / mbox 等 OS 新原语（留待独立 ADR，见 §9 Future Work）。
- **不** 给 DAL 设备结构体加任何函数指针字段（守住 ADR-0004）。
- **不** 强制所有现有 sample 立即迁移；提供新旧共存路径。
- **不** 在本次重构中解决 BAL 目录正规化（`samples/common` → `bal/`）问题——等积累到足够组件数再做目录迁移。

---

## 2. 架构总览

### 2.1 分层图（重构后）

```
┌─────────────────────────────────────────────────────────────────┐
│  App 业务层（手写/AI 生成）                                        │
│  - 业务状态机 / 协程 PT_THREADs                                    │
│  - 事件回调（on_button, on_sonar_ready, ...）                     │
│  - 仅依赖 DAL 公共面 + BAL helpers + wink_runtime                │
│  - 零引脚、零 thunk、零显式 WINK_IGNORE_RESULT 样板              │
├─────────────────────────────────────────────────────────────────┤
│  BAL 业务助手层（平台无关静态库）                                  │
│  - control/  : wink_pid_helper, wink_filter_helper (future)      │
│  - services/ : wink_blink_helper, wink_default_telemetry,        │
│                wink_button_helper (新增，可选软定时 poll)         │
│  - sim/      : wink_sim_ultrasonic_echo                          │
│  - 按 API 语义分级错误处理（§6）                                  │
├─────────────────────────────────────────────────────────────────┤
│  Codegen 生成层（每个 app 专属，构建期产出）                       │
│  - device_tree.c/h : 静态实例、config 字面量、init 序列、         │
│                      actuator 注册（正确顺序）                    │
│  - app_support.c   : 状态变量/PT 空间、WINK_IGNORE_RESULT 包裹   │
│  - app_options.cmake: WINK_USE_XXX 编译开关                      │
├─────────────────────────────────────────────────────────────────┤
│  DAL 器件驱动层（静态分发 POD，无 vtable）                         │
│  - 保持现状；init/deinit 对称；不内置自动注册                     │
│  - 内部头文件可加 weak hook（供 codegen 生成的 thunk 链接）       │
├─────────────────────────────────────────────────────────────────┤
│  wink_runtime / wink_trace                                       │
├─────────────────────────────────────────────────────────────────┤
│  PAL (OSAL/HAL) ─── targets/ (host/wasm/esp32)                   │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 数据流

```
wink-app.json (用户/UI/AI 编辑)
     │
     ▼
app_codegen.py (构建期运行)
     │
     ├──► build/generated/device_tree.c/h
     ├──► build/generated/app_support.c
     └──► build/generated/app_options.cmake
                │
                ▼
           CMake 配置 → 选源 → 静态链接
                │
                ▼
           三 target 可执行产物
```

---

## 3. Codegen 入口：`wink-app.json` Schema

### 3.1 最小示例（devkitc_smoke 重构后）

```json
{
  "app_name": "devkitc_smoke",
  "board": "esp32_devkitc",
  "devices": {
    "board_led":   { "type": "led",      "pin": 2,  "active_high": true,  "actuator": true },
    "boot_button": { "type": "button",   "pin": 0,  "active_low": true,
                     "long_press_ms": 3000, "isr_counter": true,
                     "auto_poll_ms": 10 },
    "smoke_sonar": { "type": "ultrasonic", "trig_pin": 18, "echo_pin": 19,
                     "use_rmt": true }
  },
  "services": {
    "status_blink":  { "type": "blink",       "device": "board_led",  "period_ms": 1000 },
    "telemetry":     { "type": "telemetry",   "sonar": "smoke_sonar", "button": "boot_button" },
    "sonar_echo_sim":{ "type": "sonar_sim",   "device": "smoke_sonar",
                       "distance_cm": 50.0,   "period_ms": 500 }
  },
  "callbacks": {
    "on_boot":   "app_on_boot",
    "on_fault":  "app_on_fault",
    "button_on_event": { "device": "boot_button", "handler": "on_boot_button" }
  },
  "state_variables": []
}
```

### 3.2 Schema 要点

| 字段 | 类型 | 说明 |
|---|---|---|
| `app_name` | string | 构建产物名，对应 CMake target |
| `board` | string | 板级预设（引用 `boards/<board>.json` 提供默认引脚，可被 devices 覆盖） |
| `devices` | map<name, DeviceSpec> | 设备实例；`type` 决定使用哪个 DAL 驱动；`actuator: true` 标记需要 safe-off 注册的执行器 |
| `services` | map<name, ServiceSpec> | BAL 服务实例，type 对应注册的 helper 工厂 |
| `callbacks` | object | 业务回调绑定；codegen 只生成"绑"的代码，回调本体由用户手写 |
| `state_variables` | list<StateVar> | 状态变量/PT 空间预留（Wave 2 及之后，本次先输出空结构体） |

### 3.3 多设备类型扩展点

codegen 通过 driver registry（`tools/codegen/drivers/<type>.py`）插件化扩展新设备类型——添加新 DAL 器件时只需增加一个 driver 插件，不动 codegen 主程序。

---

## 4. Codegen 输出 1：`device_tree.c/h`

### 4.1 `device_tree.h`（声明）

```c
#ifndef DEVICE_TREE_H
#define DEVICE_TREE_H

#include "dal_led.h"
#include "dal_button.h"
#include "dal_ultrasonic.h"

#ifdef __cplusplus
extern "C" {
#endif

/* ── 设备实例句柄（extern 可见，app 业务层通过名字访问）── */
extern dal_led_t         board_led;
extern dal_button_t      boot_button;
extern dal_ultrasonic_t  smoke_sonar;

/* ── 设备树生命周期（app_init 第一行调用）── */
wink_status_t wink_device_tree_init(void);
void          wink_device_tree_deinit(void);  /* 对称反注册 + deinit */

#ifdef __cplusplus
}
#endif
#endif /* DEVICE_TREE_H */
```

### 4.2 `device_tree.c`（实现）

核心改动：**init 序列 + actuator 注册全部下沉到 codegen 生成的集中函数**。

```c
#include "device_tree.h"
#include "wink_fault.h"
#include "wink_actuator_registry.h"

/* ── 1. 静态实例（零 malloc，符合 §6.1 静态内存约束）── */
dal_led_t         board_led   = {0};
dal_button_t      boot_button = {0};
dal_ultrasonic_t  smoke_sonar = {0};

/* ── 2. 执行器 safe-off thunk（由 codegen 按 devices 中 actuator:true 生成）── */
WINK_DEFINE_ACTUATOR_THUNK(board_led_safe_off, dal_led_off, dal_led_t)

/* ── 3. Init 序列：按 devices 声明顺序执行；actuator 按 REVERSE 顺序注册
 *    （fault 时先停"后初始化的"执行器，类似 C++ 析构序——先 init 的是基础设
 *     施如 LED，后 init 的是电机等危险执行器，fault 时优先停后者）。
 *    这里的顺序可以通过 devices 字段的顺序由用户/AI 控制。                 ── */
wink_status_t wink_device_tree_init(void)
{
    /* board_led (actuator) */
    static const dal_led_config_t board_led_cfg = {
        .owner = "board_led", .pin = 2, .active_high = true
    };
    WINK_CHECK_RET(dal_led_init(&board_led, &board_led_cfg));
    /* 注意：先全部 init 成功后再批量注册 actuator，避免 init 失败时
     * registry 里悬挂未完全初始化的设备 */

    /* boot_button (sensor, 非 actuator) */
    static const dal_button_config_t boot_button_cfg = {
        .owner = "boot_button", .pin = 0, .active_low = true
    };
    WINK_CHECK_RET(dal_button_init(&boot_button, &boot_button_cfg));
    WINK_CHECK_RET(dal_button_set_long_press_ms(&boot_button, 3000));
    WINK_CHECK_RET(dal_button_enable_isr_counter(&boot_button));

    /* smoke_sonar (sensor) */
    static const dal_ultrasonic_config_t smoke_sonar_cfg = {
        .owner = "smoke_sonar", .trig_pin = 18, .echo_pin = 19, .use_rmt = true
    };
    WINK_CHECK_RET(dal_ultrasonic_init(&smoke_sonar, &smoke_sonar_cfg));

    /* ── 所有设备 init 成功后，按反向顺序注册 actuator safe-off ── */
    /* （此例只有一个执行器；多执行器时从最后一个设备往前注册，
     *   fault 处理时 safe-off 按注册反序执行，即先停电机→再停 LED） */
    WINK_CHECK_RET(wink_actuator_register(board_led_safe_off, &board_led));

    return WINK_OK;
}

void wink_device_tree_deinit(void)
{
    /* 按 init 反序 deinit：unregister actuator → deinit 设备 */
    wink_actuator_unregister(board_led_safe_off, &board_led);
    dal_ultrasonic_deinit(&smoke_sonar);
    dal_button_deinit(&boot_button);
    dal_led_deinit(&board_led);
}
```

### 4.3 关键设计决策：为什么注册放在 device_tree 而不是 DAL init 内

| 维度 | DAL 内自动注册（草案方案） | device_tree 集中注册（本方案） |
|---|---|---|
| init/deinit 对称性 | ❌ deinit 需要反注册，但 init 失败 rollback 路径不清晰 | ✅ init/deinit 成对生成，rollback 清晰 |
| safe-off 顺序 | ❌ 按 init 调用序，用户无法控制 | ✅ 由 codegen 按设备声明反序，符合"C++ 析构序"直觉；用户可通过 JSON 顺序控制 |
| 静态分发（ADR-0004） | ❌ 需要给每个驱动加 `safe_off` 函数指针 | ✅ thunk 仍是编译期静态，无 vtable |
| 传感器/执行器分类 | ❌ 驱动层需要知道自己是不是 actuator（业务概念泄漏） | ✅ 分类在 JSON 的 `actuator: true` 字段，驱动保持单一职责 |
| 多板兼容 | ❌ DAL 自动注册无法按板级策略跳过某些执行器（比如开发板无电机） | ✅ codegen 读 JSON，未声明的设备不生成注册代码 |
| Debug 透明度 | ❌ 注册动作藏在驱动内部，故障现场难追 | ✅ 全部集中在 `wink_device_tree_init()` 一个函数，单步可追 |
| AI 友好度 | ❌ AI 仍需手写 init 调用；框架行为是隐式约束 | ✅ AI 写 JSON 即可，thunk 全部生成 |

### 4.4 Init 失败的 Rollback 契约

`wink_device_tree_init()` 中**前 N 个设备 init 成功、第 N+1 个失败**时：
1. 宏 `WINK_CHECK_RET` 直接返回错误码；
2. **已 init 的设备不主动 rollback**——这是嵌入式惯例（半初始化状态下 rollback 可能触发更多硬件未定义行为）；
3. Runtime 收到返回值后触发 fault 流程（等价于 `WINK_CHECK` 的效果），进入 fault 指示灯循环；
4. 生产固件场景下，设备初始化失败本身就是不可恢复错误，fault → 复位是合理行为。

这一契约需在 device_tree.h 头文件 doxygen 中明确说明。

### 4.5 初始化顺序依赖校验与拓扑排序

虽然 `wink-app.json` 的声明顺序可以决定初始化序列，但在实际低代码或 AI 自动生成的场景中，完全依赖人工或 AI 手动对齐依赖（例如传感器依赖于总线 I2C、PWM Router 等）极易发生顺序性错乱。

为此，codegen 主程序内置以下校验与自动重排机制：
1. **依赖拓扑排序（Topological Sort）**：codegen 在渲染 `device_tree.c` 之前，会静态分析设备树的依赖树（通过设备属性，如 `use_i2c`、`parent_bus` 等），自动计算出安全的拓扑初始化顺序（总线类外设如 I2C/SPI -> 普通被动传感器 -> 危险执行器），无视 JSON 中的物理行书写顺序。
2. **依赖合法性静态校验**：若外设引用的总线不存在或引脚冲突，codegen 在编译前期抛出友好异常拦截构建，避免将硬伤带到 C 编译器链接阶段。

---

## 5. Codegen 输出 2：`app_support.c`（BAL 服务启动 + 回调绑定）

```c
#include "device_tree.h"
#include "wink_blink_helper.h"
#include "wink_default_telemetry.h"
#include "wink_sim_ultrasonic_echo.h"
#include "wink_button_helper.h"
#include "wink_app.h"

/* ── 用户手写回调前向声明（codegen 根据 callbacks 字段生成）── */
extern void app_on_boot(const wink_boot_info_t *info);
extern void app_on_fault(uint32_t code);
extern void on_boot_button(dal_button_event_t evt, void *ctx);

/* ── BAL 服务启动（在 device_tree_init 成功后调用）── */
wink_status_t wink_app_services_start(void)
{
    /* Blink (fire-and-forget helper, 内部处理错误日志) */
    wink_led_blink_start(&board_led, 1000);

    /* Button auto-poll (BAL helper，见 §7) */
    WINK_CHECK_RET(wink_button_helper_start(&boot_button, 10 /*ms*/));

    /* Sonar echo sim */
    WINK_CHECK_RET(wink_sim_ultrasonic_echo_start(&smoke_sonar, 50.0f, 18, 19));
    WINK_CHECK_RET(wink_runtime_spawn_periodic(
        "sonar_poll", 2048, 500, sonar_poll_task, &smoke_sonar, 1, PAL_OS_CORE_ANY));

    /* Telemetry */
    WINK_CHECK_RET(wink_default_telemetry_start(&smoke_sonar, &boot_button));

    /* 业务回调绑定 */
    WINK_CHECK_RET(dal_button_on_event(&boot_button, on_boot_button, NULL));

    return WINK_OK;
}

/* ── sonar 周期测量任务（codegen 因服务需要自动注入；未来通过 services/ 配置可定制）── */
static void sonar_poll_task(void *ctx) {
    (void)dal_ultrasonic_request_measurement((dal_ultrasonic_t *)ctx);
}
```

### 5.1 关于空 `app_loop`

本方案**保留 `app_loop` 作为协作调度器的显式心跳契约**——即使所有轮询都通过 BAL helper/后台任务接管，`app_loop` 仍是用户可插入业务逻辑的位置。`app_loop` 为空是允许的，但**不被强制清空**（未来 event queue 落地后再重新评估）。

---

## 6. BAL API 错误处理分级

### 6.1 三级错误处理契约（沿用 2026-07-05 日志加固建立的体系）

| 级别 | 宏标记 | 适用 API | 调用方要求 |
|---|---|---|---|
| **Fatal** | `WINK_WARN_UNUSED_RESULT` | `_init`、`_claim`、`_set_config`、`_calibrate`、`wink_runtime_spawn_*`、`wink_actuator_register` | 必须用 `WINK_CHECK`（致命→fault）或显式处理 |
| **Normal** | `WINK_WARN_UNUSED_RESULT` | `_request_measurement`、`_read_*`、`_start`（服务启动）、`_on_event` | 必须接收返回值；不能静默忽略 |
| **Fire-and-forget** | 无 warn_unused_result | `wink_led_blink_start`、`wink_led_set_pattern`、`wink_trace_*` | 可直接调用；内部打 `LOG_D` 级错误日志 |

### 6.2 现有 BAL/Common helper 分级结论

| API | 级别 | 理由 |
|---|---|---|
| `wink_led_blink_start` | **Fire-and-forget** | 失败只是灯不闪，内部打 LOG_D 即可 |
| `wink_led_blink_stop` | **Fire-and-forget** | 同上 |
| `wink_default_telemetry_start` | **Normal** | 失败意味着 telemetry 服务没起来，需返回错误让上层决定 |
| `wink_sim_ultrasonic_echo_start` | **Normal** | 启动 RMT 回环任务，失败会泄漏资源 |
| `wink_button_helper_start`（新） | **Normal** | 启动 soft_timer 周期 poll，失败应告知 |
| 所有 DAL `_init/_deinit` | **Fatal**（保持现状） | 硬件初始化失败不可恢复 |

### 6.3 禁止使用"取消 warn_unused_result 掩盖错误"

草案中"BAL helper 全部取消 warn_unused_result"的建议经评审**否决**：
- 返回值是 API 契约的一部分，盲目取消是用"视觉干净"换取"静默失败"；
- 正确的视觉净化手段是 **codegen 自动生成正确的 `WINK_CHECK`/`WINK_IGNORE_RESULT`**，用户/AI 永远不手写这些宏；
- `WINK_IGNORE_RESULT` 保留在 BAL/DAL 实现内部和 codegen 输出中，用于显式标记"此处确实不处理错误"的意图。

---

## 7. `wink_button_helper`：可选的自动轮询封装

### 7.1 设计取舍

草案建议"Runtime 内部自动 poll 按键"，经评审**否决**（理由见 §1.2）。折中方案：提供 BAL 层 `wink_button_helper`，内部通过 soft_timer 周期回调 poll，但**显式文档标注上下文限制**，由用户/JSON 配置 opt-in 启用。

### 7.2 API 设计

```c
/* wink_button_helper.h */
typedef struct wink_button_helper wink_button_helper_t;

/**
 * @brief 启动按键软定时自动 poll。
 *
 * ⚠️ 上下文限制（ISR-like）：
 *   此 helper 使用 soft_timer 周期回调，回调在 pal 软中断上下文执行。
 *   用户通过 dal_button_on_event 注册的事件回调也将在该上下文中触发：
 *     - 禁止调用任何可能 yield/block 的 API（sleep、mutex_lock、printf 大量日志）
 *     - 禁止执行超过 100μs 的计算
 *     - 如需复杂处理，请在事件回调中 post 到任务/队列
 *
 * 若不能满足以上限制，请保持使用 app_loop 中 dal_button_poll() 轮询模式。
 *
 * @param btn       已初始化的 dal_button_t
 * @param poll_ms   poll 周期（ms），建议 ≥5ms（消抖），≤50ms（响应延迟）
 * @return WINK_OK 启动成功；其他错误码见 wink_status.h
 */
wink_status_t wink_button_helper_start(dal_button_t *btn, uint32_t poll_ms);
void          wink_button_helper_stop(dal_button_t *btn);
```

### 7.3 实现要点

- **静态槽按需配置优化**：相比写死全局上限数组，codegen 扫描 JSON 确定实际启用的 `auto_poll` 按键总数 $N$，在生成代码中自动分配大小为 $N$ 的 Helper 跟踪数组，消除不必要的静态 RAM 浪费（避免固定写死 `MAX_BUTTONS`）。
- 内部维护静态槽追踪已启动 helper 的 button 实例，避免重复启动。
- soft_timer 回调中：`dal_button_poll(btn)`；`dal_button_poll` 内部已负责在事件触发时调用用户回调。
- `stop()` 必须在 button deinit 前调用（codegen 在 `wink_device_tree_deinit()` 前生成 helper stop 序列）。

### 7.4 Host/WASM 双 target 实现

- wasm 侧：soft_timer 由仿真调度器直接驱动，上下文限制自然成立（协作式单线程）。
- esp32 侧：soft_timer 走 FreeRTOS timer task 或 pal 软件定时；文档明确标注的 ISR-like 约束保证用户不误用。
- host 侧：同 wasm，由 host pal 的 soft_timer 驱动。

### 7.5 定时器上下文防阻塞与安全监视

由于按键事件回调在 `soft_timer` 上下文（类似 ISR / 高优先级的 timer task）下执行，任何在回调中的阻塞或耗时操作（如调用 I2C 阻塞传输、`pal_os_delay_ms` 或大量串口打印）都会直接拖垮系统的定时器机制。为此引入防御性双保险：
1. **耗时检测**：在 host 仿真 target 或是真机 Debug 模式的 `soft_timer` 执行器桩中，记录回调调用前后的微秒级时间差。如果执行耗时超过安全门限（如 100μs），将通过 `LOG_W` 输出警告，明确指出具体哪个按键回调发生了阻塞，协助开发者和 AI 定位问题。
2. **上下文约束**：利用 `WINK_ASSERT_NONBLOCKING()` 在 Debug 模式下监测事件回调，防止误调导致 yield/sleep 的阻塞 API。

---

## 8. CMake 静态裁剪（Source Selection）

### 8.1 定位修正

草案将 CMake source selection 定位为"0 字节 Flash 优化"，**表述不准确**：

- GCC/Clang 的 `-ffunction-sections -fdata-sections -Wl,--gc-sections` （ESP-IDF 和 Emscripten 默认开启）已能在链接时移除未引用函数；
- **CMake source selection 的真正价值是缩短编译时间**（少编译未使用的驱动 .c 文件），对 host/wasm CI 尤为明显。

### 8.2 开关注入方式

codegen 解析 JSON 中出现的 device types，生成 `app_options.cmake`：

```cmake
# build/generated/app_options.cmake (autogenerated, do not edit)
set(WINK_USE_LED        ON  CACHE BOOL "" FORCE)
set(WINK_USE_BUTTON     ON  CACHE BOOL "" FORCE)
set(WINK_USE_ULTRASONIC ON  CACHE BOOL "" FORCE)
set(WINK_USE_SERVO      OFF CACHE BOOL "" FORCE)
set(WINK_USE_OLED       OFF CACHE BOOL "" FORCE)
set(WINK_USE_MOTOR      OFF CACHE BOOL "" FORCE)
```

DAL 顶层 `CMakeLists.txt` 根据开关加入源文件；未启用的驱动通过**头文件 stub 宏**与全局编译器宏给出友好链接错误（而非静默空链接）：

```c
/* 当 WINK_USE_SERVO 未定义时，提供编译期不可用提示（宏定义于 wink_status.h） */
#ifndef WINK_USE_SERVO
wink_status_t dal_servo_init(...) WINK_UNAVAILABLE_MSG(
    "servo driver not enabled; add 'servo' device to wink-app.json");
#endif
```

> [!NOTE]
> `WINK_UNAVAILABLE_MSG(msg)` 集中定义在 `pal/include/wink_status.h` 中，在支持的 GCC/Clang 下展开为 `__attribute__((unavailable(msg)))`，以消除直接对 vendor 特定属性的耦合。

### 8.3 BAL 层不做 source selection

BAL helper 通过链接器 gc-sections 自动裁剪即可——未被引用的 helper 函数/文件不会进入最终二进制。这避免了 BAL配置开关与 DAL 开关的组合爆炸。

### 8.4 CMake 增量构建依赖追踪

为了避免“用户修改了 `wink-app.json`，但增量编译时构建系统无法感知从而没有重新运行 codegen”的问题，必须在 CMake 构建系统中做闭环追踪：
1. 在应用的 `CMakeLists.txt` 中，将 `wink-app.json` 注册为 configure 阶段的物理依赖：
   ```cmake
   set_property(DIRECTORY APPEND PROPERTY 
       CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/wink-app.json"
   )
   ```
2. 同时将 `wink-app.json` 设置为 `add_custom_command` 的 `DEPENDS`，确保当配置发生变化时，Ninja/Make 能够自动感知、重新运行 Python 脚本生成对应代码，保证增量编译完全正确。

---

## 9. Future Work（本次不做，留待独立 ADR/PR）

| 项 | 前置条件 | 说明 |
|---|---|---|
| **Event queue / mbox 异步原语** | **ADR-0022（Proposed 占位）** | 是"app_loop 真正留空""异步传感器事件总线""网络/外设事件统一通道"的前提；涉及协作调度器的异步语义扩展，范围大；P2 保留 `app_loop` 心跳契约 |
| **BAL 目录正规化**（`samples/common` → `bal/`） | BAL 组件数 ≥5（P3 硬阈值） | 截至 P2 收尾：blink_helper / button_helper / default_telemetry / sim_ultrasonic_echo 共 4 个；未达阈值，本次不迁目录；下一个 BAL 组件合入时触发迁移 |
| **board 预设层**（`boards/<board>.json`） | codegen 支持预设继承 | 支持把板载外设的引脚默认值集中在 board JSON 中，app JSON 只覆盖差异 |
| **PT 线程状态自动布局** | 协程框架支持状态序列化 | codegen 根据 `state_variables` 自动为 WINK_PT 生成状态结构体；wasm 侧快照/可视化 |
| **配置校验 Lint** | codegen 基础框架 | 在 codegen 阶段静态校验引脚冲突、设备类型不存在、服务依赖缺失等错误，给出精准报错而非 C 编译错误 |
| **App 层热重载（wasm）** | wasm 侧模块热替换基础设施 | 开发期改 JSON/business 代码无需刷新模拟器 |
| **Services stanza codegen**（blink/sim_echo/telemetry 启动） | BAL service 插件接口 | P2 阶段 services 启动逻辑仍在 `app_callbacks.c`；等 service 插件接口定型后迁入 codegen |

---

## 10. 向后兼容与迁移路径

1. **新旧共存**：现有手工写 `app_init` + `device_tree.c`（静态实例模式）继续工作，codegen 输出是可选入口。
2. **样板 sample 先行**：`samples/devkitc_smoke` 作为第一个迁移 sample 已于 P1 完成迁移（commit 311c291），验证 codegen 模板后再推广到其他 sample。
3. **CI 双轨**：迁移期 CI 同时构建"纯手工 sample"（avoidance_car、dual_task_demo、oled_dashboard、unisim_smoke 仍保留手写 device_tree）和"codegen sample"（devkitc_smoke），确保不回归。
4. ~~**文档更新**：完成 P1 后更新 `03-app-codegen/01-app-business-logic.md`~~ ✅ 已于 P1-5 完成（commit 见 review 记录）。

---

## 11. 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| codegen 脚本复杂度失控，变成"AI 吐 C 的另一种形式" | 高 | 严格控制 driver 插件接口；每个 driver 插件 <50 行；codegen 主程序 <300 行；JSON→C 用模板而非字符串拼接 |
| button_helper soft_timer 回调误用阻塞 API 导致死锁 | 中 | 头文件 doxygen 用 `@warning` 红色标注；host 单测加入阻塞检测断言；文档提供"何时用 helper / 何时手动 poll"决策树 |
| actuator 注册反序算法错，导致 fault 时电机没停 LED 先灭 | 中 | codegen 生成后打印注册顺序注释；host 单测构造多执行器场景验证 fault 时调用顺序；在 devkitc 上接真实电机/Servo 验证 |
| CMake 开关与 stub 宏不一致导致链接错误晦涩 | 低 | 统一用 `tools/codegen/gen_cmake_options.py` 从 driver registry 自动生成开关列表和 stub 头文件片段，避免手写出错 |
| 大 PR 难 review、难回滚 | 高 | 按 §10 迁移路径分阶段提交，每阶段独立 PR，每 PR 双 target 验证通过才合入 |

---

## 12. 验证矩阵

| 验证项 | Host | WASM | ESP32 |
|---|---|---|---|
| `wink_device_tree_init()` 多设备 init 成功路径单测 | ✅ Unity | ✅ 仿真启动检查 | ✅ devkitc smoke |
| `wink_device_tree_init()` 中途失败 rollback（半初始化 fault） | ✅ 注入 mock 失败 | ⚪（wasm fault 模型后续补） | ✅ 故障 pin 触发 |
| actuator safe-off 注册反序验证（多执行器 fault 调用顺序） | ✅ 用 spy/mock 记录顺序 | ⚪ | ✅ 真实接电机验证 |
| BAL API 分级：fire-and-forget 不强制接返回值；fatal 必须 | ✅ 编译警告检查（-Werror=unused-result） | ✅ 同 | ✅ 0 warn 0 error |
| `wink_button_helper` 软定时 poll 正确性（短按/长按/连发） | ✅ Unity + mock 时钟 | ✅ 仿真交互 | ✅ 按键手动测试 |
| CMake source selection：关闭某驱动后调用其 API 触发 unavailable 提示 | ✅ **test_dal_pruning_unavailable** ctest 负向验证，stderr 含修复指引 | ✅ | ✅ |
| codegen 从 example JSON 生成文件，输出格式与金标准对比 | ✅ diff 测试 | ⚪ | ⚪ |
| devkitc_smoke S1-S10 全 PASS（重构后回归） | ✅ **host e2e E2E PASS** | ✅ | ⏳ 待下次物理测试 session |
| 裁剪后 libdal.a 不含被禁用驱动符号（nm 验证） | ✅ -DWINK_USE_SSD1306/SERVO/GPS/EEPROM=OFF 时 nm 仅见 led/button/ultrasonic 符号 | ✅ | ✅ |

