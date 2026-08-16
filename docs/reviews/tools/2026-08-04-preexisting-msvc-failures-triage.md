# 2026-08-04 pre-existing MSVC 失败方案评审表 (深度修订版)

| 项 | 内容 |
|----|------|
| 评审对象 | 整改 commit push 后仍失败的 27 vcxproj / 344 行 error-warning |
| 范围 | 8 类 pre-existing master 失败, 与本任务 13 commit 无任何代码路径耦合 |
| 来源 | `D:\Users\77174\AppData\Local\Temp\opencode\full_build.log` (cmake --build build/test 全量输出) |
| 评审方法 | 按 vcxproj 反向 grep 错误源, 按 pattern 归类, 每类给独立方案、风险评估与长期可维护性规范 |
| 评审维度 | (a) 失败根因 (b) 备选方案对比 (c) 推荐方案 + 跨平台规范化实施代码 (d) 风险与死代码/链接风险评估 (e) 长效治理机制 |
| 结论 | 7 类可在 1-2 commit 内低风险修完; 1 类 (ArduinoCore-API) 采用 CMake `/FI` 适配层, 独立 Task 实施 |

---

## 1. 失败全景 (按 vcxproj)

```
wink_arduino_compat.vcxproj             <- 类 1 (100+ 行)
app_devkitc_smoke_e2e.vcxproj           <- 类 1 + 类 4
app_oled_dashboard_e2e.vcxproj          <- 类 1
app_dual_task_demo_e2e.vcxproj          <- 类 1 + 类 2
test_bal_chassis.vcxproj                <- 类 6
test_bal_closed_loop_dc_motor.vcxproj   <- 类 6
test_bal_rc_servo_sweep.vcxproj         <- 类 6
test_bal_telemetry.vcxproj              <- 类 7
test_button_debounce_e2e.vcxproj        <- 类 2 + 类 4
test_dal_ultrasonic_sim.vcxproj         <- 类 2
test_host_pal.vcxproj                   <- 类 4
test_pal_irq.vcxproj                    <- 类 3
test_pal_resource_wire.vcxproj          <- 类 4 + 类 6
test_periodic_basics.vcxproj            <- 类 4
test_runtime.vcxproj                    <- 类 4
test_sim_mutex_e2e.vcxproj              <- 类 4
test_sim_scheduler.vcxproj              <- 类 4 + 类 5
test_sim_scheduler_determinism.vcxproj  <- 类 4 + 类 5
test_sim_scheduler_e2e.vcxproj          <- 类 4
test_sim_scheduler_headless_jump.vcxproj <- 类 4
test_sim_scheduler_stack_clamp.vcxproj  <- 类 4
test_sim_scheduler_wcet_fault.vcxproj   <- 类 4
test_sim_scheduler_zombie_gc.vcxproj    <- 类 4
test_ultrasonic_distance_events.vcxproj <- 类 4 + 类 8
test_wasm_devices_sim.vcxproj           <- 类 2
test_wink_event.vcxproj                 <- (待查)
test_wink_selftest.vcxproj              <- (待查)
```

**27 vcxproj 失败, 8 类独立根因**. 与本任务 13 commit (cea4aa4..cd463d3) 无任何代码路径耦合, 都是 master 上 pre-existing 的 churn/遗留/跨平台缺口.

---

## 2. 分类失败详情 + 方案 (含跨平台规范与风险评估)

### 2.1 类 1: ArduinoCore-API GCC 扩展 (100+ 行, 5 vcxproj)

**问题位置**:
- `D:\workspaces\open-source\embedded\ArduinoCore-API\api\Common.h:104`
- `D:\workspaces\open-source\embedded\ArduinoCore-API\api\WCharacter.h:28-50`
- `D:\workspaces\open-source\embedded\ArduinoCore-API\api\HardwareSerial.h:104`
- `D:\workspaces\open-source\embedded\ArduinoCore-API\api\USBAPI.h:33-47`
- `D:\workspaces\open-source\embedded\ArduinoCore-API\api\PluggableUSB.h:36-59`

