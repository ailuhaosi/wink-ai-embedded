# Frontend Simulation Phase B — Technical Design Spec

> **Status**: Draft (2026-07-03) · **Owner**: TBD · **Supersedes**: N/A
>
> **Scope layer**: ② 技术设计规格（`docs/tech-designs/`）
> **Next step**: 由 `writing-plans` skill 拆分为
> `docs/implementation-plans/frontend/2026-07-03-frontend-simulation-phase-b-plan.md`
>
> **Related**:
> - ADR-0001 (error-code sign convention)
> - ADR-0002 (dual-target compilation)
> - ADR-0003 (DAL bypass 决策 2：仅旁路最底物理量)
> - ADR-0009 Wave 2 (wasm 退化引擎 + JS Worker 桥)
> - ADR-0013/0014 (仿真调度器 — 协作式确定性 + 单虚拟核)
> - **ADR-0019 (Wasm imports 覆盖机制 wrapper + `__async: 'auto'`) — Phase B Task 0 前置依赖**
> - `04-wasm-simulation/07-scheduler-model.md`
> - Gemini 评估：`sim_specs_deep_assessment.md`（8 大 TS 契约缺口清单）
> - Gemini 评估：`web_simulation_readiness_assessment.md`（§缺口 G1）

---

## 0. TL;DR

**目标**：为 `@wink-ai/unisim` 补齐 (1) 8 大 TS 契约类型层（编译期锁定 Wasm ABI + 项目模型 + 运行时对象契约）、(2) 将 `wink_sim_js.js` 里 13 个 `js_pal_* / js_sim_*` 桩升级为**由强类型 `WasmImports` 对象驱动的真实实现**，路由到 `PinArbiter` / `I2CBus` / `WasmInterruptQueue` / 已有的 `VirtualClock`。

**范围边界（Q1 决策）**：只做 B1（类型层）+ B2（JS 桥接实现层）。**不做** SimWorker 消息集扩展、浏览器 fetch/instantiate 胶水（→ Phase C）。

**交付物**：`@wink-ai/unisim` v0.2（npm 包内部版本号，未发布），含 SSOT 对齐 Jest 测试与 Node 端加载真 wasm 冒烟。

**时间盘子**：3–4 个工作日。

**Phase C 起步条件（本 Spec 完成后可确保）**：
- ✅ 8 大 TS 契约类型可 `import from '@wink-ai/unisim'`
- ✅ Node 端 unisim + 真 wasm 端到端跑通（`unisim_smoke.c` fixture 覆盖 13 个 imports）
- ⏳ 浏览器 instantiate 胶水 → Phase C Task 1
- ⏳ SimWorker `INIT/SET_FAULTS/...` 之外的新消息 → Phase C 按需驱动

---

## 1. Motivation

### 1.1 为什么这是 Phase C 的**编译期依赖锚点**

`sim_specs_deep_assessment.md` 指出 8 大 TS 契约缺口是前端 Vue 3 工作台唯一的编译期依赖锚点。这些类型没写，前端后面每一个组件、每一个 Worker 消息处理都会缺 TypeScript 类型 —— 到时候只能"边做边补"，AI codegen 会大量凭空生成互相不一致的 interface。

Phase B 完成后，Phase C 起步时每一个 Worker 消息、每一个虚拟外设、每一个 `sim-project.json` 字段都有 100% TS 类型安全。

### 1.2 为什么把 `wink_sim_js.js` 从 stub 升级

当前 `wink_sim_js.js` 是 Emscripten `--js-library` 注入的桩实现，头部注释明确说明"Workbench 前端只需要 `Module.js_pal_gpio_write = customImpl` 即可替换"。但 stub 语义（`gpio_read` 恒返 0、`i2c_transfer` 恒成功、`ultrasonic` 恒返 17cm）不支持任何真实仿真行为。Phase B 的 B2 层填满这块空白，且**将符号对齐从"运行时炸"提升为"编译期红线"**。

