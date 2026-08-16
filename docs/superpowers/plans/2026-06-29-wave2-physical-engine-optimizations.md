# Wave2 物理仿真引擎优化综合实施计划

&gt; **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落实代码评审的全部 10 项优化建议（原评审 4 项 + 架构补充 6 项），分优先级分阶段落地，全面提升 WASM 仿真引擎的健壮性、可维护性与架构前瞻性。

**Architecture:** 按 P0→P1→P2→P3 优先级顺序实施。P0/P1 为近期必须修复的健壮性问题，P2/P3 为中长期架构演进的预埋工作。每个任务独立可测试，不依赖后续任务。

**Tech Stack:** TypeScript (Web Worker), C (WASM target), Emscripten Asyncify, Jest (TS tests), Unity (C tests)

## Global Constraints

- 所有 C 代码必须通过 Emscripten/WASM32 与 ESP-IDF/xtensa 双 target 编译（ADR-0002）
- 所有可能失败的函数返回 `wink_status_t`，0 = 成功，负数 = 错误（ADR-0001）
- 使用编译期静态分发，禁止虚拟函数表或 `container_of` 强转（ADR-0004）
- 新增代码必须附带对应单元测试，覆盖率不低于现有代码水平
- Commit message 使用英文，按文件粒度原子提交

---

## 文件影响总览

| 文件 | 涉及任务 | 修改内容 |
|------|---------|---------|
| `../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts` | Task 1 | 修复 BigInt 序列化崩溃 |
| `wink-micro-os/targets/wasm/pal_osal_wasm.c` | Task 2, Task 4, Task 7 | Task 创建警告、移除 volatile、时钟溢出预警 |
| `wink-micro-os/targets/wasm/pal_hal_wasm.c` | Task 3 | wasm64 静态断言 |
| `wink-micro-os/targets/wasm/wasm_bridge.h` | Task 8 | ABI 契约文档 |
| `wink-micro-os/targets/wasm/pal_wasm_physical.c` | Task 5, Task 6, Task 9, Task 10 | WCET 统计、故障审计日志、功耗模型预埋 |
| `wink-micro-os/targets/wasm/pal_wasm_internal.h` | Task 5, Task 6, Task 9, Task 10 | 新增内部接口声明 |

---

## Phase 1: P0 优先级 - 必须立即修复

---

### Task 1: 修复 SimWorker BigInt JSON.stringify 崩溃

**Files:**
- Modify: `../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts:90-105`
- Test: `../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/SimWorker.test.ts` (新建)

**Interfaces:**
- Produces: `safeStringifyForError(obj: unknown): string` - 安全序列化函数

**Problem:** 未知命令的 default 分支使用 `JSON.stringify(_exhaustive)`，如果 payload 包含 bigint 会抛出 TypeError 导致精确错误信息丢失。

- [ ] **Step 1: 编写失败测试**

在 `../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/SimWorker.test.ts` 中新增：

```typescript
import { safeStringifyForError } from '../SimWorker';

describe('SimWorker error serialization', () =&gt; {
  it('should safely stringify objects containing BigInt', () =&gt; {
    const msgWithBigInt = {
      type: 'STEP_CLOCK',
      id: 1,
      payload: { us: 1000n }
    };
    // 不应抛出 TypeError: Do not know how to serialize a BigInt
    expect(() =&gt; safeStringifyForError(msgWithBigInt)).not.toThrow();
    const result = safeStringifyForError(msgWithBigInt);
    expect(result).toContain('STEP_CLOCK');
    expect(result).toContain('1000');
  });

  it('should handle circular references gracefully', () =&gt; {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() =&gt; safeStringifyForError(obj)).not.toThrow();
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd simulator &amp;&amp; npx jest src/unisim/worker/__tests__/SimWorker.test.ts -v`
Expected: FAIL with "safeStringifyForError is not defined"

- [ ] **Step 3: 实现安全序列化函数**

在 `SimWorker.ts` 顶部新增工具函数：

```typescript
/**
 * Safe JSON stringify for error messages that handles BigInt and circular references.
 * Used in the default branch of message handling to avoid worker crashes when
 * unknown commands carry bigint payloads.
 */
export function safeStringifyForError(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) =&gt; {
    // Handle BigInt - convert to string representation
    if (typeof value === 'bigint') {
      return value.toString() + 'n';
    }
    // Handle circular references
    if (typeof value === 'object' &amp;&amp; value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  });
}
```

修改 default 分支（约 L93-99）：

```typescript
default: {
  const _exhaustive: never = msg;
  return {
    type: 'ERR',
    id: (msg as { id?: number }).id ?? -1,
    command: 'UNKNOWN',
    message: `Unknown command type: ${(msg as any).type}, payload: ${safeStringifyForError(_exhaustive)}`,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd simulator &amp;&amp; npx jest src/unisim/worker/__tests__/SimWorker.test.ts -v`
Expected: 2 tests PASS

- [ ] **Step 5: 运行现有 Worker 测试确保无回归**

Run: `cd simulator &amp;&amp; npx jest src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts -v`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add ../../../../wink-ai/packages/unisim/src/unisim/worker/SimWorker.ts ../../../../wink-ai/packages/unisim/src/unisim/worker/__tests__/SimWorker.test.ts
git commit -m "fix(worker): safe BigInt serialization in unknown command error path"
```

---

### Task 2: pal_task_create 死循环风险醒目标注

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_osal_wasm.c:97-110`
- Test: 编译测试（无运行时测试，这是文档改进）

**Problem:** WASM 单线程环境下，`pal_task_create` 直接同步调用任务函数。如果任务函数包含 `while(1)` 死循环或 `pal_delay_ms`，会直接阻塞整个仿真主逻辑。

- [ ] **Step 1: 编写编译测试（验证头文件可编译）**

在 `wink-micro-os/test/wasm/test_task_warning.c` 新建：