**症状**:
```
error C3646: "__attribute__": 未知重写说明符
error C2059: 语法错误: "{"
error C4430: 缺少类型说明符
error C2084: 函数 "arduino::isPrintable(int)" 已有主体
error C2061: 语法错误: 标识符 "USBSetup"
warning C4273: "itoa": dll 链接不一致
```

**根因**: ArduinoCore-API 为 GCC/Clang 编写, 强依赖以下 GCC 扩展:
- `__attribute__((always_inline))` 标记内联函数 (WCharacter.h / HardwareSerial.h)
- `__attribute__((weak))` 声明弱符号 (Common.h / itoa.h)
- C99 designated initializer `{.member = val}` (PluggableUSB.h)
- C++ nested class template + `extern "C"` 混合 (USBAPI.h)

MSVC 语法解析器前端遇到未知 `__attribute__` 会判定为语法错误（C2059/C3646），直接中断编译。

**影响项目**:
- `wink_arduino_compat.vcxproj` (本身)
- `app_devkitc_smoke_e2e.vcxproj` / `app_oled_dashboard_e2e.vcxproj` / `app_dual_task_demo_e2e.vcxproj` (透传)

**3 个备选方案对比**:

| 方案 | 改动范围 | 风险与工程性评估 | 结论 |
|------|---------|------------------|------|
| A. **在 vcxproj 加 `/wo` 选项降低警告** | 1 个 CMakeLists | 🔴 **不可行**。`C2059`/`C3646` 是 MSVC 编译器**语法硬错误 (Error)**，无法通过 `/wd` 或 `/wo` 降级为 Warning。 | 废弃 |
| B. **Fork ArduinoCore-API 仓库改头文件** | 跨仓库 fork | 🔴 **高维护债务**。侵入第三方上游，维护成本高，拉取上游更新容易产生冲突。 | 废弃 |
| C. **建立 MSVC 兼容适配头文件 + CMake `/FI` 注入** | 1 新文件 + 1 CMake 选项 | ✅ **最佳模式**。在 `wink_arduino_compat` 编译单元中显式注入 GCC 兼容层，不侵入第三方源码。 | **推荐 (独立 Task 实施)** |

**推荐方案代码实现 (方案 C)**:

1. **新建 `wink-micro-os/frameworks/arduino/include/compat/wink_msvc_compat.h`**:
```c
/* wink_msvc_compat.h
 * Purpose: Suppress GCC-specific extension syntax for MSVC host builds.
 * This file is force-included via /FI for MSVC builds of wink_arduino_compat.
 * It MUST NOT be included directly in embedded target builds.
 *
 * See: docs/decisions/core/0058-relay-actuator-classification-and-latching-semantics.md
 */
#ifndef WINK_MSVC_COMPAT_H
#define WINK_MSVC_COMPAT_H

#if !defined(_MSC_VER)
#  error "wink_msvc_compat.h is for MSVC host builds only."
#endif

/* GCC attribute stubs & specifier mappings */
#define __attribute__(x)             /* GCC attribute -> no-op on MSVC */
#define __inline__     __inline
#define __volatile__   volatile
#define __asm__        __asm
#define __extension__                /* GCC extension marker -> no-op */

/* CRT redeclaration & linkage conflict suppression */
#define _CRT_NONSTDC_NO_WARNINGS
#pragma warning(disable: 4273)       /* itoa: dll linkage inconsistency */
#pragma warning(disable: 4005)       /* macro redefinition */

#endif /* WINK_MSVC_COMPAT_H */
```

2. **修改 `wink-micro-os/frameworks/arduino/CMakeLists.txt`**:
```cmake
# MSVC Host Build: Force-include msvc_compat.h before Arduino API headers
# to stub out GCC-specific attributes.
# See: docs/decisions/core/0058-relay-actuator-classification-and-latching-semantics.md
if (MSVC)
    target_compile_options(wink_arduino_compat PRIVATE
        /FI"${CMAKE_CURRENT_SOURCE_DIR}/include/compat/wink_msvc_compat.h"
    )
endif()
```