---

## 2. Scope

### 2.1 In-scope

**B1 — TS 契约类型层**（对应 `sim_specs_deep_assessment.md` 缺口，Phase B 收窄到真正被 B2 消费的 6 个类型）：

| # | 类型 | 抽象层 | 上游 SSOT | 文件 |
|---|------|--------|-----------|------|
| 1 | `WasmImports` | Wasm ABI 边界 | `wasm_bridge.h` `js_*` extern | `types/wasm/imports.ts` |
| 2 | `WasmExports`（**从 worker/ 挪入 + 全项目替换**） | Wasm ABI 边界 | `wasm_bridge.h` `pal_wasm_*` extern | `types/wasm/exports.ts` |
| 3 | `WasmInterruptQueue` | Wasm ABI 边界 | `wasm_bridge.h` poll model + `pal_irq.h` | `types/wasm/interrupt-queue.ts` |
| 4 | `I2CDevice` / `I2CBus` | 仿真运行时对象 | 无（纯 JS 侧概念） | `types/runtime/i2c.ts` |
| 5 | `FaultAuditLogEvent` | 仿真诊断 | `pal_wasm_fault_event_*` | `types/runtime/fault.ts`（events） |
| 6 | `FaultDomainControl` | 仿真故障注入 | Wave 2 fault knobs | `types/runtime/fault.ts`（control） |

**从原 spec 移除、延到 Phase C 起步时按实际 UI 需求写**（2026-07-03 决策）：
- ~~`ConnectionRouting`~~：Phase C UI/项目模型消费者才存在，无法预设正确字段
- ~~`SimulationProjectManifest`~~：`sim-project.json` schema 需 Phase C 工作台 UI 定型才能落
- ~~`PinPowerModel`~~：Wave 3 stub，"预埋空 interface" 无实际价值

（`FaultAuditLogEvent` 与 `FaultDomainControl` 在评估报告里合并为一个"故障域"缺口，此处按职责拆分为 events + control 两个 interface 放在同一文件。）

**B2 — JS 桥接实现层**：

- 新建 `bridge/createUnisimImports.ts` — `(deps: UnisimBridgeDeps) => WasmImports` 强类型工厂
- 新建 `bridge/installUnisimBridge.ts` — 把 imports 逐字段挂到 Emscripten `Module` 对象
- 将 `wink_sim_js.js` 里 13 个函数体的**实现路由**通过上述工厂对接到：
  - `PinArbiter` — `js_pal_gpio_write / js_pal_gpio_read / js_pal_pwm_set_duty`
  - `I2CBus` — `js_pal_i2c_transfer`
  - `WasmInterruptQueue` — `js_pal_register_interrupt / js_pal_deregister_interrupt / js_pal_poll_interrupt`
  - `VirtualClock` — `js_pal_os_get_ms / js_pal_os_get_us / js_pal_os_sleep_ms / js_pal_os_busy_wait_us`
  - `js_sim_trigger_ultrasonic / js_sim_measure_echo_pulse_us`：**Phase B 不做适配**，走 `wink_sim_js.js` 默认桩（返 1000us ≈ 17cm）；Phase C 再实现从 `PinArbiter` 边沿事件推导

**注意**：`wink_sim_js.js` 由 **Phase B Task 0**（前置改造，ADR-0019）改为 wrapper 模式（每个符号先查 `Module.js_*` 覆盖，未命中跑默认桩）+ `__async: 'auto'`（sleep_ms / busy_wait_us 的 Asyncify 语法修正）。改造后 wink-micro-os 独立编译 smoke 继续通过（wrapper 未命中时走默认桩），Workbench 通过 `installUnisimBridge(Module, imports)` **在 factory config 或 post-factory 给 `Module.js_*` 赋值** 完成覆盖。**Task 0 是 Phase B 主体 B1/B2 的强制前置**——ADR-0019 spike 已证明现状代码下 (1) `Module.js_*` 覆盖机制无效、(2) `__async: true` 使 Asyncify 从未真正生效。