```c
#include "unity.h"
#include "pal/pal.h"

void test_task_create_compiles(void) {
    // 只是验证头文件可编译，不实际运行（运行会死锁）
    TEST_PASS();
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_task_create_compiles);
    return UNITY_END();
}
```

- [ ] **Step 2: 运行编译测试验证通过**

Run: `cd wink-micro-os &amp;&amp; mkdir -p build &amp;&amp; cd build &amp;&amp; emcmake cmake .. &amp;&amp; make test_task_warning`
Expected: Compiles successfully

- [ ] **Step 3: 添加醒目的警告注释**

修改 `pal_osal_wasm.c` 中 `pal_task_create` 函数：

```c
wink_status_t pal_task_create(pal_task_func_t func, void *arg,
                               const pal_task_config_t *config) {
    // [!WARNING: WASM SINGLE-THREADED DEGENERATE CASE]
    // ================================================
    // WASM 沙箱无真正的抢占式多任务或独立线程。
    // 此函数会**同步立即调用**任务函数，而非创建可调度的任务。
    //
    // 严重陷阱：
    // 1. 如果任务函数包含 while(1) 死循环 → 仿真永久阻塞
    // 2. 如果任务函数调用 pal_delay_ms → 通过 Asyncify 挂起但无法恢复
    // 3. 多个任务无法并发执行，第一个任务就会独占执行流
    //
    // 正确用法（WASM 仿真）：
    // - 所有"并发"任务必须改写为非阻塞状态机
    // - 使用 pal_timer_create() + 回调的方式实现周期性逻辑
    // - 主循环中依次调用各模块的 step() 函数，而非创建独立任务
    //
    // 此行为与 ESP32 target 语义不一致，属于仿真的已知限制。
    // ================================================

    (void)config;
    func(arg);
    return WINK_OK;
}
```

- [ ] **Step 4: 重新编译验证**

Run: `cd wink-micro-os/build &amp;&amp; make test_task_warning`
Expected: Compiles successfully, no new warnings

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_osal_wasm.c wink-micro-os/test/wasm/test_task_warning.c
git commit -m "docs(wasm): add critical warning for WASM task create limitation"
```

---

### Task 3: wasm64 指针截断静态断言保护

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_hal_wasm.c:58-75`
- Test: 编译期静态断言测试

**Problem:** `callback_index = (uint32_t)(uintptr_t)callback` 在 wasm32 下安全（sizeof(uintptr_t) == 4），但未来迁移 wasm64 时会发生静默的指针截断。

- [ ] **Step 1: 添加静态断言**

在 `pal_hal_wasm.c` 顶部 `#include` 块之后添加：

```c
// WASM 指针宽度编译期保证
// ================================================
// 以下代码在多处将 uintptr_t 强转为 uint32_t 用于传递给 JS 侧。
// 这在 wasm32 下是绝对安全的，但在 wasm64 下会发生指针截断。
// 静态断言确保在迁移到 wasm64 时，这段代码必须被重新审视和修改。
// ================================================
#if defined(__wasm__)
#if defined(__wasm64__)
#error "pal_hal_wasm.c contains 32-bit pointer assumptions. Must be refactored for wasm64."
#else
_Static_assert(sizeof(uintptr_t) == sizeof(uint32_t),
               "Pointer truncation detected: this code assumes wasm32 with 4-byte pointers");
#endif
#endif
```

- [ ] **Step 2: 在 pal_wasm_gpio_attach_interrupt 函数内添加行内注释**

修改约 L61-69：

```c
    // [!NOTE: WASM32-SPECIFIC TRUNCATION]
    // 将指针编码为 32 位整数传递给 JS 侧。
    // 这在 wasm32 下是安全的（uintptr_t == uint32_t）。
    // 编译期静态断言确保此假设不被破坏。
    // 迁移到 wasm64 时需要：
    // 1. 使用 -s WASM_BIGINT=1 传递 64 位整数
    // 2. 或者改用索引表间接传递函数指针
    uint32_t callback_index = (uint32_t)(uintptr_t)callback;
    uint32_t arg_ptr        = (uint32_t)(uintptr_t)arg;
```

- [ ] **Step 3: 编译验证静态断言生效**

Run: `cd wink-micro-os/build &amp;&amp; make pal_hal_wasm.o`
Expected: Compiles without error (assertion holds for wasm32)

- [ ] **Step 4: 验证现有测试通过**

Run: `cd wink-micro-os/build &amp;&amp; make test_debounce_middleware &amp;&amp; ./test_debounce_middleware`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_hal_wasm.c
git commit -m "refactor(wasm): add compile-time guard against wasm64 pointer truncation"
```

---

### Task 4: 移除不必要的 volatile 修饰

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_osal_wasm.c:115-116`
- Test: 现有环形缓冲区测试

**Problem:** WASM 单线程环境下不存在真正的硬件中断或多核竞争，`volatile` 没有实质作用，反而误导阅读者以为有跨线程保护。

- [ ] **Step 1: 运行现有环形缓冲区测试（基线）**

先确保有环形缓冲区测试，如果没有，在 `wink-micro-os/test/wasm/test_ringbuf.c` 中添加：

```c
#include "unity.h"
#include "pal/pal.h"
#include <string.h>

// 简单验证环形缓冲区语义（不直接访问内部变量）
void test_ringbuf_basic_operation(void) {
    // 这里测试 pal_queue_* 系列 API 而非内部实现
    // 因为内部 static 变量对外不可见
    pal_queue_t q;
    uint8_t buf[32];
    wink_status_t status = pal_queue_init(&amp;q, buf, sizeof(buf), 4);
    TEST_ASSERT_EQUAL(WINK_OK, status);

    uint32_t item = 0x12345678;
    status = pal_queue_send(&amp;q, &amp;item, 0);
    TEST_ASSERT_EQUAL(WINK_OK, status);

    uint32_t recv = 0;
    status = pal_queue_receive(&amp;q, &amp;recv, 0);
    TEST_ASSERT_EQUAL(WINK_OK, status);
    TEST_ASSERT_EQUAL_HEX32(0x12345678, recv);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_ringbuf_basic_operation);
    return UNITY_END();
}
```