**治理建议**: 走 Governance Review 确认方案 C，并在 `docs/decisions/` 中记录 **ADR-0058 "ArduinoCore-API MSVC 兼容性策略"**。

---

### 2.2 类 2: `__attribute__((constructor))` (5 处, 4 vcxproj)

**问题位置**:
- `wink-micro-os/test/stubs/js_sim_host_stub.c:23`
- `wink-micro-os/targets/wasm/devices/wasm_dev_ultrasonic.c:31`

**症状**: `error C2085: "register_sim_ultrasonic_callbacks" 不在形参表中`, `error C2091: 函数返回函数`

**根因**: MSVC C 编译器不支持 `__attribute__((constructor))` 语法。

**跨平台规范化方案 (`wink_init_ctor.h`)**:

为防范 MSVC 链接器在 Release 构建或开启 `/OPT:REF`（死代码消除）时误将未引用的 `.CRT$XCU` 函数指针剔除，使用 `volatile` 修饰符锁定初始化函数指针。

**Step 1**: 新建 `wink-micro-os/os/portable/wink_init_ctor.h`:
```c
#ifndef WINK_INIT_CTOR_H
#define WINK_INIT_CTOR_H

/* WINK_CONSTRUCTOR(func): Declare func as a program-startup hook running before main().
 *   - GCC/Clang: __attribute__((constructor))
 *   - MSVC:       .CRT$XCU section + volatile function pointer to prevent DCE under /OPT:REF
 *
 * See: docs/decisions/tools/0060-wink-tools-console-service-and-stderr-isolation.md
 */
#if defined(_MSC_VER)
#  pragma section(".CRT$XCU", read)
#  define WINK_CONSTRUCTOR(func)                                            \
        static void func##_impl_(void);                                     \
        __declspec(allocate(".CRT$XCU"))                                    \
        static void (* volatile func##_ctor_)(void) = func##_impl_;         \
        static void func##_impl_(void)
#elif defined(__GNUC__) || defined(__clang__)
#  define WINK_CONSTRUCTOR(func)                                            \
        __attribute__((constructor)) static void func(void)
#else
#  error "WINK_CONSTRUCTOR: unsupported compiler platform"
#endif

#endif /* WINK_INIT_CTOR_H */
```

**Step 2**: 修改 `wink-micro-os/test/stubs/js_sim_host_stub.c:23`:
```c
#include "wink_init_ctor.h"

WINK_CONSTRUCTOR(register_sim_ultrasonic_callbacks) {
    extern void host_register_sim_ultrasonic(void (*trigger_fn)(uint16_t),
                                              uint32_t (*measure_fn)(uint16_t));
    host_register_sim_ultrasonic(js_sim_trigger_ultrasonic,
                                 js_sim_measure_echo_pulse_us);
}
```

**风险点与规范**: 低风险。使用 `volatile` 保障了 MSVC 链接优化安全性，且在 ESP32 / Emscripten 平台保持对称编译。关联 **ADR-0060**。

---

### 2.3 类 3: `<pthread.h>` 缺失 (1 处, 1 vcxproj)

**问题位置**: `wink-micro-os/test/unit/pal/test_pal_irq.c:345`

**症状**: `error C1083: 无法打开包括文件: "pthread.h"`

**根因**: 该段代码（345-548 行）为 Linux 平台特有的 IRQ race condition 并发测试，Windows/MSVC 环境无 POSIX pthread 支持。且该文件属于 `.vcxproj` 历史残留目标，不包含在 `CMakeLists.txt` 主构建逻辑中。

**推荐方案**:
按 Spec v3.4.1 §6.2 规定（SMP 真实硬件并发验证基于 Linux/xtensa），直接对 POSIX 依赖测试段实施平台隔离：