**测试**（Q5 决策）：
- B1：`tsc --noEmit` + type-level assertion + SSOT 对齐 Jest 测试
- B2：`createUnisimImports` 单元测试（mock deps）+ Node 加载真 wasm 冒烟（新 fixture）

### 2.2 Out-of-scope（明确不做）

- ❌ SimWorker 消息集扩展（除当前 6 个消息类型 INIT / SET_FAULTS / STEP_CLOCK / SET_GPIO_IDEAL / READ_GPIO_DEGRADED / TEST_I2C_TRANSFER 之外）
- ❌ 浏览器端 fetch + instantiate 胶水、Playwright/index.html smoke
- ❌ Vue 3 工作台 UI（Phase C）
- ❌ codegen 从 `wasm_bridge.h` 自动生成 TS 类型（Q2 已否，符号规模够大再做）
- ❌ `js_pal_os_sleep_ms` 的挂起机制**重新选型**——保持现状 Asyncify + Promise（见 §5.3）

---

## 3. Design Decisions（决策记录）

按 brainstorming 五轮 Q&A 定型：

### Q1 — 范围边界 → **B（B1 + B2）**

3–4 天单一 Phase，交付 `@wink-ai/unisim` v0.2。B3（Worker 消息集）与 B4（浏览器胶水）作为独立"跟随需求走"的后续工作放到 Phase C。

### Q2 — 注入模型 → **B（显式 `WasmImports` 对象 + `--js-library` 保留）**

选择 `createUnisimImports(deps): WasmImports` 强类型工厂 + `installUnisimBridge(Module, imports)` 粘合。理由：
- `WasmImports` 是强类型对象，工厂返回值必须实现该接口 —— **漏一个函数编译期就报错**
- 单元测试可直接构造 imports 传给 mock module
- 符号对齐从"运行时炸"提前到"编译期红线"
- 保留现有 `wink_sim_js.js` 作 fallback，wink-micro-os 独立编译 smoke 不受影响

**前置依赖（ADR-0019）**：Task 0 先将 `wink_sim_js.js` 改造为 wrapper 模式（每个符号查 `Module.js_*`）+ `__async: 'auto'` 修正。ADR-0019 spike 已证实：
- 现状代码下 `Module.js_* = fn` 覆盖**无效**（library 硬编码默认桩，Module 属性不被 wasm-loader 感知）
- 现状代码 `__async: true` **不触发** Asyncify wrap（emcc 6.x 只识别 `'auto'`），项目 Asyncify 从未真正生效
- Wrapper + `'auto'` 后 `installUnisimBridge(Module, imports)` 才能在 factory config / post-factory 生效
- Host 覆盖 sleep/busy_wait **必须返回 Promise**——TS `WasmImports.js_pal_os_sleep_ms: Promise<void>` 是唯一编译期防线（sync 返回值触发 Asyncify 死循环无诊断）

### Q3 — 虚拟时钟推进策略 → **B（VirtualClock + 显式 tick 推进）**

复用已有的 `../../../../wink-ai/packages/unisim/src/unisim/core/VirtualClock.ts`（bigint-only）。SimWorker 外部驱动 `advance(us: bigint)`。`js_pal_os_get_us / _get_ms` 直读时钟；`js_pal_os_sleep_ms` 保持 Asyncify（见 §5.3）。

### Q4 — 类型组织 → **B（按抽象层分子目录）**+ **SSOT 对齐测试**

目录：`types/wasm/` + `types/runtime/` + `types/project/`。SSOT 对齐用一个 Jest test 解析 `wasm_bridge.h` 符号，对比 `keyof WasmImports` / `keyof WasmExports`，不一致 fail。

### Q5 — 测试策略 → **B + 新增 `unisim_smoke.c` fixture**

