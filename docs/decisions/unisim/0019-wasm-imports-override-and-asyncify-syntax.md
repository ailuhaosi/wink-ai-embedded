# ADR-0019：Wasm imports 覆盖机制（wrapper 模式）与 Asyncify `__async` 语法修正

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-03（提议），2026-07-03（采纳） |
| 触发 | Phase B 技术设计评审 P0 #1 spike（[frontend-simulation-phase-b-spec.md](../../tech-designs/frontend/frontend-simulation-phase-b-spec.md) §Q2 假设"Module.js_* 覆盖 wink_sim_js.js stub"未验证）——spike 同时发现既存 `__async: true` 语法在 emcc 6.x 下失效，Asyncify 从未真正生效 |
| 影响范围 | `wink-micro-os/targets/wasm/wink_sim_js.js`（改造）、`wink_sim_stub.js`（补真时序验证）、`04-wasm-simulation/01-wasm-sandbox-lifecycle.md` §2.2.2 & §2.2 说明段、Phase B `installUnisimBridge` 落地形式 |
| 决策者 | 架构委员会 & 用户 |
| 关联评审 | 2026-07-03 Wasm imports override spike（本 ADR 附件） |
| 关联技术设计 | [frontend-simulation-phase-b-spec.md](../../tech-designs/frontend/frontend-simulation-phase-b-spec.md) |
| 关联既有 ADR | [ADR-0002 双 target 同源编译](0002-dual-target-compilation.md), [ADR-0003 DAL bypass](0003-dal-bypass-scope.md), [ADR-0009 物理退化](0009-physical-behavior-simulation-fault-injection.md), [ADR-0013 协作式调度器](0013-sim-cooperative-scheduler.md) |
| 关联设计规范 | [01-wasm-sandbox-lifecycle.md §2.2](../../design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md#22-emscripten-asyncify-协程挂起机制)（已回写 §2.2 契约段 + §2.2.2 wrapper/Promise 说明） |

---

## 背景（Context）

Phase B 技术设计（`frontend-simulation-phase-b-spec.md`）依赖两个"看起来对"但**从未经过 spike 验证**的机制假设：

### 假设 1：Module.js_* 覆盖 wink_sim_js.js 默认桩

`wink_sim_js.js:15-18` 与 `01-wasm-sandbox-lifecycle.md §2.2.2` 均声明：*"Workbench 前端未来只需要 `Module.js_pal_gpio_write = customImpl` 即可替换本文件的默认实现"*。Phase B `installUnisimBridge(Module, imports)` 的整个注入模型建立在此说法上。

同时 `wink_sim_js.js:11-13` 的**前半段**又说：*"通过 `Module.js_*` 顶层挂 property 不会被 wasm-loader wire —— 生成的 glue 会直接 abort"*。**两句话互相矛盾**，谁也没验过。

### 假设 2：`__async: true` 使 emcc 自动用 Asyncify 包装 import

`wink_sim_js.js:29, 37, 42` 使用 `js_pal_os_sleep_ms__async: true` + `js_pal_os_busy_wait_us__async: true`，头部注释声称 *"告诉 emscripten 这个 import 返回 Promise，emcc 会自动用 `Asyncify.handleAsync` 包装它"*。设计规范 §2.2.2 同样这样说。

### Spike 结论（2026-07-03，`D:\tmp\spike_override\` 5 组 harness）

**Spike 结果矩阵**：

| # | 配置 | 结果 |
|---|------|------|
| 1 | `--js-library` 默认桩，`Module.js_probe = fn`（post-factory） | ❌ 默认仍生效 |
| 2 | `--js-library` 默认桩，`SpikeModule({ js_probe: fn })`（config-object） | ❌ 默认仍生效 |
| 3 | `--js-library` 默认桩 + `instantiateWasm` hook 手动 patch `imports.env` | ✅ 覆盖生效 |
| 4 | Library 里改成 `function(x){ return (Module.js_probe \|\| default)(x) }` wrapper + `Module.js_probe = fn` | ✅ 覆盖生效（config-object 与 post-factory 都可） |
| 5 | `__async: true` + `Promise` 返回值 | ❌ wasm 侧 sleep(50) 立即返回，delta≈4ms（未挂起） |
| 6 | `__async: 'auto'` + `Promise` 返回值 | ✅ delta≈62ms（真正挂起 rewind） |
| 7 | wrapper + `__async: 'auto'` + virtual-clock override（setImmediate 推进时钟 + resolve Promise） | ✅ delta=50（虚拟时间精确）—— Phase B §5.3 想要的形态 |
| 8 | Host 覆盖忘返回 Promise（`return undefined`） | ⚠️ Asyncify 陷入 unwind→rewind 死循环，main 剩余代码被反复执行 3 次，**无编译期或运行时 diagnostic** |

Spike 用 emcc 6.0.1 + Node 22.22.2 + `MODULARIZE=1 ASYNCIFY=1 ASYNCIFY_STACK_SIZE=65536 WASM_BIGINT=1`（与项目实际配置一致）。

**核对 emcc 源码** `src/jsifier.mjs:482`：`handleAsyncFunction` 只在 `library[symbol + '__async'] === 'auto'` 时应用 Asyncify wrap，`true` 只是元数据标记。

### 两个假设的真实状态

| 假设 | 现状代码 | 真实行为 |
|------|---------|---------|
| Module.js_* 覆盖 | `js_pal_gpio_write: function (pin, level) {}` 硬编码 | ❌ 覆盖无效，运行时给 `Module.js_*` 赋值仅在 Module 对象上加属性，wasm 侧不看 |
| `__async: true` 自动 Asyncify wrap | `js_pal_os_sleep_ms__async: true` | ❌ **未 wrap**，Promise 被丢弃，wasm 侧 sleep 立即返回。项目 Asyncify **从未真正生效**——已存在但从未暴露的 bug |

`wink_sim_stub.js` 只验 `onRuntimeInitialized` + 200ms 存活，从未测过"C 侧 sleep(N) 真的休眠 N ms"——这就是为什么 bug 一直没被发现。

---

## 方案比选（Options）

### 选项 A：仅修复 `__async: 'auto'`，保留 stub 语义并放弃"运行时覆盖"承诺

- **做法**：`__async: true` → `__async: 'auto'`；删除 `wink_sim_js.js` 头部与 §2.2.2 里所有"Workbench 只需 `Module.js_* = fn` 即可覆盖"承诺；Phase B `installUnisimBridge` 改走 `instantiateWasm` hook（spike 结果 #3）。
- **优点**：
  - `wink_sim_js.js` 改动最小（只改 2 行 `__async` 值）。
  - 覆盖机制走 emcc 官方 hook，语义清晰、无 wrapper 运行时开销。
- **缺点**：
  - Workbench 侧必须写 ~30 行 `instantiateWasm` glue（读 wasm 字节 → patch `imports.env` → `WebAssembly.instantiate` → `receive()`）。单元测试构造 Module 也麻烦。
  - 设计规范 §2.2.2 大段说明失效，需要重写。
  - `wink_sim_js.js` 从"运行时覆盖点"降级为"仅 fallback 默认"，语义不清楚——既然 Workbench 走 hook 直接提供 imports，wink_sim_js.js 的存在意义只剩独立 smoke，会有"这文件到底给谁看的"的困惑。

### 选项 B：Wrapper 模式 + `__async: 'auto'`（推荐）

- **做法**：
  1. `wink_sim_js.js` 每个符号改写为 wrapper：`function(...) { if (typeof Module.js_xxx === 'function') return Module.js_xxx(...); /* 默认桩 */ }`
  2. `__async: true` → `__async: 'auto'`（sleep_ms + busy_wait_us 两处）
  3. 头部注释重写，明确"覆盖机制 = 在 Module config 或 post-factory 给 `Module.js_*` 赋值；wrapper 已在 library 内查 Module"
  4. `wink_sim_stub.js` 补真时序 smoke（sleep(50) 断言 delta ∈ [40, 200] ms）
  5. 强调 host 覆盖 sleep/busy_wait 时**必须返回 Promise**（TS `WasmImports` 类型约束是唯一防线）
- **优点**：
  - `wink_sim_js.js` 兑现原承诺，头部注释与实际行为一致。
  - Workbench 覆盖只需 1 行 `Module.js_xxx = fn`（无 hook 样板代码），单元测试友好。
  - fallback 语义保留——独立 smoke（`wink_sim_stub.js`）零改动继续用默认桩。
  - Phase B `installUnisimBridge(Module, imports)` §4.1 数据流保持不变，只需澄清"在 factory config 或 post-factory 完成挂接"。
- **缺点**：
  - 13 个符号每次 wasm→JS 调用增加一次 `typeof Module.js_xxx === 'function'` 检查（微秒级，wasm 边界调用本身 ~µs 数量级，占比 <5%）。
  - Wrapper 有 13 处样板代码；未来加符号也要写 wrapper。可用一个 `wrapImport(name, defaultImpl)` 辅助减少重复，但引入更多 emscripten library-scope 依赖，不划算——13 处样板可接受。

### 选项 C：全面走 `-sMODULARIZE=1` + custom `wasmImports` config（Emscripten 官方新推路径）

- **做法**：放弃 `--js-library`，让 host 通过 Module 配置直接提供完整 `wasmImports`。
- **优点**：Emscripten 官方长期方向。
- **缺点**：
  - 破坏性最大——现有 `wink_sim_stub.js`、`wink_sim_js.js` 全部作废。
  - Workbench 必须提供全部 13 个符号，无 fallback 概念。
  - 独立 wasm smoke 失去手段（node 侧没有默认桩就跑不起来），需要另写 fallback 层。
  - 与 Phase B `installUnisimBridge(Module, imports)` 语义不冲突，但侵入面翻倍。

---

## 决策结论（Decision）

采纳 **选项 B**（Wrapper 模式 + `__async: 'auto'`）。

### 落地规则

#### 1. `wink_sim_js.js` wrapper 模式

每个 import 符号改写为：

```javascript
addToLibrary({
    js_pal_gpio_write: function (pin, level) {
        if (typeof Module !== 'undefined' && typeof Module.js_pal_gpio_write === 'function') {
            return Module.js_pal_gpio_write(pin, level);
        }
        // 默认桩语义保持不变
    },
    // ... 13 个符号同样处理
});
```

#### 2. Asyncify 符号语法修正

```javascript
// ❌ 原语法（无效，emcc 6.x 不识别）
js_pal_os_sleep_ms__async: true,

// ✅ 正确语法
js_pal_os_sleep_ms__async: 'auto',
```

**仅** `js_pal_os_sleep_ms` 与 `js_pal_os_busy_wait_us` 两个符号需要 `'auto'`（对应 `ASYNCIFY_IMPORTS` 列表）。

#### 3. 覆盖机制契约（面向 Workbench / Phase B）

Host 覆盖只需在 Emscripten factory config 或 post-factory instance 上赋值：

```typescript
// 方式 A：factory config
const Module = await WasmSandbox({
  js_pal_gpio_write: (pin, level) => postToUI({ type: 'gpio', pin, level }),
});

// 方式 B：post-factory（必须在 wasm 首次调用该 import 前完成）
const Module = await WasmSandbox({});
Module.js_pal_gpio_write = (pin, level) => postToUI(...);
```

**两种方式在 wrapper 模式下等价**，因 wrapper 每次调用都查 `Module.js_*`。

#### 4. Asyncify 覆盖的 Promise 契约

Host 覆盖 `js_pal_os_sleep_ms` / `js_pal_os_busy_wait_us` 时**必须返回 Promise**。返回同步值（`undefined` / 数字 / 字符串）会导致 Asyncify 陷入 unwind→rewind 死循环（spike #8），**无任何编译期或运行时诊断**。

**唯一防线**：Phase B `types/wasm/imports.ts` 的 `WasmImports` 接口把这两个符号标为 `Promise<void>` 返回类型。任何 TS 覆盖实现在编译期就会被强制 `async` / 显式 `Promise`。这条 TS 类型约束**必须**列入 Phase B success criteria。

#### 5. `wink_sim_stub.js` 补真时序 smoke

原 stub 只验 `onRuntimeInitialized` + 200ms 存活，无法暴露 Asyncify 失效。新增最小 smoke：worker 里跑一段 C 代码 `js_pal_os_sleep_ms(50)`，主线程测 delta，断言 ∈ `[40, 200]` ms。

---

## 后果与约束（Consequences & Constraints）

### 破坏性范围（已核对）

- **wasm 侧 C 代码**：零改动。`extern void js_pal_os_sleep_ms(uint32_t ms)` 签名与调用约定完全不变。
- **wink_sim_js.js 之外的 wasm target 源文件**：零改动（`pal_osal_wasm.c` 等仍然按原调用方式 extern）。
- **Workbench / Phase B 前端**：`installUnisimBridge(Module, imports)` 从"愿望"变为"能真正工作"；单元测试可 `new Module({ ...mocks })` 一行注入，无需 `instantiateWasm` hook。
- **现有 Wave 2 集成测试**：需要复核是否有测试依赖"sleep 立即返回"的错误行为。理论上不应该有——但 §背景 里说的"Asyncify 从未真正生效"意味着现有 `dual_task_demo` 等 sample 的时序行为已经**在错误前提下跑绿**过，修复后可能暴露之前掩盖的问题。**列入迁移风险**。

### 性能影响

- 每次 wasm→JS import 调用多一次 `typeof === 'function'` 分支。wasm 边界调用本身 ~µs 级，wrapper 开销 <100ns，可忽略。
- Asyncify 修复后 sleep 从"立即返回"变为"真正挂起 N ms"，**这才是 ADR-0013 协作式调度器所依赖的正确行为**。任何依赖"sleep 是 no-op"的现有代码就是本次要修复的 bug 面。

### 代码生成指引

AI codegen 在 host 侧 TS 代码里覆盖 wasm imports 时：

1. **必须** import `WasmImports` 类型（Phase B 落地后从 `@wink-ai/unisim` 导出）
2. 覆盖 sleep/busy_wait 时**必须** `async () => {}` 或返回 `new Promise(...)`
3. **不得**用 `Object.assign(Module, imports)` 后立即调用 wasm 导出——所有覆盖必须在 wasm 首次执行相关 import 之前完成

---

## 遵循与后续（Compliance & Follow-up）

### Accepted 后立即回写

- [ ] `docs/design/04-wasm-simulation/archive/01-wasm-sandbox-lifecycle.md` §2.2 & §2.2.2：更新 "`__async: true` → `'auto'`"、更新"覆盖机制"说明为 wrapper 模式、删除或改写"手写 handleSleep 等价形式"段落（该段落基于错误的 `__async: true` 假设）
- [ ] `docs/implementation-plans/scripts/README.md`：若有 Asyncify / imports 章节交叉引用，同步更新
- [ ] `docs/tech-designs/frontend/frontend-simulation-phase-b-spec.md` §2.1, §4, §5.3：把 "wink_sim_js.js 保持不变" 改为 "Phase B Task 0 前置改造 wink_sim_js.js（wrapper + `'auto'`）"

### 实施 Task 清单（Phase B Task 0 前置）

1. `wink_sim_js.js`：13 个符号加 wrapper + 2 处 `__async` 值修正
2. `wink_sim_js.js` 头部注释重写，说明 wrapper + `'auto'` 契约
3. `wink_sim_stub.js`：新增 sleep 真时序 smoke
4. 独立 PR 提交，跑通 CI 后合入 master
5. 合入后再进入 Phase B B1/B2 主体

### 迁移风险跟踪

- Wave 2 & 现有 sample（`avoidance_car`, `dual_task_demo`, `oled_dashboard`）修复后需要复跑，观察是否有隐藏的"sleep 立即返回"依赖暴露
- 若有测试因为"现在 sleep 真的耗时了"而超时或行为改变，须逐一分析——这是修复正确行为暴露的既存缺陷，不是回归

---

*本 ADR 状态变更请在此记录：*
- 2026-07-03：Proposed（Phase B P0 #1 spike 结果 + emcc 6.x 语法核对，2 项假设均证伪；spike 位于 `D:\tmp\spike_override\`）
- 2026-07-03：Accepted（选项 B — Wrapper 模式 + `__async: 'auto'`；回写 `01-wasm-sandbox-lifecycle.md` §2.2 契约段 + §2.2.2 wrapper/Promise 说明；Phase B spec §Q2/§2.1/§5.3 更新 Task 0 前置；`wink_sim_js.js` 13 符号加 wrapper + 2 处 `'auto'` 修正；`wink_sim_stub.js` 补 Asyncify 时序 smoke —— **实测通过**：2 次 sleep 调用 max wall-delta=13ms > req 10ms，证明 Asyncify 真正挂起 wasm。决策者：架构委员会 & 用户）