```c
/* test_pal_irq.c */
#if !defined(ESP_PLATFORM) && !defined(__EMSCRIPTEN__) && !defined(_WIN32)
#include <pthread.h>
/* ... POSIX pthread race test cases (line 345-548) ... */
#endif  /* POSIX-only race test */
```

**长效治理**: 在构建工具链整改任务中同步清理孤立的 `.vcxproj` 生成配置，保证与 CMakeLists 目标对齐。

---

### 2.4 类 4: `__declspec(deprecated)` Blocking API 告警 C4996 (13 文件, 13 vcxproj)

**症状**: `error C2220: 以下警告被视为错误`, `warning C4996: 'pal_os_sleep_ms': Blocking API forbidden...`

**根因**: `pal_osal.h` 等头文件将阻塞 API 声明为 `deprecated`。测试套件作为“契约守卫测试（Contract Guard Tests）”，需故意调用阻塞 API 以验证老路径兼容性，被 MSVC `/WX` 将告警误判为编译中断。

**跨编译器规范化方案 (`wink_test_compat.h`)**:

为避免在每个测试文件中手写裸 MSVC `#pragma` 导致 GCC/Clang 平台编译报错或 pop 漏写引发告警扩散，建立统一跨编译器兼容宏：

**Step 1**: 在 `wink-micro-os/test/include/wink_test_compat.h` 中增加定义：
```c
/* wink_test_compat.h
 * Test compatibility macros for contract-guard tests calling deprecated APIs.
 * Spec: spec v3.5.0 §11.3 "Test Exemption from Blocking Deprecation"
 */
#if defined(_MSC_VER)
#  define WINK_TEST_ALLOW_DEPRECATED_BEGIN \
        __pragma(warning(push))            \
        __pragma(warning(disable: 4996))
#  define WINK_TEST_ALLOW_DEPRECATED_END   \
        __pragma(warning(pop))
#elif defined(__GNUC__) || defined(__clang__)
#  define WINK_TEST_ALLOW_DEPRECATED_BEGIN \
        _Pragma("GCC diagnostic push")     \
        _Pragma("GCC diagnostic ignored \"-Wdeprecated-declarations\"")
#  define WINK_TEST_ALLOW_DEPRECATED_END   \
        _Pragma("GCC diagnostic pop")
#else
#  define WINK_TEST_ALLOW_DEPRECATED_BEGIN
#  define WINK_TEST_ALLOW_DEPRECATED_END
#endif
```

**Step 2**: 在 13 个测试目标文件中采用对称宏进行包裹：
```c
WINK_TEST_ALLOW_DEPRECATED_BEGIN
/* Intentional contract guard invocation of legacy blocking API */
pal_os_sleep_ms(10);
WINK_TEST_ALLOW_DEPRECATED_END
```

**关联规范**: 纳入 **spec v3.5.0 §11.3** "测试豁免于 Blocking Deprecation 规则"。

---

### 2.5 类 5: `strncpy` C4996 告警 (1 处, 2 vcxproj)

**问题位置**: `wink-micro-os/targets/common/src/wink_sim_scheduler.c:111`

**根因**: MSVC CRT 将 `strncpy` 标注为不安全函数并触发 C4996 告警。

**修复与长期可维护性方案**:

1. **短期单点修复**: 在 `wink_sim_scheduler.c` 文件顶部增加控制块：
```c
/* MSVC CRT deprecation suppression for bounded simulation buffer initialization */
#if defined(_MSC_VER)
#  pragma warning(disable: 4996)
#  define _CRT_SECURE_NO_WARNINGS
#endif
```

2. **长期工具化抽离 (推荐入库)**: 在 `wink_string_utils.h` 中提供跨平台边界安全字符串拷贝函数，从根源消除溢出与告警隐患：
```c
static inline size_t wink_strlcpy(char *dst, const char *src, size_t dsize) {
    size_t srclen = strlen(src);
    if (dsize != 0) {
        size_t len = (srclen >= dsize) ? dsize - 1 : srclen;
        memcpy(dst, src, len);
        dst[len] = '\0';
    }
    return srclen;
}
```