Node 端加载真 wasm，`unisim_smoke.c` 追求 13 个 imports 全覆盖（每个至少被调一次）。

---

## 4. Architecture

### 4.1 目录结构（新增 / 变更）

```
../../../../wink-ai/packages/unisim/src/unisim/
├── core/                                 (已存在)
│   ├── VirtualClock.ts                  ★ Q3 复用 + §5.3 加 sleep(ms) + pending 队列
│   ├── pin-arbiter.ts                   ★ B2 消费者
│   ├── peripheral-registry.ts           (已存在)
│   └── __tests__/
├── types/                                (已存在，扩容)
│   ├── logic-types.ts                    (已存在)
│   ├── peripheral-types.ts               (已存在)
│   ├── wasm/                            ★ 新增子目录
│   │   ├── imports.ts                   ★ B1-1 WasmImports
│   │   ├── exports.ts                   ★ B1-2 从 worker/WasmPhysicalBridge.ts 挪入（全项目一次替换 import 路径，不留 re-export）
│   │   └── interrupt-queue.ts           ★ B1-3 WasmInterruptQueue
│   ├── runtime/                         ★ 新增子目录
│   │   ├── i2c.ts                       ★ B1-4 I2CDevice / I2CBus
│   │   └── fault.ts                     ★ B1-5/6 FaultAuditLogEvent + FaultDomainControl
│   └── (types/project/ 从 Phase B 移除；Phase C 起步时按 UI 需求写)
├── bridge/                               ★ 新增目录（B2）
│   ├── createUnisimImports.ts           ★ 强类型工厂
│   ├── installUnisimBridge.ts           ★ Module 粘合
│   ├── I2CBus.ts                        ★ B2 运行时对象（简版，Phase C 会扩）
│   ├── InterruptQueue.ts                ★ B2 poll 队列实现
│   └── __tests__/
│       ├── createUnisimImports.test.ts  ★ Q5 单元测试
│       └── nodeSmoke.test.ts            ★ Q5 Node 加载真 wasm 冒烟
│   (UltrasonicChannel.ts 从 Phase B 移除；js_sim_* 走 wink_sim_js.js 默认桩)
├── worker/                               (已存在)
│   ├── SimWorker.ts                     (不改)
│   ├── WasmPhysicalBridge.ts            ★ 删除本地 WasmExports 声明，改 import 自 types/wasm/exports.ts
│   └── __tests__/
└── __tests__/
    └── ssotAlignment.test.ts            ★ 新增：Q4 SSOT 对齐

wink-micro-os/targets/wasm/
├── wasm_bridge.h                        (不改，SSOT)
├── wink_sim_js.js                       (ADR-0019 已改造为 wrapper + 'auto'，Phase B 主体不再动)
└── samples/                              (或类似位置，视现有结构)
    └── unisim_smoke.c                   ★ 新增 fixture（B2 全覆盖测试）
```

### 4.2 数据流