Run: `cd wink-micro-os/build &amp;&amp; make test_ringbuf &amp;&amp; ./test_ringbuf`
Expected: All tests PASS

- [ ] **Step 2: 移除 volatile 修饰**

修改 `pal_osal_wasm.c` 中的环形缓冲区定义：

```c
// WASM 仿真为单线程执行环境，无硬件中断或多核并发。
// 因此不需要 volatile 修饰来防止编译器优化重排。
// （volatile 在嵌入式中用于 ISR 与主程序共享变量，但这里是纯软件仿真）
static uint32_t s_ringbuf_head;
static uint32_t s_ringbuf_tail;
```

同时在使用这两个变量的位置添加上下文注释，说明为什么不需要 volatile。

- [ ] **Step 3: 重新编译并运行测试**

Run: `cd wink-micro-os/build &amp;&amp; make test_ringbuf &amp;&amp; ./test_ringbuf`
Expected: All tests PASS (behavior unchanged)

- [ ] **Step 4: 运行全部 WASM 测试套件**

Run: `cd wink-micro-os/build &amp;&amp; make test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_osal_wasm.c wink-micro-os/test/wasm/test_ringbuf.c
git commit -m "refactor(wasm): remove unnecessary volatile from ringbuf (single-threaded WASM)"
```

---

### Task 5: WCET 最坏执行时间统计

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_wasm_physical.c`
- Modify: `wink-micro-os/targets/wasm/pal_wasm_internal.h`
- Test: `wink-micro-os/test/wasm/test_wcet.c` (新建)

**Problem:** `pal_wasm_tick_isr()` 的执行时间随 pin 数量线性增长，可能超过仿真步长导致时序变形。需要可观测的统计机制。

- [ ] **Step 1: 编写失败测试**

在 `wink-micro-os/test/wasm/test_wcet.c` 中：

```c
#include "unity.h"
#include "pal_wasm_internal.h"

void test_wcet_tracking_exists(void) {
    // 验证 WCET API 存在
    uint32_t max_us = pal_wasm_get_max_tick_us();
    TEST_ASSERT_TRUE(max_us &gt;= 0);

    uint32_t overruns = pal_wasm_get_tick_overrun_count();
    TEST_ASSERT_TRUE(overruns &gt;= 0);
}

void test_wcet_reset_works(void) {
    pal_wasm_reset_wcet_stats();
    TEST_ASSERT_EQUAL_UINT32(0, pal_wasm_get_max_tick_us());
    TEST_ASSERT_EQUAL_UINT32(0, pal_wasm_get_tick_overrun_count());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_wcet_tracking_exists);
    RUN_TEST(test_wcet_reset_works);
    return UNITY_END();
}
```

- [ ] **Step 2: 编译验证失败**

Run: `cd wink-micro-os/build &amp;&amp; make test_wcet`
Expected: Compile error (functions not declared)

- [ ] **Step 3: 在 pal_wasm_internal.h 添加接口声明**

```c
// ============================================================================
// WCET (Worst-Case Execution Time) 统计
// 用于监控 tick 处理函数的执行时间是否超过仿真步长
// ============================================================================

/** 获取单次 tick 的最大执行时间（微秒，来自 JS 侧计时） */
uint32_t pal_wasm_get_max_tick_us(void);

/** 获取 tick 执行时间超过阈值的次数 */
uint32_t pal_wasm_get_tick_overrun_count(void);

/** 重置 WCET 统计 */
void pal_wasm_reset_wcet_stats(void);

/** JS 侧调用：记录本次 tick 实际执行时间 */
void pal_wasm_record_tick_duration(uint32_t duration_us);
```

- [ ] **Step 4: 在 pal_wasm_physical.c 实现 WCET 统计**

在文件顶部静态变量区添加：

```c
// WCET 统计
static uint32_t s_max_tick_us;
static uint32_t s_tick_overrun_count;
static uint32_t s_wcet_threshold_us = 1000;  // 默认阈值：1ms
```

在文件底部实现函数：

```c
// ============================================================================
// WCET 统计实现
// ============================================================================

uint32_t pal_wasm_get_max_tick_us(void) {
    return s_max_tick_us;
}

uint32_t pal_wasm_get_tick_overrun_count(void) {
    return s_tick_overrun_count;
}

void pal_wasm_reset_wcet_stats(void) {
    s_max_tick_us = 0;
    s_tick_overrun_count = 0;
}

void pal_wasm_record_tick_duration(uint32_t duration_us) {
    if (duration_us &gt; s_max_tick_us) {
        s_max_tick_us = duration_us;
    }
    if (duration_us &gt; s_wcet_threshold_us) {
        s_tick_overrun_count++;
    }
}
```

- [ ] **Step 5: 在 wasm_bridge.h 导出给 JS 调用**

在 `EMSCRIPTEN_KEEPALIVE` 导出区添加：

```c
// WCET 统计接口
void pal_wasm_record_tick_duration(uint32_t duration_us);
uint32_t pal_wasm_get_max_tick_us(void);
uint32_t pal_wasm_get_tick_overrun_count(void);
void pal_wasm_reset_wcet_stats(void);
```

- [ ] **Step 6: 编译并运行测试**

Run: `cd wink-micro-os/build &amp;&amp; make test_wcet &amp;&amp; ./test_wcet`
Expected: 2 tests PASS

- [ ] **Step 7: 集成到 JS 侧 WasmPhysicalBridge**

在 `WasmPhysicalBridge.ts` 的 `stepClock` 方法中添加计时：

```typescript
async stepClock(us: bigint): Promise&lt;void&gt; {
  const startUs = performance.now() * 1000;  // 注意：JS 精度有限，仅供参考

  this.exports.pal_wasm_step_clock(us);

  const durationUs = (performance.now() * 1000) - startUs;
  this.exports.pal_wasm_record_tick_duration(Math.floor(durationUs));

  const maxTickUs = this.exports.pal_wasm_get_max_tick_us();
  if (maxTickUs &gt; 1000) {
    console.warn(`[WCET] Tick processing exceeded 1ms. Max: ${maxTickUs}us, ` +
                 `overruns: ${this.exports.pal_wasm_get_tick_overrun_count()}`);
  }
}
```

- [ ] **Step 8: 运行 TS 侧测试**

Run: `cd simulator &amp;&amp; npx jest src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts -v`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_wasm_internal.h \
        wink-micro-os/targets/wasm/pal_wasm_physical.c \
        wink-micro-os/targets/wasm/wasm_bridge.h \
        ../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts \
        wink-micro-os/test/wasm/test_wcet.c
git commit -m "feat(wasm): add WCET tracking for tick execution time"
```