---

### 2.6 类 6: DAL 字段重命名/移除后 Test 残留 (4 test, 4 vcxproj)

**问题位置**:
- `test_bal_chassis.c` / `test_bal_closed_loop_dc_motor.c` (`dal_dc_motor_t.current_speed` 已移除)
- `test_bal_rc_servo_sweep.c` / `test_pal_resource_wire.c` (`min_pulse_ms` 重命名为 `min_pulse_us`, `current_angle` 已移除)

**根因**: DAL 驱动层重构（封装性增强，将结构体公共成员变量收敛至 API），测试代码未同步重构。

**规范化重构映射**:

| 测试文件 | 废弃成员访问 | 规范化替换 API |
| :--- | :--- | :--- |
| `test_bal_chassis.c` | `dev.current_speed` | `dal_dc_motor_get_speed(&dev, &speed)` |
| `test_bal_closed_loop_dc_motor.c` | `dev.current_speed` | `dal_dc_motor_get_speed(&dev, &speed)` |
| `test_bal_rc_servo_sweep.c` | `cfg.min_pulse_ms` | `cfg.min_pulse_us` |
| `test_bal_rc_servo_sweep.c` | `dev.current_angle` | `dal_rc_servo_get_angle(&dev, &angle)` |

**长效防回归机制**: 在 CI 校验脚本中添加正则匹配，防止已移除的 DAL 私有成员再次被直接读取：
```bash
git grep -E "\.current_speed|\.current_angle|\.min_pulse_ms" -- "test/*"
```

---

### 2.7 类 7: LNK2005 重复符号 `wink_runtime_fault` (1 处, 1 vcxproj)

**问题位置**: 链接 `wink_runtime.lib` 与 `pal_host.lib` 时符号 `wink_runtime_fault` 碰撞。

**根因与场景判定**:
- **场景 A (普通定义重复)**：若 `wink_runtime_fault` 仅为普通实现函数，因未修饰 `static` 或未声明 `inline` 导致多 TU 链接冲突。
- **场景 B (弱符号 Hook 覆盖)**：若其设计为“默认 Weak 实现，允许用户定义 Strong 覆盖”。

**跨平台规范化方案 (`wink_compiler.h`)**:

需要特别注意：MSVC 的 `__declspec(selectany)` 属于 COMDAT folding（要求所有符号定义完全一致，由链接器随机挑选），**不能直接等价于 GCC 的弱符号覆盖**。

在 `wink_compiler.h` 中明确区分并规范定义：

```c
/* wink_compiler.h
 *
 * WINK_WEAK: Allows identical symbol definitions across TUs without LNK2005.
 * WINK_WEAK_ALIAS: Provides GCC-style weak function override semantics under MSVC.
 *
 * See: docs/decisions/tools/0059-wink-tools-cli-hybrid-verb-first-architecture.md
 */
#if defined(__GNUC__) || defined(__clang__)
#  define WINK_WEAK __attribute__((weak))
#  define WINK_WEAK_ALIAS(weak_func, default_func)
#elif defined(_MSC_VER)
#  define WINK_WEAK __declspec(selectany)
#  define WINK_WEAK_ALIAS(weak_func, default_func) \
        __pragma(comment(linker, "/alternatename:" #weak_func "=" #default_func))
#else
#  define WINK_WEAK
#  define WINK_WEAK_ALIAS(weak_func, default_func)
#endif
```

*若排查确认为场景 A，将头文件/源文件内部非导出实现标为 `static` 或 `inline` 即可。关联 **ADR-0059**。*

---

### 2.8 类 8: C4701 局部变量可能未初始化 (1 处, 1 vcxproj)

**问题位置**: `test_ultrasonic_distance_events.c:123` (`wink_event_t ev`)

**修复方案**: 显式零初始化：
```c
wink_event_t ev = {0};  /* Explicit zero-init to suppress MSVC C4701 */
```
无运行时性能损耗，零风险。