```
                          ┌──────────────────────────┐
                          │ SimWorker (unchanged)    │
                          │ 6 msg types              │
                          └──────────┬───────────────┘
                                     │ owns
             ┌───────────────────────┼────────────────────────┐
             │                       │                        │
             ▼                       ▼                        ▼
       VirtualClock              PinArbiter               I2CBus
       (bigint)                  (existing)               (new, Phase B)
             │                       ▲                        ▲
             │ advance(us)           │                        │
             ▼                       │                        │
      ┌──────────────────────────────┴────────────────────────┴───┐
      │        createUnisimImports(deps): WasmImports              │  ← B2 工厂
      │  { deps: { clock, arbiter, i2cBus, irqQ, ultra } }         │
      │                                                            │
      │  returns typed object implementing all 13 js_* imports:    │
      │    js_pal_gpio_write   -> arbiter.setIdeal(pin, level)     │
      │    js_pal_gpio_read    -> arbiter.readDegraded(pin)        │
      │    js_pal_pwm_set_duty -> arbiter.setPwm(ch, duty)         │
      │    js_pal_i2c_transfer -> i2cBus.transfer(...)             │
      │    js_pal_register_interrupt   -> irqQ.register(...)       │
      │    js_pal_deregister_interrupt -> irqQ.deregister(...)     │
      │    js_pal_poll_interrupt       -> irqQ.pop(...)            │
      │    js_pal_os_sleep_ms          -> clock.sleep(ms)          │
      │    js_pal_os_busy_wait_us      -> clock.sleep(us/1000)     │
      │    js_pal_os_get_ms            -> clock.getMs()            │
      │    js_pal_os_get_us            -> clock.getUs()            │
      │    js_sim_trigger_ultrasonic   -> ultra.trigger(pin)       │
      │    js_sim_measure_echo_pulse_us -> ultra.measureUs(pin)    │
      └────────────────────────────────┬──────────────────────────┘
                                       │
                        installUnisimBridge(Module, imports)
                                       │
                                       ▼
                          ┌───────────────────────────┐
                          │ Emscripten Module object  │
                          │ (覆盖 wink_sim_js.js 桩)  │
                          └───────────────────────────┘
                                       ▲
                                       │ instantiate
                          ┌────────────┴──────────────┐
                          │ wink_sim.wasm             │
                          │ (unchanged, 由 wasm-      │
                          │  bridge.h 定义符号集)     │
                          └───────────────────────────┘
```

### 4.3 关键接口

**`WasmImports`**（`types/wasm/imports.ts` 骨架）：

```typescript
/** JS 侧必须提供的所有 wasm imports，SSOT 见 wasm_bridge.h。 */
export interface WasmImports {
  // PAL HAL
  js_pal_gpio_write(pin: number, level: boolean): void;
  js_pal_gpio_read(pin: number): boolean;
  js_pal_pwm_set_duty(channel: number, duty: number): void;   // duty 是 0-100 百分比（对齐 C 侧 float duty_cycle_percent）
  js_pal_i2c_transfer(
    port: number, addr: number,
    wbuf: number, wlen: number,       // wasm 线性内存指针
    rbuf: number, rlen: number
  ): boolean;

  // 中断桥 poll 模型
  js_pal_register_interrupt(pin: number, cbIdx: number, argPtr: number): void;
  js_pal_deregister_interrupt(pin: number): void;
  js_pal_poll_interrupt(outCbPtr: number, outArgPtr: number): boolean;

  // PAL OSAL（bigint 返回值来自 WASM_BIGINT=1）
  //
  // ⚠️ P0（ADR-0019 §落地规则 4）：sleep_ms / busy_wait_us 覆盖实现
  // 必须返回 Promise。返回同步值触发 Asyncify unwind→rewind 死循环，
  // 无编译期或运行时诊断。此处 `Promise<void>` 是唯一防线，实现方必须
  // `async () => {}` 或显式 `return new Promise(...)`。
  js_pal_os_sleep_ms(ms: number): Promise<void>;        // Asyncify
  js_pal_os_busy_wait_us(us: number): Promise<void>;    // Asyncify
  js_pal_os_get_ms(): bigint;
  js_pal_os_get_us(): bigint;

  // DAL bypass（ultrasonic 物理量旁路）
  js_sim_trigger_ultrasonic(trigPin: number): void;
  js_sim_measure_echo_pulse_us(trigPin: number): number;
}
```

**`UnisimBridgeDeps`**（`bridge/createUnisimImports.ts`）：

```typescript
export interface UnisimBridgeDeps {
  clock: VirtualClock;
  arbiter: PinArbiter;
  i2cBus: I2CBus;
  irqQueue: InterruptQueue;
  ultrasonic: UltrasonicChannel;
  /** 用于 i2c_transfer 从 wasm 堆读写 buffer。将 wasm ptr + len 映射到 Uint8Array。 */
  memoryView: () => Uint8Array;
}

export function createUnisimImports(deps: UnisimBridgeDeps): WasmImports;
```