---

## Phase 2: P1 优先级 - 近期重要改进

---

### Task 6: 虚拟时钟溢出预警

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_osal_wasm.c`
- Modify: `wink-micro-os/targets/wasm/wasm_bridge.h`
- Test: `wink-micro-os/test/wasm/test_clock_overflow.c` (新建)

**Problem:** uint64_t 时钟看似可用 584 年，但 1000x 加速仿真每天可模拟 2.7 年，CI 连续运行 200 天就可能溢出。

- [ ] **Step 1: 编写失败测试**

```c
#include "unity.h"
#include "pal_wasm_internal.h"
#include &lt;stdint.h&gt;

void test_clock_64bit_static_assert(void) {
    // 编译期已验证，此处只是确认时钟类型正确
    TEST_PASS();
}

void test_clock_warning_not_fired_initially(void) {
    TEST_ASSERT_FALSE(pal_wasm_is_clock_warning_fired());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_clock_64bit_static_assert);
    RUN_TEST(test_clock_warning_not_fired_initially);
    return UNITY_END();
}
```

- [ ] **Step 2: 编译验证失败**

Run: `cd wink-micro-os/build &amp;&amp; make test_clock_overflow`
Expected: Compile error

- [ ] **Step 3: 添加静态断言和溢出预警变量**

在 `pal_osal_wasm.c` 顶部时钟变量附近：

```c
// 虚拟时钟 - 仿真时间的单一真相来源 (SSOT)
// 注意：uint64_t 最大值 = ~584 年微秒数
// 在 1000x 加速仿真下，每天可模拟 ~2.7 年，连续运行 200 天可能溢出
static uint64_t s_virtual_us;
static bool s_clock_warning_fired;

// 编译期保证时钟是 64 位
_Static_assert(sizeof(s_virtual_us) == 8, "Virtual clock must be 64-bit");

// 溢出预警阈值：292 年（50% 量程）
#define CLOCK_WARNING_THRESHOLD (UINT64_C(0x8000000000000000))
```

- [ ] **Step 4: 修改 pal_wasm_step_clock 添加预警逻辑**

```c
void pal_wasm_step_clock(uint64_t us) {
    s_virtual_us += us;

    // 溢出预警：时钟超过 292 年时触发一次警告
    // 这给了用户充足的时间在真正溢出前重置仿真环境
    if (s_virtual_us &gt; CLOCK_WARNING_THRESHOLD &amp;&amp; !s_clock_warning_fired) {
        s_clock_warning_fired = true;
        // 通过 JS 日志桥输出警告（如果已初始化）
        // 注意：这里不直接调用 JS 函数避免重入风险
        // 警告标志由 JS 侧轮询检查
    }
}
```

- [ ] **Step 5: 添加访问器函数到 pal_wasm_internal.h**

```c
/** 检查时钟溢出警告是否已触发 */
bool pal_wasm_is_clock_warning_fired(void);

/** 获取当前虚拟时钟值（用于调试） */
uint64_t pal_wasm_get_virtual_clock_us(void);
```

- [ ] **Step 6: 实现访问器函数**

在 `pal_osal_wasm.c` 底部添加：

```c
bool pal_wasm_is_clock_warning_fired(void) {
    return s_clock_warning_fired;
}

uint64_t pal_wasm_get_virtual_clock_us(void) {
    return s_virtual_us;
}
```

- [ ] **Step 7: 在 wasm_bridge.h 导出**

```c
bool pal_wasm_is_clock_warning_fired(void);
uint64_t pal_wasm_get_virtual_clock_us(void);
```

- [ ] **Step 8: 编译并运行测试**

Run: `cd wink-micro-os/build &amp;&amp; make test_clock_overflow &amp;&amp; ./test_clock_overflow`
Expected: 2 tests PASS

- [ ] **Step 9: JS 侧集成（WasmPhysicalBridge.ts）**

在 stepClock 后添加检查：

```typescript
if (this.exports.pal_wasm_is_clock_warning_fired()) {
  const clockUs = this.exports.pal_wasm_get_virtual_clock_us();
  console.warn(
    `[CLOCK] Virtual clock exceeded 292 years (${clockUs}us). ` +
    'Reset simulation soon to avoid uint64 overflow.'
  );
}
```

- [ ] **Step 10: 运行 TS 测试**

Run: `cd simulator &amp;&amp; npx jest src/unisim/worker/__tests__/WasmPhysicalBridge.test.ts -v`
Expected: All tests PASS

- [ ] **Step 11: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_osal_wasm.c \
        wink-micro-os/targets/wasm/pal_wasm_internal.h \
        wink-micro-os/targets/wasm/wasm_bridge.h \
        ../../../../wink-ai/packages/unisim/src/unisim/worker/WasmPhysicalBridge.ts \
        wink-micro-os/test/wasm/test_clock_overflow.c
git commit -m "feat(wasm): virtual clock overflow early warning system"
```

---

## Phase 3: P2 优先级 - 中期架构演进

---

### Task 7: Emscripten ABI 隐性契约文档化

**Files:**
- Modify: `wink-micro-os/targets/wasm/wasm_bridge.h` (顶部添加文档)
- Test: 无（纯文档）

**Problem:** Emscripten 有许多隐性的 ABI 约定，破坏它们会导致难以调试的运行时崩溃。