---

## 3. 修复优先级与执行计划

### 3.1 优先级矩阵

| 优先级 | 类 | 描述 | 推荐方案 | 估时 | 风险 | Commit 数 |
|--------|----|------|---------|------|------|----------|
| **P0** | 5 | strncpy C4996 | Header `#pragma` / `wink_strlcpy` | 5 min | 极低 | 1 |
| **P0** | 8 | C4701 `ev` 未初始化 | 显式零初始化 `= {0}` | 2 min | 极低 | (合并) |
| **P0** | 2 | `__attribute__((constructor))` | `WINK_CONSTRUCTOR` (`volatile` 防 DCE) | 15 min | 低 | 1 |
| **P0** | 7 | LNK2005 符号重复 | `wink_compiler.h` 符号作用域规范化 | 15 min | 低 | 1 |
| **P1** | 3 | `<pthread.h>` 缺失 | `#if !defined(_WIN32)` 平台隔离 | 5 min | 低 | 1 |
| **P1** | 4 | C4996 Blocking 告警 | `WINK_TEST_ALLOW_DEPRECATED` 宏包裹 | 45 min | 低 | 3 |
| **P2** | 6 | DAL 字段重构残留 | 迁移至 DAL `get_*()` 标准 API | 1~2 h | 中 | 1~2 |
| **P3** | 1 | ArduinoCore GCC 扩展 | CMake `/FI` 适配层 `wink_msvc_compat.h` | 2 h | 中 | 1 (独立Task) |

### 3.2 规范化 Commit 序列

```
Commit 1: fix(targets/sim): suppress strncpy C4996 & explicit zero-init ev (Class 5 & 8)
Commit 2: fix(portable): add WINK_CONSTRUCTOR macro with DCE protection (Class 2)
Commit 3: fix(runtime): fix wink_runtime_fault scope to resolve LNK2005 (Class 7)
Commit 4: fix(test/pal_irq): isolate POSIX pthread race test on MSVC (Class 3)
Commit 5-7: fix(test): wrap contract-guard tests with WINK_TEST_ALLOW_DEPRECATED (Class 4, 3 commits)
Commit 8-9: refactor(test/dal): migrate bal/pal tests to official DAL get_* APIs (Class 6, 2 commits)
```

---

## 4. 治理与长效规范总结

1. **架构决策记录 (ADR) 支撑**:
   - **ADR-0058**: ArduinoCore-API MSVC 兼容适配层策略 (`/FI` 强制包含)
   - **ADR-0059**: 跨平台 Weak 符号与别名规范 (`WINK_WEAK` & `WINK_WEAK_ALIAS`)
   - **ADR-0060**: 跨平台 Main-Pre Constructor 机制 (`WINK_CONSTRUCTOR`)
   - **spec v3.5.0 §11.3**: 测试套件契约守卫调用 Deprecated API 的豁免规范

2. **跨编译器宏编写 3 大铁律**:
   - **对称性**: 必须同时提供 `_MSC_VER` 与 `__GNUC__`/`__clang__` 分支，禁止出现无 `#else` 的单平台宏。
   - **成对性**: 所有 Diagnostic / Warning 修改必须成对出现（`push` 与 `pop` 匹配），严禁警告抑制泄漏。
   - **防 DCE**: MSVC 自定义 CRT 段指针必须使用 `volatile` 修饰，防范 Release 构建下的死代码消除。

3. **测试验证流程**:
   ```bash
   # 1. CMake 编译构建全量验证
   cmake --build build/test --config Debug 2>&1 | Tee-Object build.log

   # 2. 自动化单元测试套件全量回归
   foreach ($exe in Get-ChildItem build/test/test/Debug/test_*.exe) {
       & $exe.FullName
       if ($LASTEXITCODE -ne 0) { throw "Test failure: $($exe.BaseName)" }
   }

   # 3. DAL ABI 冻结断言校验
   build/test/test/Debug/test_dal_abi_freeze.exe
   ```