### 4.4 SSOT 对齐测试（Q4）

`__tests__/ssotAlignment.test.ts` 的检查算法：

1. 读取 `wink-micro-os/targets/wasm/wasm_bridge.h`
2. 用正则匹配 `extern\s+\w[\w\s\*]*\s+(js_\w+)\s*\(` → 得到 imports 符号集
3. 用正则匹配 `extern\s+\w[\w\s\*]*\s+(pal_wasm_\w+)\s*\(` → 得到 exports 符号集
4. `keyof WasmImports` / `keyof WasmExports` 通过 TS 反射（`ts-morph` 或简单模块导入）
5. `expect(setDiff).toEqual([])`，diff 非空则打印差集并 fail

**已知限制**：正则解析不处理 `#if` 条件编译分支。当前 `wasm_bridge.h` 没有条件符号，若未来引入需加白名单机制。

---

## 5. Component Details

### 5.1 `I2CBus`（`bridge/I2CBus.ts`）

**职责**：路由 `js_pal_i2c_transfer(port, addr, wbuf, wlen, rbuf, rlen)` 到已注册的 `I2CDevice`。

**Phase B 最小实现**：
- 支持 `register(port, addr, device)` / `unregister(port, addr)`
- `transfer(...)` 查找命中的 device，读 wasm 堆 wbuf，调用 `device.onTransfer(writeBytes)`，把返回的 read bytes 写回 wasm 堆 rbuf
- 未注册地址 → 返 `false`（NACK），与 `wink_sim_js.js` stub 语义不同（stub 恒返 true），是**符合真机行为**的升级

**Phase C 会扩**：多设备同 addr 冲突处理、拉高/丢包故障注入路径。

### 5.2 `InterruptQueue`（`bridge/InterruptQueue.ts`）

**职责**：实现 poll 模型 FIFO 队列。

- `register(pin, cbIdx, argPtr)` / `deregister(pin)` — 存储 pin → (cbIdx, argPtr) 映射
- `push(pin)` — `PinArbiter` 检测到边沿触发时调用，若 pin 已注册则 enqueue (cbIdx, argPtr)
- `pop(outCbPtrs, outArgPtrs)` — 供 `js_pal_poll_interrupt` 使用，写 wasm 堆并返 `true` / `false`

**队列容量**：与 `pal_wasm_internal.h` FIFO 容量对齐（后续 Task 阶段核对具体数字），溢出策略：drop-oldest + `console.warn`（与 C 侧一致）。

### 5.3 `VirtualClock.sleep()` 与 Asyncify

**决策**：**保持现状 Asyncify**，不重新选型。**ADR-0019 spike #7 已验证虚拟时钟 sleep 通路可用**（`setImmediate` 外部推进虚拟时钟 + resolve Promise → Asyncify rewind → wasm 侧 `getMs()` 返回精确虚拟时间）。

**前置条件（Task 0 完成后）**：`wink_sim_js.js` 中 `js_pal_os_sleep_ms__async` 已从 `true` 改为 `'auto'`，Asyncify 才会真正 wrap Promise 返回值。ADR-0019 §背景说明这是既存 bug——项目 Asyncify 之前从未真正生效。

Phase B 只需让新 imports 保持该合约（Promise 返回值），把 `resolve` 时机从 `setTimeout(ms)` 改为**虚拟时钟推进到 wake_at**：

```typescript
class VirtualClock {
  // ...existing bigint API...

  private pending: Array<{ wakeAt: bigint; resolve: () => void }> = [];

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.pending.push({ wakeAt: this.us + BigInt(ms) * 1000n, resolve });
    });
  }

  advance(us: bigint): void {
    // ...existing增量...
    // 触发所有到期 pending
    for (const p of this.pending.filter(p => p.wakeAt <= this.us)) p.resolve();
    this.pending = this.pending.filter(p => p.wakeAt > this.us);
  }
}
```