- [ ] **Step 1: 在 wasm_bridge.h 顶部添加 ABI 契约附录**

```c
// ============================================================================
//                          EMSCRIPTEN ABI 契约附录
//
// 以下是 C ↔ JS 跨语言调用的所有隐性前提假设。
// 修改任何桥接代码时，必须确保不违反这些契约。
// 违反任何一条都会导致难以调试的运行时崩溃或静默数据损坏。
// ============================================================================

/*
 * ABI 契约 #1: WASM 栈增长方向
 * -------------------------------
 * Emscripten WASM 栈是**向下增长**的（从高地址向低地址）。
 * Asyncify 展开/重绕时依赖此行为。
 * 验证：_Static_assert 检查不可行，因为栈方向是运行时属性。
 * 风险：栈溢出时会静默覆盖堆内存，无边界检查。
 * 防护：编译时指定 -s ASYNCIFY_STACK_SIZE=65536，留足余量。
 */

/*
 * ABI 契约 #2: 浮点数与 NaN 装箱
 * -----------------------------
 * - C float/double ↔ JS number: 符合 IEEE 754，安全互转
 * - C long double: 不要在桥接接口使用！Emscripten 将其降级为 double
 * - JS NaN/Infinity: 传到 C 侧是合法的 IEEE 值，但 C 侧逻辑可能没处理
 * 防护：所有桥接函数禁止使用 long double；JS 侧传入前做 isFinite 检查
 */

/*
 * ABI 契约 #3: 指针对齐要求
 * -------------------------
 * Emscripten malloc 保证 8 字节对齐。
 * - uint64_t/double 访问需要 8 字节对齐
 * - 未对齐访问在 WASM 中是**未定义行为**（实际可能静默读错值）
 * 防护：所有跨边界传递的结构体使用 __attribute__((aligned(8)))
 *       或使用 packed 结构体配合 memcpy 访问
 */

/*
 * ABI 契约 #4: EM_JS 宏展开时机
 * -----------------------------
 * EM_JS 定义的 JS 代码在**编译期**嵌入 WASM 二进制。
 * - 运行时无法动态修改
 * - 无法访问 JS 侧闭包变量，只能访问全局作用域
 * - 参数传递有开销，避免在热路径调用
 */

/*
 * ABI 契约 #5: WASM_BIGINT ABI
 * ---------------------------
 * 启用 -s WASM_BIGINT=1 后：
 * - C uint64_t/int64_t ↔ JS bigint: 精确传递，无精度损失
 * - 但如果 TS 侧误用 number 传入，Emscripten 会抛出 TypeError
 * 防护：TS 侧所有时钟/时间相关字段强制为 bigint 类型
 *       SimWorker 消息反序列化后做 runtime typeof 校验
 */

/*
 * ABI 契约 #6: Asyncify 重入限制
 * ------------------------------
 * 在 Asyncify sleeping 状态下：
 * - 不能调用任何 WASM 导出函数
 * - 不能访问 WASM 堆内存（堆内容在重绕前是不一致的）
 * - 只能调用纯 JS 侧逻辑
 * 防护：所有 JS → WASM 调用必须在 WASM 处于 running 状态
 *       使用状态机跟踪 WASM 执行状态
 */

// ============================================================================
// 契约结束，以下为正式符号声明
// ============================================================================
```

- [ ] **Step 2: 编译验证（确保注释不影响编译）**

Run: `cd wink-micro-os/build &amp;&amp; make clean &amp;&amp; make`
Expected: Compiles successfully

- [ ] **Step 3: Commit**

```bash
git add wink-micro-os/targets/wasm/wasm_bridge.h
git commit -m "docs(wasm): add Emscripten ABI contract appendix to wasm_bridge.h"
```

---

### Task 8: 故障审计日志系统

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_wasm_physical.c`
- Modify: `wink-micro-os/targets/wasm/pal_wasm_internal.h`
- Test: `wink-micro-os/test/wasm/test_fault_log.c` (新建)

**Problem:** 物理退化是黑盒，CI 测试失败时无法追溯「哪个故障在哪个时间点触发导致了后续失败」。

- [ ] **Step 1: 编写失败测试**

```c
#include "unity.h"
#include "pal_wasm_internal.h"
#include &lt;string.h&gt;

void test_fault_log_empty_initially(void) {
    pal_wasm_reset_fault_log();
    TEST_ASSERT_EQUAL_UINT32(0, pal_wasm_get_fault_log_count());
}

void test_fault_log_records_bounce_event(void) {
    pal_wasm_reset_fault_log();
    pal_wasm_log_fault(FAULT_TYPE_GPIO_BOUNCE, 5);  // pin 5

    TEST_ASSERT_EQUAL_UINT32(1, pal_wasm_get_fault_log_count());

    wasm_fault_event_t event;
    bool ok = pal_wasm_get_fault_event(0, &amp;event);
    TEST_ASSERT_TRUE(ok);
    TEST_ASSERT_EQUAL_UINT8(FAULT_TYPE_GPIO_BOUNCE, event.fault_type);
    TEST_ASSERT_EQUAL_UINT16(5, event.pin_or_bus);
    TEST_ASSERT_EQUAL_UINT32(1, event.sequence);
}

void test_fault_log_wraps_around(void) {
    pal_wasm_reset_fault_log();
    for (int i = 0; i &lt; 300; i++) {  // 超过 256 缓冲区大小
        pal_wasm_log_fault(FAULT_TYPE_I2C_DROP, 0);
    }
    TEST_ASSERT_EQUAL_UINT32(256, pal_wasm_get_fault_log_count());
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_fault_log_empty_initially);
    RUN_TEST(test_fault_log_records_bounce_event);
    RUN_TEST(test_fault_log_wraps_around);
    return UNITY_END();
}
```

- [ ] **Step 2: 编译验证失败**

Run: `cd wink-micro-os/build &amp;&amp; make test_fault_log`
Expected: Compile errors

- [ ] **Step 3: 在 pal_wasm_internal.h 定义类型和接口**

```c
// ============================================================================
// 故障审计日志系统
// 记录所有物理退化事件，用于 CI 失败时的因果链追溯
// ============================================================================