**风险**：Asyncify unwind → rewind 循环在 Node 主线程会 starve 掉外部 setTimeout（`wink_sim_js.js` 头部已警告）。Phase B 冒烟测试沿用 Wave 2 的 worker_thread 隔离方案，不引入新问题。

**关于 `VirtualClock.sleep` 是否属于"重新设计"**：属于**在既有类上加方法**，不改现有 `us/advance/getUs/getMs/reset` 语义，向后兼容。Wave 2 相关代码（如 `WasmPhysicalBridge`）无需改动。

### 5.4 `UltrasonicChannel`（`bridge/UltrasonicChannel.ts`）

**职责**：`js_sim_*` 是 ADR-0003 决策 2 的 DAL bypass —— 只旁路最底物理量。

**Phase B 最小实现**：
- `trigger(pin)` — 记录 trigger 时间戳
- `measureUs(pin)` — 从注册的"距离常量"或 fault 域读取 → 返 echo 脉宽（微秒）
- Phase C 会替换为"从 `PinArbiter` GPIO 边沿事件推导"，此处保持**语义等价于 wink_sim_js.js stub**（默认返 1000us ≈ 17cm），但通过强类型工厂路由，让 Workbench 可注入自定义 driver

---

## 6. Testing Strategy

### 6.1 Type-level（B1）

- `tsc --noEmit` 全绿
- SSOT 对齐 Jest test（§4.4）
- 对每个新 interface 至少一个 `expectType<>` 断言（`tsd` 或手写 type assertion）

### 6.2 Unit（B2）

- `createUnisimImports.test.ts`：注入 mock deps，逐个调用 13 个 imports，断言 mock 收到正确参数
- `I2CBus.test.ts` / `InterruptQueue.test.ts` / `UltrasonicChannel.test.ts`：各自单元覆盖

### 6.3 Integration（B2，Node smoke）

**新 fixture `wink-micro-os/targets/wasm/samples/unisim_smoke.c`**：

- 一个极小的 `main()`（或 `pal_wasm_boot()` 后被调）
- 显式调用每个 `js_pal_* / js_sim_*` 一次，覆盖 13/13
- 走完 GPIO write / read / PWM / I2C 一次 transfer（含 read 读回）/ interrupt register+deregister+poll / sleep / busy_wait / get_ms / get_us / ultrasonic trigger+measure
- 编译为独立 `unisim_smoke.wasm`（或作为现有构建 target 的附加 sample，视 CMake 结构决定）

**测试 `nodeSmoke.test.ts`**：
- 加载 `unisim_smoke.wasm`
- 构造真实 `VirtualClock / PinArbiter / I2CBus / InterruptQueue / UltrasonicChannel`
- `installUnisimBridge(Module, createUnisimImports(deps))`
- 调用入口，断言 13 个 imports 均被调用 + 各 dep 状态符合预期

**验收**：
- SSOT 对齐测试绿
- fixture smoke 绿
- 覆盖率工具确认 13 个 imports 全触及（非严格 coverage 阈值，仅作 sanity check）

---

## 7. Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| **ADR-0019 Task 0 修复 `__async: 'auto'` 后暴露既有 sample 隐藏 bug**（旧代码在"sleep 立即返回"错误前提下跑绿） | Medium | Task 0 独立 PR；重编后跑 `dual_task_demo` / `avoidance_car` / `oled_dashboard`，任何超时或行为变化按"修复正确行为暴露的既存缺陷"处理，不算回归 |
| SSOT 对齐正则 miss 边界情况（多行函数签名、宏展开） | Medium | 用 `wasm_bridge.h` 当前实际内容做 golden test；引入 `#if` 时加白名单 |
| Asyncify 与新 `VirtualClock.sleep` 的 pending 队列在快进/暂停时行为异常 | Medium | 在 `createUnisimImports.test.ts` 覆盖：`sleep(100)` + `advance(50)` → 未 resolve；再 `advance(50)` → resolve |
| `unisim_smoke.c` 编译进现有 wink-micro-os target 造成 CMake 依赖膨胀 | Low | 单独 target `unisim_smoke`，不进 dual_task_demo 之类现有产物；仅 CI 与 Phase B 测试消费 |
| `I2CBus` / `InterruptQueue` 在 Phase B 落一版后，Phase C 想扩故障注入时 API 需要动 | Medium | Phase B 只暴露最小 surface；`FaultDomainControl` 类型层预留，实现放 Phase C |
| `WasmExports` 从 `worker/WasmPhysicalBridge.ts` 挪走一次替换 import 路径漏改 | Low | grep 全项目 `WasmExports` 引用并逐一改成 `import from 'types/wasm/exports'`；PR 里贴 grep 结果作为审计线索；不留 re-export |

---

## 8. Open Questions

（澄清阶段已收敛完，此处留给实施阶段发现的问题）

- **`WasmImports` 中 `js_pal_i2c_transfer` 的 buffer 传递**：wasm 侧传的是 ptr+len，TS 侧要通过 `memoryView()` 访问 Emscripten heap。要不要在 `WasmImports` 类型层就用 `Uint8Array` 抽象掉指针？—— **决定：不抽象，保持 ptr+len 对齐 C ABI**，`createUnisimImports` 内部做转换。理由：抽象后 SSOT 对齐测试无法直接对比 header 签名。

- **`unisim_smoke.c` 是放 `samples/` 还是新建 `test-fixtures/`**：Task 阶段决定，取决于现有 CMake target 组织。

---

## 9. Success Criteria

Phase B 完成的定义：

- [x] **Task 0（ADR-0019 前置）已合入**：`wink_sim_js.js` 改为 wrapper + `__async: 'auto'`；`wink_sim_stub.js` 补真时序 smoke 绿（2026-07-03 完成，见 ADR-0019 底部日志）
- [x] 6 个新 TS 类型文件（`types/wasm/*` 3 + `types/runtime/*` 2 + JSDoc 完整；`types/project/*` 3 项延到 Phase C）
- [x] `types/wasm/exports.ts` 承接原 `worker/WasmPhysicalBridge.ts` 的 `WasmExports` 定义；**全项目 import 路径一次替换**，PR 里附 grep 审计（不留 re-export）
- [x] `bridge/` 目录 4 个新文件（`createUnisimImports` + `installUnisimBridge` + `I2CBus` + `InterruptQueue`；`UltrasonicChannel.ts` 从 Phase B 移除，走默认桩）
- [x] `VirtualClock` 新增 `sleep(ms)` 方法 + pending 队列，不破坏现有 API
- [x] SSOT 对齐 Jest test 绿（`keyof WasmImports/Exports` 与 `wasm_bridge.h` 完全一致）
- [x] `unisim_smoke.c` fixture 编译产物（独立 CMake target）+ Node smoke test 绿
- [x] `../../../../wink-ai/packages/unisim/src/unisim` `tsc --noEmit` 全绿
- [x] 现有 Wave 2 相关测试（`WasmPhysicalBridge.test.ts` 等）保持绿（挪家 + import 替换后仍应通过）

---

## 10. Follow-ups（不进 Phase B）

- Phase C Task 1：浏览器端 fetch + instantiate 胶水（消费 Phase B 的 `installUnisimBridge`）
- Phase C 按需扩：SimWorker 消息集（新 msg types 消费 `SimulationProjectManifest` / `FaultDomainControl`）
- Wave 3：`PinPowerModel` 从预埋类型升级为实际接线（配合 `pal_wasm_set_pin_power_model` 真实实现）
- 长期：符号规模 >50 后评估 `wasm_bridge.h` → TS codegen（Q2 曾否）