#define WASM_FAULT_LOG_SIZE 256

typedef enum {
    FAULT_TYPE_GPIO_BOUNCE = 1,
    FAULT_TYPE_I2C_DROP    = 2,
    FAULT_TYPE_I2C_NOISE   = 3,
    FAULT_TYPE_CLOCK_DRIFT = 4,
} wasm_fault_type_t;

typedef struct {
    uint64_t timestamp_us;    // 故障发生的虚拟时间
    uint8_t  fault_type;      // wasm_fault_type_t
    uint16_t pin_or_bus;      // 哪个 pin/总线发生的故障
    uint32_t sequence;        // 全局事件序号（单调递增）
} wasm_fault_event_t;

/** 重置故障日志 */
void pal_wasm_reset_fault_log(void);

/** 记录一条故障事件（环形缓冲区） */
void pal_wasm_log_fault(uint8_t fault_type, uint16_t pin_or_bus);

/** 获取已记录的故障数量 */
uint32_t pal_wasm_get_fault_log_count(void);

/** 获取指定索引的故障事件 */
bool pal_wasm_get_fault_event(uint32_t index, wasm_fault_event_t *out_event);
```

- [ ] **Step 4: 在 pal_wasm_physical.c 实现日志系统**

静态变量区添加：

```c
// 故障审计日志
static wasm_fault_event_t s_fault_log[WASM_FAULT_LOG_SIZE];
static uint32_t s_fault_log_head;   // 下一条写入位置
static uint32_t s_fault_log_count;  // 已记录总数（最大 256）
static uint32_t s_fault_sequence;   // 全局序号
```

实现函数（添加到文件底部）：

```c
// ============================================================================
// 故障审计日志实现
// ============================================================================

void pal_wasm_reset_fault_log(void) {
    memset(s_fault_log, 0, sizeof(s_fault_log));
    s_fault_log_head = 0;
    s_fault_log_count = 0;
    s_fault_sequence = 0;
}

void pal_wasm_log_fault(uint8_t fault_type, uint16_t pin_or_bus) {
    wasm_fault_event_t *evt = &amp;s_fault_log[s_fault_log_head];

    evt-&gt;timestamp_us = pal_wasm_get_virtual_clock_us();
    evt-&gt;fault_type   = fault_type;
    evt-&gt;pin_or_bus   = pin_or_bus;
    evt-&gt;sequence     = ++s_fault_sequence;

    s_fault_log_head = (s_fault_log_head + 1) % WASM_FAULT_LOG_SIZE;
    if (s_fault_log_count &lt; WASM_FAULT_LOG_SIZE) {
        s_fault_log_count++;
    }
}

uint32_t pal_wasm_get_fault_log_count(void) {
    return s_fault_log_count;
}

bool pal_wasm_get_fault_event(uint32_t index, wasm_fault_event_t *out_event) {
    if (index &gt;= s_fault_log_count) {
        return false;
    }
    // 环形缓冲区索引映射：最旧的在 (head - count) % size
    uint32_t actual_idx = (s_fault_log_head + WASM_FAULT_LOG_SIZE - s_fault_log_count + index)
                           % WASM_FAULT_LOG_SIZE;
    *out_event = s_fault_log[actual_idx];
    return true;
}
```

- [ ] **Step 5: 在故障注入点埋点**

GPIO 抖动注入处：

```c
// pal_wasm_gpio_step_bounce() 中实际发生跳变时
if (bounce_flip) {
    s_gpio_states[pin].input_level ^= 1;
    pal_wasm_log_fault(FAULT_TYPE_GPIO_BOUNCE, pin);  // 记录审计日志
}
```

I2C 丢包注入处：

```c
// pal_wasm_i2c_should_drop() 返回 true 时
pal_wasm_log_fault(FAULT_TYPE_I2C_DROP, bus_num);
```

- [ ] **Step 6: 在 wasm_bridge.h 导出访问接口**

```c
// 故障审计日志接口
uint32_t pal_wasm_get_fault_log_count(void);
bool pal_wasm_get_fault_event(uint32_t index, wasm_fault_event_t *out_event);
void pal_wasm_reset_fault_log(void);
```

注意：结构体需要被 JS 侧理解，或者提供字段级别的访问器。简化方案是提供按字段访问：

```c
uint64_t pal_wasm_fault_event_get_timestamp(uint32_t index);
uint8_t  pal_wasm_fault_event_get_type(uint32_t index);
uint16_t pal_wasm_fault_event_get_pin_or_bus(uint32_t index);
uint32_t pal_wasm_fault_event_get_sequence(uint32_t index);
```

- [ ] **Step 7: 编译并运行测试**

Run: `cd wink-micro-os/build &amp;&amp; make test_fault_log &amp;&amp; ./test_fault_log`
Expected: 3 tests PASS

- [ ] **Step 8: 运行现有 debounce/i2c 测试验证埋点**

Run: `cd wink-micro-os/build &amp;&amp; make test_debounce_middleware test_i2c_drop_middleware &amp;&amp; ./test_debounce_middleware &amp;&amp; ./test_i2c_drop_middleware`
Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_wasm_internal.h \
        wink-micro-os/targets/wasm/pal_wasm_physical.c \
        wink-micro-os/targets/wasm/wasm_bridge.h \
        wink-micro-os/test/wasm/test_fault_log.c
git commit -m "feat(wasm): fault audit log system for causal chain tracing"
```

---

## Phase 4: P3 优先级 - 长期架构预埋

---

### Task 9: 功耗模型接口预埋

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_wasm_internal.h`
- Modify: `wink-micro-os/targets/wasm/pal_wasm_physical.c` (stub 实现)
- Test: `wink-micro-os/test/wasm/test_power_model_stub.c` (新建)

**Problem:** 未来 Wave3 需要功耗-时序联合仿真，现在预埋接口可避免未来大规模重构。

- [ ] **Step 1: 编写失败测试**

```c
#include "unity.h"
#include "pal_wasm_internal.h"

void test_power_model_api_exists(void) {
    // 接口应该存在（即使是 stub 实现）
    uint64_t energy = pal_wasm_get_total_energy_mj();
    TEST_ASSERT_TRUE(energy &gt;= 0);
}

void test_power_model_pin_api_compiles(void) {
    wasm_pin_power_model_t model = {
        .active_current_ua = 1000,
        .leakage_current_ua = 10,
        .transition_energy_nj = 100
    };
    // 设置应返回 OK（即使 stub 不真正生效）
    wink_status_t status = pal_wasm_set_pin_power_model(5, &amp;model);
    TEST_ASSERT_EQUAL(WINK_OK, status);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_power_model_api_exists);
    RUN_TEST(test_power_model_pin_api_compiles);
    return UNITY_END();
}
```

- [ ] **Step 2: 编译验证失败**

Run: `cd wink-micro-os/build &amp;&amp; make test_power_model_stub`
Expected: Compile errors

- [ ] **Step 3: 在 pal_wasm_internal.h 定义类型和接口**

```c
// ============================================================================
// 功耗模型接口（Wave3 预埋）
// 接口已定义，但当前实现为 stub（无真实计算）。
// 目的：避免未来 Wave3 做功耗仿真时需要大规模重构现有故障注入管线。
// ============================================================================

/** Pin 级功耗模型参数 */
typedef struct {
    uint32_t active_current_ua;     // 有源时电流 (uA)
    uint32_t leakage_current_ua;    // 漏电流 (uA)
    uint32_t transition_energy_nj;  // 单次跳变能量 (nJ)
} wasm_pin_power_model_t;

/** 设置指定 pin 的功耗模型（stub） */
wink_status_t pal_wasm_set_pin_power_model(uint8_t pin,
                                           const wasm_pin_power_model_t *model);

/** 获取仿真启动以来的总能耗（stub） */
uint64_t pal_wasm_get_total_energy_mj(void);
```

- [ ] **Step 4: 在 pal_wasm_physical.c 实现 stub**

```c
// ============================================================================
// 功耗模型 Stub 实现（Wave3 预埋）
// 当前实现为空占位，不做真实计算。
// Wave3 实施时将在此基础上：
// 1. 跟踪每个 pin 的高低电平时长
// 2. 统计跳变次数
// 3. 按 P = I*V 公式积分计算实时功耗
// ============================================================================

wink_status_t pal_wasm_set_pin_power_model(uint8_t pin,
                                           const wasm_pin_power_model_t *model) {
    if (pin &gt;= WASM_SIM_MAX_PINS) {
        return WINK_ERR_INVALID_ARG;
    }
    if (!model) {
        return WINK_ERR_INVALID_ARG;
    }
    // Stub: 不存储参数，仅验证接口可调用
    (void)pin;
    (void)model;
    return WINK_OK;
}

uint64_t pal_wasm_get_total_energy_mj(void) {
    // Stub: 始终返回 0
    return 0;
}
```

- [ ] **Step 5: 在 wasm_bridge.h 导出接口**

```c
// 功耗模型接口 (Wave3 stub)
wink_status_t pal_wasm_set_pin_power_model(uint8_t pin,
                                           const wasm_pin_power_model_t *model);
uint64_t pal_wasm_get_total_energy_mj(void);
```

- [ ] **Step 6: 编译并运行测试**

Run: `cd wink-micro-os/build &amp;&amp; make test_power_model_stub &amp;&amp; ./test_power_model_stub`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_wasm_internal.h \
        wink-micro-os/targets/wasm/pal_wasm_physical.c \
        wink-micro-os/targets/wasm/wasm_bridge.h \
        wink-micro-os/test/wasm/test_power_model_stub.c
git commit -m "feat(wasm): power model API stubs for Wave3 forward compatibility"
```

---

### Task 10: 故障域隔离框架预埋

**Files:**
- Modify: `wink-micro-os/targets/wasm/pal_wasm_internal.h`
- Modify: `wink-micro-os/targets/wasm/pal_wasm_physical.c` (框架预埋)
- Test: `wink-micro-os/test/wasm/test_fault_domain_stub.c` (新建)

**Problem:** 当前所有故障共享全局配置，故障爆炸半径不可控。预埋域隔离框架为未来演进铺路。

- [ ] **Step 1: 在 pal_wasm_internal.h 添加域隔离类型定义**

```c
// ============================================================================
// 故障域隔离框架（Wave3 预埋）
// 支持为不同总线/外设组独立配置故障参数，控制故障爆炸半径。
// 当前实现仅支持 GLOBAL 域，为未来多域架构铺路。
// ============================================================================

typedef enum {
    WASM_FAULT_DOMAIN_GLOBAL = 0,    // 全局域（当前唯一实际生效的域）
    WASM_FAULT_DOMAIN_GPIO   = 1,    // GPIO 域（预留）
    WASM_FAULT_DOMAIN_I2C0   = 2,    // I2C 总线 0（预留）
    WASM_FAULT_DOMAIN_I2C1   = 3,    // I2C 总线 1（预留）
    WASM_FAULT_DOMAIN_SPI0   = 4,    // SPI 总线 0（预留）
    WASM_FAULT_DOMAIN_CLOCK  = 5,    // 时钟域（预留）
    WASM_FAULT_DOMAIN_COUNT
} wasm_fault_domain_id_t;

/** 故障域状态（预埋） */
typedef struct {
    uint32_t domain_id;
    bool armed;                       // 故障是否已激活
    uint32_t trigger_count;           // 统计：此域内故障已触发次数
    wasm_sim_fault_config_t config;   // 域内配置
} wasm_fault_domain_t;

/** 获取指定故障域的配置指针（Wave3 预埋） */
wasm_sim_fault_config_t *pal_wasm_get_domain_config(uint32_t domain_id);

/** 武装/解除指定故障域（Wave3 预埋） */
wink_status_t pal_wasm_arm_fault_domain(uint32_t domain_id, bool armed);

/** 获取指定故障域的触发计数 */
uint32_t pal_wasm_get_domain_trigger_count(uint32_t domain_id);
```

- [ ] **Step 2: 在 pal_wasm_physical.c 实现框架**

```c
// ============================================================================
// 故障域隔离框架实现（Wave3 预埋）
// 当前只有 GLOBAL 域实际生效，其他域为占位。
// Wave3 实施时将故障注入逻辑从全局 s_fault_config 改为按域查找配置。
// ============================================================================

static wasm_fault_domain_t s_fault_domains[WASM_FAULT_DOMAIN_COUNT];

wasm_sim_fault_config_t *pal_wasm_get_domain_config(uint32_t domain_id) {
    if (domain_id &gt;= WASM_FAULT_DOMAIN_COUNT) {
        return NULL;
    }
    // 当前所有域都返回全局配置
    // Wave3: 每个域有独立的 config 实例
    return &amp;s_fault_config;
}

wink_status_t pal_wasm_arm_fault_domain(uint32_t domain_id, bool armed) {
    if (domain_id &gt;= WASM_FAULT_DOMAIN_COUNT) {
        return WINK_ERR_INVALID_ARG;
    }
    s_fault_domains[domain_id].armed = armed;
    return WINK_OK;
}

uint32_t pal_wasm_get_domain_trigger_count(uint32_t domain_id) {
    if (domain_id &gt;= WASM_FAULT_DOMAIN_COUNT) {
        return 0;
    }
    return s_fault_domains[domain_id].trigger_count;
}

// 初始化：在 pal_wasm_init_physical() 中添加
void pal_wasm_init_domains(void) {
    memset(s_fault_domains, 0, sizeof(s_fault_domains));
    for (uint32_t i = 0; i &lt; WASM_FAULT_DOMAIN_COUNT; i++) {
        s_fault_domains[i].domain_id = i;
        s_fault_domains[i].armed = true;  // 默认所有域已激活
    }
}
```

- [ ] **Step 3: 修改故障注入点使用域框架**

```c
// 示例：GPIO 抖动注入前检查域状态
if (!s_fault_domains[WASM_FAULT_DOMAIN_GPIO].armed) {
    return;  // 域未激活，跳过故障注入
}
```

注意：当前 GLOBAL 域始终激活，此检查不改变现有行为。

- [ ] **Step 4: 编写并运行测试**

```c
#include "unity.h"
#include "pal_wasm_internal.h"

void test_domain_api_exists(void) {
    wasm_sim_fault_config_t *cfg = pal_wasm_get_domain_config(WASM_FAULT_DOMAIN_GLOBAL);
    TEST_ASSERT_NOT_NULL(cfg);
}

void test_domain_arm_works(void) {
    wink_status_t status = pal_wasm_arm_fault_domain(WASM_FAULT_DOMAIN_GPIO, false);
    TEST_ASSERT_EQUAL(WINK_OK, status);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_domain_api_exists);
    RUN_TEST(test_domain_arm_works);
    return UNITY_END();
}
```

Run: `cd wink-micro-os/build &amp;&amp; make test_fault_domain_stub &amp;&amp; ./test_fault_domain_stub`
Expected: 2 tests PASS

- [ ] **Step 5: 运行完整测试套件**

Run: `cd wink-micro-os/build &amp;&amp; make test`
Expected: All tests PASS

Run: `cd simulator &amp;&amp; npx jest --coverage`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add wink-micro-os/targets/wasm/pal_wasm_internal.h \
        wink-micro-os/targets/wasm/pal_wasm_physical.c \
        wink-micro-os/test/wasm/test_fault_domain_stub.c
git commit -m "feat(wasm): fault domain isolation framework for Wave3"
```

---

## 验收与收尾

### Task 11: 全量回归测试与文档更新

- [ ] **Step 1: 运行完整的 C 测试套件**

Run: `cd wink-micro-os/build &amp;&amp; make test`
Expected: All 10+ tests PASS

- [ ] **Step 2: 运行完整的 TS 测试套件**

Run: `cd simulator &amp;&amp; npx jest --coverage`
Expected: Coverage ≥ 90% (no regression)

- [ ] **Step 3: 验证双 target 编译**

Run: `cd wink-micro-os &amp;&amp; idf.py build` (ESP32 target)
Expected: Compiles successfully (no WASM-only code leaked to PAL)

- [ ] **Step 4: 更新设计文档**

在 `docs/tech-designs/wasm-physical-simulation.md` 中添加本次优化的摘要。

- [ ] **Step 5: 生成变更摘要 Commit**

```bash
git add docs/tech-designs/wasm-physical-simulation.md
git commit -m "docs(wasm): update wave2 physical engine optimization summary"
```

---

## 总体验收标准

| 验收项 | 通过标准 |
|--------|---------|
| 编译 | WASM/ESP32 双 target 零警告 |
| C 测试 | 所有新增 + 原有测试 100% 通过 |
| TS 测试 | 所有测试通过，覆盖率无下降 |
| 代码质量 | 无 TBD/TODO，所有关键路径有注释 |
| 可观测性 | WCET、故障日志、时钟预警接口均可调用 |
| 向前兼容 | 所有 Wave3 预埋 API 返回合理的 stub 值 |

---

## 风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 |
|-----|------|------|---------|
| WCET 统计增加 tick 开销 | 中 | 低 | JS 侧计时本身有开销，可通过编译开关禁用 |
| 故障日志内存占用 | 低 | 低 | 256 条 × 16B = 4KB，可接受 |
| ESP32 编译失败 | 中 | 高 | 每个任务后都验证 ESP-IDF 编译 |
| 预埋接口未来需要修改 | 高 | 低 | 这是预埋的预期结果，总比大规模重构好 |

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-29-wave2-physical-engine-optimizations.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
