# embedded-frontend 前端架构评审报告

> **评审日期**: 2026-07-10
> **修订日期**: 2026-07-10（二次架构审阅：补充数据所有权、仿真热路径分层、Feature-flag sunset、测试契约、常量/枚举与反魔法数字规范、优先级修正）
> **评审范围**: `../../../../wink-ai/packages/embedded-frontend/src/` 全量源码
> **评审视角**: 前端架构、代码规范、工程最佳实践
> **技术栈**: Vue 3.5 + Vite 8 + TypeScript 6 + Pinia 3 + vue-i18n 10

---

## 目录

- [1. 评审概述](#1-评审概述)
- [2. 项目架构总览](#2-项目架构总览)
- [3. 架构优势](#3-架构优势)
- [4. 关键问题](#4-关键问题)
  - [4.1 上帝组件 — EmbeddedWorkbench.vue (1880 行)](#41-上帝组件--embeddedworkbenchvue-1880-行)
  - [4.2 上帝 Composable — useCircuitCanvas.ts (1400 行)](#42-上帝-composable--usecircuitcanvasts-1400-行)
  - [4.3 双重状态源 — simulation-client + simulation.store](#43-双重状态源--simulation-client--simulationstore)
  - [4.4 Feature-flag / Legacy 技术债](#44-feature-flag--legacy-技术债)
  - [4.5 类型安全缺口](#45-类型安全缺口)
  - [4.6 画布运行时态 vs Manifest 双写](#46-画布运行时态-vs-manifest-双写)
  - [4.7 Worker 协议无类型契约](#47-worker-协议无类型契约)
  - [4.8 测试金字塔失衡](#48-测试金字塔失衡)
  - [4.9 常量 / 枚举缺失与魔法值散落](#49-常量--枚举缺失与魔法值散落)
- [5. 工程规范缺失](#5-工程规范缺失)
- [6. 其他改进建议](#6-其他改进建议)
  - [6.1 i18n 名存实亡](#61-i18n-名存实亡)
  - [6.2 无 Vue Router — 深链接收益有限](#62-无-vue-router--深链接收益有限)
  - [6.3 直接 DOM 查询](#63-直接-dom-查询)
  - [6.4 无错误边界 / Worker 不可恢复 UI](#64-无错误边界--worker-不可恢复-ui)
  - [6.5 CSS 架构碎片化](#65-css-架构碎片化)
  - [6.6 脚手架残留](#66-脚手架残留)
  - [6.7 simulation-client 函数直接修改模块级 ref](#67-simulation-client-函数直接修改模块级-ref)
  - [6.8 Store 跨域编排耦合](#68-store-跨域编排耦合)
  - [6.9 性能与可观测性空白](#69-性能与可观测性空白)
  - [6.10 无障碍与键盘模型](#610-无障碍与键盘模型)
- [7. 改进优先级矩阵](#7-改进优先级矩阵)
- [8. 改进方案详细设计](#8-改进方案详细设计)
  - [8.1 EmbeddedWorkbench.vue 拆分方案](#81-embeddedworkbenchvue-拆分方案)
  - [8.2 useCircuitCanvas.ts 拆分方案](#82-usecircuitcanvasts-拆分方案)
  - [8.3 仿真状态分层统一方案](#83-仿真状态分层统一方案)
  - [8.4 工程工具链建设方案](#84-工程工具链建设方案)
  - [8.5 Manifest / 画布 SSOT 方案](#85-manifest--画布-ssot-方案)
  - [8.6 Worker 消息协议类型化](#86-worker-消息协议类型化)
  - [8.7 拆分前回归契约测试](#87-拆分前回归契约测试)
  - [8.8 常量 / 枚举与反魔法值规范](#88-常量--枚举与反魔法值规范)
- [9. 总结](#9-总结)

---

## 1. 评审概述

本次评审对 `../../../../wink-ai/packages/embedded-frontend/` 项目的全部源码（约 70+ 源文件）进行了逐文件审阅，重点关注以下维度：

- **架构合理性**: 分层是否清晰，模块职责是否单一
- **代码质量**: 是否存在反模式、重复代码、上帝对象
- **类型安全**: TypeScript 的使用是否充分发挥了防护作用
- **工程规范**: Lint、Format、CI、Git Hooks 等基础设施是否完备
- **可维护性**: 代码是否易于后续迭代和团队协作
- **可测试性**: 核心逻辑是否便于编写单元测试
- **数据所有权**: 是否存在多份可变真相（SSOT）
- **热路径性能**: 仿真高频更新是否与 UI 状态管理解耦
- **命名与字面量治理**: 常量/枚举是否统一，是否避免魔法数字与魔法字符串

---

## 2. 项目架构总览

```
../../../../wink-ai/packages/embedded-frontend/src/
├── main.ts                          # 应用入口
├── App.vue                          # 根组件 (8 行，纯壳)
├── style.css                        # 全局样式 + CSS 变量
├── vite-env.d.ts                    # Vite 类型声明
│
├── types/                           # 类型定义层
│   ├── circuit-component.ts         # 元器件实例类型
│   ├── circuit-routing.ts           # 连接路由类型
│   ├── circuit.ts                   # 电路通用类型
│   ├── manifest-v2.ts               # 项目 Manifest V2 Schema
│   ├── mapping-registry.ts          # 映射注册表类型
│   └── peripheral-pins.ts           # 外设引脚配置 (核心)
│
├── stores/                          # Pinia 状态层 (7 个 store)
│   ├── index.ts                     # Pinia 实例 + 持久化插件
│   ├── canvas.store.ts              # 画布设置 (routingMode, grid)
│   ├── inspector.store.ts           # 检查器面板标签页
│   ├── layout.store.ts              # 布局状态 (split, panels, pip)
│   ├── project.store.ts             # 项目 Manifest 管理
│   ├── selection.store.ts           # 选中状态
│   ├── simulation.store.ts          # 仿真状态 (镜像 worker)
│   └── workbench-mode.store.ts      # 工作模式状态机
│
├── services/                        # 业务服务层
│   ├── manifest.service.ts          # Manifest 导入/导出
│   ├── manifest-migration.ts        # Schema 版本迁移
│   ├── manifest-patch.service.ts    # Manifest 补丁 + 模板
│   ├── manifest-to-canvas.service.ts# Manifest → 画布模型转换
│   ├── simulation-client.ts         # WASM Worker 通信客户端
│   ├── binding-pin-resolver.ts      # 绑定引脚解析
│   ├── binding-suggest.service.ts   # 绑定建议
│   ├── binding-validation.service.ts# 绑定验证
│   ├── canvas-binding-provision.ts  # 画布绑定配置
│   ├── connection-normalize.ts      # 连接规范化
│   ├── static-check.service.ts      # 静态检查
│   └── templates/                   # 项目模板
│
├── routing/                         # 走线引擎 (核心算法)
│   ├── geometry.ts                  # 几何计算
│   ├── track-allocator.ts           # 轨道分配
│   ├── segment-occupancy.ts         # 段占用注册
│   ├── wire-routing.ts              # 走线路径生成
│   ├── path-templates.ts            # 路径模板
│   ├── conflict-resolver.ts         # 冲突解决
│   ├── net-pin-resolver.ts          # 网络引脚解析
│   ├── post-process.ts              # 后处理
│   ├── constants.ts                 # 走线常量
│   ├── types.ts                     # 走线类型
│   └── __tests__/                   # 走线测试 (10 个测试文件)
│
├── composables/                     # Vue 组合函数
│   ├── useCircuitCanvas.ts          # 画布逻辑 (1400 行)
│   ├── useOnboarding.ts             # 引导向导
│   └── __tests__/
│
├── components/                      # UI 组件
│   ├── circuit/CircuitCanvas.vue    # 电路画布
│   ├── layout/TopBar.vue            # 顶栏
│   ├── layout/SplitPane.vue         # 分割面板
│   ├── layout/ConfirmDialog.vue     # 确认对话框
│   ├── console/BottomConsole.vue    # 底部控制台
│   ├── inspector/ContextInspector.vue  # 上下文检查器
│   ├── inspector/BindingsInspector.vue # 绑定检查器
│   ├── asset-library/               # 资源库组件
│   ├── onboarding/OnboardingWizard.vue # 引导向导
│   ├── world/ProductWorldPlaceholder.vue # 3D 世界占位
│   ├── VirtualLED.vue               # 虚拟 LED
│   ├── VirtualButton.vue            # 虚拟按钮
│   ├── VirtualOLED.vue              # 虚拟 OLED
│   └── VirtualUltrasonic.vue        # 虚拟超声波
│
├── views/
│   └── EmbeddedWorkbench.vue        # 主工作台 (1880 行)
│
├── catalog/
│   └── device-catalog.ts            # 设备目录注册
│
├── i18n/
│   ├── index.ts                     # vue-i18n 配置
│   └── locales/zh-CN.json           # 中文语言包
│
└── workers/
    └── wasm-simulation.worker.ts    # WASM 仿真 Worker
```

---

## 3. 架构优势

在指出问题之前，有必要先肯定项目中做得好的设计决策。

### 3.1 走线引擎模块化

`routing/` 目录是整个项目架构最成熟的部分。走线算法被拆分为 8 个独立模块，每个模块职责单一：

| 模块 | 职责 |
|------|------|
| `geometry.ts` | 纯几何计算（边界、方向、投影） |
| `track-allocator.ts` | 轨道分配算法 |
| `segment-occupancy.ts` | 段占用注册与冲突检测 |
| `wire-routing.ts` | 路径生成主逻辑 |
| `path-templates.ts` | 45° PCB 走线路径模板 |
| `conflict-resolver.ts` | 走线冲突解决 |
| `net-pin-resolver.ts` | 网络连接引脚解析 |
| `post-process.ts` | 路径后处理（泪滴、过孔） |

配套有 10 个测试文件，覆盖 smoke test、golden baseline、boundary cases、benchmark 等。这种模块化 + 测试覆盖的模式值得在其他领域复制。

### 3.2 WASM 仿真隔离

仿真计算通过 Web Worker 运行（`wasm-simulation.worker.ts`），与 UI 线程完全隔离。`simulation-client.ts` 作为通信层，使用 `postMessage` 协议与 Worker 交互。这确保了即使仿真计算密集，UI 也不会卡顿。

### 3.3 Manifest 模型 + 迁移机制

项目使用结构化的 `EmbeddedProjectManifest` 作为核心数据模型，涵盖设备、连接、机械、环境、绑定等完整描述。`manifest-migration.ts` 提供了 schema 版本演进能力，支持从 V1 到 V2 的自动迁移。

### 3.4 布局持久化

`layout.store.ts` 使用 `pinia-plugin-persistedstate` 持久化用户布局偏好（split ratio、panel 折叠状态、PiP 配置等），用户刷新页面后布局不丢失。

### 3.5 工作模式状态机

`workbench-mode.store.ts` 实现了 `design → simulate → diagnose` 的模式切换状态机，包含前置校验（静态检查 + 绑定验证）、确认弹窗（仿真中切回设计需确认停止）、回退机制等，状态转换逻辑完整。

---

## 4. 关键问题

### 4.1 上帝组件 — EmbeddedWorkbench.vue (1880 行)

**文件**: `src/views/EmbeddedWorkbench.vue`
**严重程度**: P0 — 可维护性瓶颈

#### 问题描述

`EmbeddedWorkbench.vue` 是整个应用的主页面，承载了过多的职责：

| 职责类别 | 代码行数（约） | 具体表现 |
|----------|---------------|----------|
| 模板 (template) | ~680 行 | 包含 legacy/新两套 UI 的完整模板 |
| 脚本 (script) | ~540 行 | 设备管理、仿真控制、项目导入导出、模式切换 |
| 样式 (style) | ~660 行 | 所有面板、按钮、表单、控制台样式 |

具体职责混杂包括：

1. **设备管理**: `addComponent()`, `removeComponent()`, `selectComponent()`, `setRotation()`, `rotateComponent()`
2. **仿真控制**: `toggleSimulation()`, `handleReset()`, `updateSpeed()`, `injectFaults()`, `toggleWireBreak()`
3. **项目 I/O**: `onSaveProject()`, `onOpenProject()`, `onLoadTemplate()`, `applyManifestToWorkbench()`
4. **模式切换**: `handleModeChange()`, `confirmStopSimulation()`, `cancelStopSimulation()`
5. **布局管理**: `onSplitRatioChange()`, `handleWindowResize()`, `onGlobalKeydown()`
6. **OLED 帧缓冲渲染**: `watch(oledFb, ...)` 中 30+ 行的像素操作逻辑
7. **Legacy UI 完整副本**: 属性检查器、故障注入器、仿真控件各写了两遍

#### 影响

- 任何功能修改都需要在 1880 行文件中导航，认知负荷极高
- 模板中 legacy/新模式的 duplication 意味着改一处要同步改另一处
- 无法对单个功能进行独立测试
- 多人协作时 merge conflict 概率极高

#### 修订注意

拆分是必要的，但**应先收敛 Manifest/画布数据所有权**（见 [§4.6](#46-画布运行时态-vs-manifest-双写)），并与删除 UI Legacy **同迭代**进行；否则只是把双写与双模板搬进更多文件。

---

### 4.2 上帝 Composable — useCircuitCanvas.ts (1400 行)

**文件**: `src/composables/useCircuitCanvas.ts`
**严重程度**: P1 — 可测试性瓶颈

#### 问题描述

这个 composable 混合了至少 5 个独立关注点：

| 关注点 | 函数 | 行数（约） |
|--------|------|-----------|
| 组件拖放 | `onPeripheralMouseDown`, `handleComponentMouseMove/Up` | ~120 行 |
| 导线航点编辑 | `handleWireClick`, `handleWaypointMouseMove/Up`, `findNearestSegment` | ~200 行 |
| 开发板拖放 | `startDragBoard`, `handleBoardMouseMove/Up` | ~60 行 |
| 电源总线管理 | `handlePowerNodeClick/Move/Up`, `syncPowerBusLayout` | ~80 行 |
| 走线渲染计算 | `wiresToRender` (computed), `getWirePCBPath`, `buildActiveNetRequests` | ~300 行 |
| 画布缩放/坐标 | `updateCanvasScale`, `clientToCanvas` | ~30 行 |
| 布局管理 | `assignLayoutForNewComponent`, `getLayoutPositions`, `setLayoutPositions` | ~30 行 |
| 视觉状态 | `buildWireVisual`, `wireVisualMap`, `powerBusVisual` | ~60 行 |

返回值多达 **38 个属性/方法**，消费方（`CircuitCanvas.vue`）需要理解全部接口才能正确使用。

#### 影响

- 无法对单个功能（如组件拖放）编写独立的单元测试
- 修改走线渲染逻辑可能意外影响拖放行为
- 新增画布功能（如多选框选）需要在已经膨胀的文件中继续堆积

---

### 4.3 双重状态源 — simulation-client + simulation.store

**文件**: `src/services/simulation-client.ts` + `src/stores/simulation.store.ts`
**严重程度**: P1 — 数据流混乱

#### 问题描述

`simulation-client.ts` 导出了 9 个模块级 `ref()`：

```ts
// simulation-client.ts
export const isInitialized = ref(false);
export const isRunning = ref(false);
export const isFaulted = ref(false);
export const initError = ref<string | null>(null);
export const clockUs = ref('0');
export const pinStates = ref<Record<number, boolean>>({});
export const oledFb = ref<Uint8Array | null>(null);
export const logs = ref<Array<{ level: string; message: string; timestamp: number }>>([]);
export const traces = ref<SimTrace[]>([]);
```

然后 `simulation.store.ts` 用 9 个 `watch()` 把这些 ref 镜像同步到 Pinia state：

```ts
// simulation.store.ts — ensureRuntimeSync()
watch(isInitialized, (value) => { this.isInitialized = value }, { immediate: true });
watch(initError, (value) => { this.initError = value }, { immediate: true });
watch(isRunning, (value) => { this.isRunning = value }, { immediate: true });
// ... 重复 9 次
```

这导致：

1. **两个 reactive source**: 组件中可以用 `simStore.isRunning` 也可以 `import { isRunning } from 'simulation-client'`，两者语义等价但来源不同
2. **不必要的 reactivity chain**: Worker 消息 → 模块 ref 更新 → watch 触发 → Pinia state 更新 → 组件重渲染，多了一跳
3. **调试困难**: 在 Vue DevTools 中看到 Pinia state 变化，但实际修改发生在 Worker 回调中，追踪链路长

同时，`EmbeddedWorkbench.vue` 中又直接 import 了模块级 ref：

```ts
// EmbeddedWorkbench.vue
import {
  isInitialized, isRunning, isFaulted, clockUs, pinStates, oledFb, logs, traces
} from '../services/simulation-client';
```

而不是通过 store 访问，进一步加剧了混乱。

#### 热路径约束（修订结论）

Worker 以约 60Hz（`setTimeout(simLoop, 16)`）推送 `STATE_UPDATE`，payload 常含 `pinStates`、`oledFb`（`Uint8Array`）、`traces`。双重源问题真实，但**不宜把全部热数据一刀切镜像进 Pinia**：

| 分层 | 字段示例 | 归属建议 |
|------|----------|----------|
| **控制面** | `isInitialized`, `isRunning`, `isFaulted`, `initError` | 进入 `simulation.store`，供模式切换 / TopBar / 错误 UI |
| **数据面** | `oledFb`, `pinStates`, `clockUs`, `traces`, `logs` | 留在 client 侧 `shallowRef`（或等价），按订阅方节流 / rAF 合并 |

详见 [§8.3](#83-仿真状态分层统一方案)。

---

### 4.4 Feature-flag / Legacy 技术债

**文件**: `EmbeddedWorkbench.vue`, `routing/wire-routing-legacy.ts`, `project.store.ts`
**严重程度**: P1 — 维护成本倍增 + 组合爆炸（原评 P2，修订上调）

#### 问题描述

项目同时存在多套 feature flag，Legacy 债不止 UI：

| Flag | 作用 | 规模 |
|------|------|------|
| `VITE_LEGACY_SIM_TAB` | 同一组件内两套完整 UI | 模板膨胀约 40% |
| `VITE_LEGACY_WIRE_ROUTING` / `?legacy_routing=true` | 回退到 A* 旧走线 | `wire-routing-legacy.ts` 800+ 行 |
| `VITE_MANIFEST_SCHEMA_V2` | Manifest V2 能力门控 | 绑定/校验路径分叉 |

通过 `VITE_LEGACY_SIM_TAB` 控制时，同一个组件中存在两套完整的 UI：

| 区域 | Legacy 模式 | 新模式 |
|------|------------|--------|
| 顶栏 | `<header class="top-bar">` (内联模板) | `<TopBar>` 组件 |
| 左侧面板 | 内联 catalog + active list | `<LayeredAssetLibrary>` 组件 |
| 中央工作区 | Tab 切换 canvas/sim | `<SplitPane>` 分割视图 |
| 右侧面板 | 内联属性检查器 + 故障注入 | `<ContextInspector>` + `<BindingsInspector>` |
| 底部面板 | 内联 trace/logs | `<BottomConsole>` 组件 |

其中 **属性检查器** 和 **故障注入器** 的模板在 legacy 和新模式之间几乎完全相同（各约 100 行），修改一个功能需要同步修改两处。

#### 影响

- 模板体积膨胀约 40%
- 每次修改属性检查器或故障注入器，需要同步两处
- 新开发者容易只改一处而忘记另一处
- 3 个 flag × 两套路由 × 两套 UI 形成组合爆炸，测试矩阵不可控
- 缺少 sunset 日期时，legacy 路径会无限期存活

#### 修订建议

- **UI Legacy 与拆分 `EmbeddedWorkbench` 同迭代删除**（单独清成本更高）
- 每个 flag 写明删除条件与目标版本；`wire-routing-legacy` 与 `MANIFEST_SCHEMA_V2` gate 一并纳入清理计划

---

### 4.5 类型安全缺口

**文件**: `src/types/circuit-component.ts`, `tsconfig.app.json`
**严重程度**: P1 — 运行时错误风险

#### 问题描述

**Props 类型丢失**:

```ts
// circuit-component.ts
export interface CircuitComponentInstance {
  props: Record<string, any>;  // 完全放弃类型检查
}
```

任何外设属性（`color`, `brightness`, `distance`, `activeLow` 等）都可以是任何类型，编译器不会报错。

**TypeScript 防护网关闭**:

```jsonc
// tsconfig.app.json
{
  "noUnusedLocals": false,       // 允许未使用变量
  "noUnusedParameters": false,   // 允许未使用参数
  "erasableSyntaxOnly": false,   // 允许非可擦除语法
  "verbatimModuleSyntax": false  // 宽松模块语义
}
```

**影响**:

- `Record<string, any>` 使得属性访问完全没有类型提示和检查
- `noUnusedLocals: false` 允许死代码积累
- 重构时无法通过编译器发现遗漏

**修订建议**: 按目录渐进开启 `noUnusedLocals` / 更严选项；`props` 用按外设类型的 discriminated union，避免一次全开导致无法合入。

---

### 4.6 画布运行时态 vs Manifest 双写

**文件**: `EmbeddedWorkbench.vue`, `project.store.ts`（`syncFromCanvas`）
**严重程度**: P0 — 数据所有权不清（二次审阅补充；优先于「拆文件」）

#### 问题描述

工作台同时持有两份可变真相：

1. **画布运行时态**: `activeComponents`、布局 positions（composable / 本地 ref）
2. **持久模型**: `project.store.manifest`（devices / connections / bindings）

通过 `projectStore.syncFromCanvas(...)` 与 `applyManifestToWorkbench` / `manifestToCanvas` 双向同步。导入模板、拖拽改布局、改属性时，短暂不一致窗口真实存在。

#### 影响

- 上帝组件难维护的根因之一是编排层同时持有两份可变真相
- 未先定 SSOT 就拆分组件，只会把双写搬进更多文件，放大 bug 面
- 保存/导出可能读到未同步完的 Manifest

#### 修订结论

**先定数据所有权，再拆 `EmbeddedWorkbench`**：

- Manifest = 持久 SSOT
- 画布模型 = 派生视图
- 写操作只走 store actions，再投影到画布

详见 [§8.5](#85-manifest--画布-ssot-方案)。

---

### 4.7 Worker 协议无类型契约

**文件**: `simulation-client.ts`, `wasm-simulation.worker.ts`
**严重程度**: P1 — 边界漂移只能运行时发现（二次审阅补充）

#### 问题描述

主线程与 Worker 之间用隐式字符串消息协议（`INIT` / `STATE_UPDATE` / `ERROR` 等），payload 形状无共享类型；Worker 内存在 `@ts-ignore` 与 `as any`，掩盖 WASM 边界。

#### 影响

- 字段增删无法在编译期发现
- 仿真状态统一改造时容易静默破坏消费方

#### 建议

共享 `discriminated union` 消息类型 + golden message 单测。详见 [§8.6](#86-worker-消息协议类型化)。

---

### 4.8 测试金字塔失衡

**严重程度**: P1 — 大拆分缺少安全网（二次审阅补充）

#### 问题描述

| 层 | 现状 |
|----|------|
| 走线引擎 | 厚：smoke / golden / boundary / benchmark |
| services / stores | 中：manifest、binding、部分 store |
| composable / UI | 薄：`useCircuitCanvas` 几乎无单测 |
| e2e | 仅有 CLI smoke 脚本，未进 CI 门禁叙事 |

工程基建若只写「跑 test」，不写「测什么」，拆上帝文件时回归网不足。

#### 建议

拆分前补契约测试：mode 状态机副作用、Manifest↔Canvas 不变量、Worker 协议。详见 [§8.7](#87-拆分前回归契约测试)。

---

### 4.9 常量 / 枚举缺失与魔法值散落

**严重程度**: P1 — 代码规范债（三次审阅补充；初评未单独成章）

#### 现状对照

| 区域 | 做法 | 评价 |
|------|------|------|
| `routing/constants.ts` | `GRID_SNAP` / `TRACK_SPACING` / `STUB_BASE` 等具名常量 | **标杆**，应在其他域复制 |
| `peripheral-pins.ts` | `powerOptions`、器件尺寸写在配置表 | 部分集中，但仍有调用方重复字面量 |
| 仿真 Worker / client | `setTimeout(..., 16)`、`logs.length > 1000`、消息 `type: 'INIT'` 等字符串 | 魔法数字 + 魔法字符串 |
| OLED 渲染 | `128` / `64` / `page * 128` 散落在 `EmbeddedWorkbench.vue` | 与 catalog 中 OLED size 未单一来源 |
| 电源网络判断 | `'VCC' \|\| '3V3' \|\| 'GND'` 在 canvas / project / manifest-to-canvas / net-pin-resolver **四处重复** | 应抽 `PowerRail` 常量 + `isPowerConnection()` |
| 工作模式 | `'design' \| 'simulate' \| 'diagnose'` 多处字面联合 | 宜 `WorkbenchMode` 常量对象或 enum + 单一导出 |

#### 典型反例

```ts
// wasm-simulation.worker.ts — 帧间隔魔法数字
simTimer = setTimeout(simLoop, 16); // 应为 SIM_UI_TICK_MS = 16

// EmbeddedWorkbench.vue — OLED 几何魔法数字
if (!imgData || imgData.width !== 128 || imgData.height !== 64) {
  imgData = new ImageData(128, 64);
}

// 多文件重复 — 电源轨魔法字符串
connection === 'VCC' || connection === '3V3' || connection === 'GND'
```

#### 影响

- 改一处协议/尺寸/频率时易漏改，运行时才暴露
- Code review 无法快速判断「这个 1000 是日志上限还是 debounce 默认值」
- 与 §4.7 Worker 协议类型化、§4.5 props 类型同属「字面量治理」一条线

#### 规范要求（必须遵守）

1. **禁止业务语义魔法数字**：超时、尺寸、频率、容量、阈值必须具名常量（`UPPER_SNAKE` 或领域前缀）
2. **禁止跨模块重复魔法字符串**：消息 type、模式 id、电源轨、模板 id 必须 `as const` 对象 / string enum / union 的**单一导出源**
3. **配置表优先**：器件几何、默认 fault 参数进 catalog / defaults 模块，UI 只引用
4. **CSS 魔法值另册**：颜色/间距走设计 token（见 §6.5）；与 TS 业务常量分开，但同样禁止散落裸值
5. **例外**：`0`/`1`/`-1` 作为循环下标或位运算、以及测试里与常量断言对照的期望值，可不抽；一旦同一字面量出现 ≥2 处或带领域含义，必须抽

详见 [§8.8](#88-常量--枚举与反魔法值规范)。

---

## 5. 工程规范缺失

| 维度 | 现状 | 风险 | 建议工具 |
|------|------|------|----------|
| **ESLint** | 无配置 | 代码风格不一致，潜在 bug 无法自动检测 | `@antfu/eslint-config` 或 `eslint-config-vue-typescript` |
| **Prettier** | 无配置 | 格式不统一，PR diff 噪音大 | `prettier` + `.editorconfig` |
| **Stylelint** | 无配置 | CSS 质量无保障 | `stylelint` + `stylelint-config-recommended` |
| **Git Hooks** | 无 | 不合格代码可直接提交 | `simple-git-hooks` + `lint-staged`（或 husky） |
| **CI/CD** | 无 | 无自动化质量门禁 | GitHub Actions (typecheck + lint + test + build) |
| **Commit 规范** | 无 | 提交历史不可读 | `commitlint` + `conventional-changelog` |
| **契约测试** | 走线厚、编排薄 | 大重构无安全网 | 见 §4.8 / §8.7 |
| **常量/枚举治理** | 仅 routing 域成熟 | 魔法数字/字符串散落 | 见 §4.9 / §8.8；ESLint `no-magic-numbers`（可渐进） |

当前项目完全依赖开发者自觉，没有任何自动化质量保障。对于一个已有 70+ 源文件、涉及复杂业务逻辑的项目来说，这是一个显著的风险。

**修订注意**: Lint/Format 与大拆分不要同周混做，避免 PR diff 噪音淹没行为变更。

---

## 6. 其他改进建议

### 6.1 i18n 名存实亡

**现状**:
- `vue-i18n` 已配置，但只有 `zh-CN.json` 一个语言包
- 模板中大量硬编码英文字符串：

```html
<!-- EmbeddedWorkbench.vue 中硬编码的英文字符串（部分） -->
<span>Property Inspector</span>
<span>Pin Connections</span>
<span>Properties</span>
<span>Fault Injector</span>
<span>Debounce Window (bounce_us):</span>
<span>Cut Output Signal Wire (Hi-Z)</span>
<span>SIMULATING</span>
<span>STANDBY</span>
<span>FAULTED</span>
<span>No peripherals active</span>
```

- 同时又有部分使用了 `t()` 函数：

```ts
showModeSwitchBanner(t('workbench.project.saved'));
```

**建议**: 要么认真补全 i18n（至少让所有用户可见字符串都走 `t()`），要么移除 `vue-i18n` 依赖，直接使用常量。当前半吊子状态既增加了运行时开销，又没有实际的多语言能力。优先级保持 P2，可排在核心债之后。

### 6.2 无 Vue Router — 深链接收益有限

**现状**: 纯单页应用，URL 始终为 `/`，不携带任何状态。

**影响（事实）**:
- 无法分享"某个特定项目/模式"的链接
- 浏览器前进/后退按钮无效
- 调试选项依赖 query hack（如 `?legacy_routing=true`）

**修订结论（降为 P3）**: 当前产品是**单工作台**，项目分享主要靠 Manifest 文件导出/导入，模式状态已由 `workbench-mode.store` 管理。引入完整 Vue Router（`/design` `/simulate` `/project/:id`）收益有限，会挤占真正技术债的带宽。

**建议**:
1. 短期：用 `?mode=` / 既有 debug query 即可
2. 若后续出现多页面（项目列表、文档、账号），再引入 Router

### 6.3 直接 DOM 查询

**文件**: `src/composables/useCircuitCanvas.ts:194`

```ts
function clientToCanvas(clientX: number, clientY: number) {
  const svg = document.querySelector('.circuit-svg');  // 直接 DOM 查询
  if (!svg) return { x: clientX, y: clientY };
  // ...
}
```

**问题**:
- 违反 Vue 的声明式范式
- 在 SSR 或多实例场景会出问题
- 无法在测试中轻松 mock

**建议**: 使用 `template ref` 替代 `querySelector`。`CircuitCanvas.vue` 应该通过 ref 暴露 SVG 元素引用，并通过 options 或 provide/inject 传递给 composable。与画布拆分同做。

### 6.4 无错误边界 / Worker 不可恢复 UI

**严重程度**: P2（原评 P3，修订上调）

**现状**: 没有 `onErrorCaptured` 处理。WASM Worker 崩溃时只 `console.error`：

```ts
// simulation-client.ts
case 'ERROR':
  console.error(`[SimulationClient Worker Error] ${message}`);
  isInitialized.value = false;
  initError.value = message ?? 'Unknown worker error';
  break;
```

**影响**: 用户看到的是空白页或无响应界面，没有任何友好的错误提示。Worker/WASM 失败是仿真主路径风险，不是边缘 case。

**建议**:
1. 添加全局 `app.config.errorHandler`
2. 创建 `<ErrorBoundary>` 组件包裹关键区域（画布 / 仿真视口）
3. Worker 错误时在 UI 上显示可操作的错误提示（重试/重置）

### 6.5 CSS 架构碎片化

**现状**:
- `style.css` (91 行): 全局变量 + 基础样式
- `EmbeddedWorkbench.vue` (660 行 scoped CSS): 几乎所有 UI 样式
- 各组件有少量 scoped CSS

**问题**:
- 660 行 scoped CSS 中存在大量 legacy/新模式重复样式
- CSS 变量只定义了颜色，缺少间距、圆角、阴影、过渡等设计 token
- 没有统一的组件样式库（按钮、表单、面板等样式都写在工作台组件里）

**建议**:
1. 建立完整的设计 token 体系（spacing, radius, shadow, transition）
2. 抽取公共 UI 样式到 `styles/components/` 目录
3. 考虑引入 UnoCSS 或 Tailwind CSS 减少手写 CSS（可选，非阻塞）

### 6.6 脚手架残留

`src/components/HelloWorld.vue` 仍然存在，这是 Vite 创建项目时的脚手架文件，应该清理。

### 6.7 simulation-client 函数直接修改模块级 ref

```ts
// simulation-client.ts
export function clearLogs() {
  logs.value = [];  // 直接修改模块级 ref，绕过 store
}
```

类似地，`initSimulation()` 中直接重置了多个 ref：

```ts
export function initSimulation() {
  isInitialized.value = false;
  isRunning.value = false;
  isFaulted.value = false;
  initError.value = null;
  clockUs.value = '0';
  pinStates.value = {};
  oledFb.value = null;
  traces.value = [];
  // ...
}
```

这些操作绕过了 Pinia store，使得数据流不统一。按 [§8.3](#83-仿真状态分层统一方案)：控制面重置应走 store actions；数据面重置可留在 client，但消费方不得混用两套 API。

### 6.8 Store 跨域编排耦合

**文件**: `workbench-mode.store.ts`
**严重程度**: P2（二次审阅补充）

`workbench-mode` 在模式切换时隐式编排 `layout` / `project` / `simulation`（静态检查、确认停仿、applyModeDefaults、stopAndClear 等）。这是合理的领域编排，但缺少显式「转换副作用表」或 UseCase 层文档时，拆 UI 后副作用更难追踪。

**建议**: 为 `design ↔ simulate ↔ diagnose` 维护一张副作用表（前置校验、弹窗、停仿、布局默认值）；或抽 `switchWorkbenchMode(target)` orchestrator，UI 只调用该入口。

### 6.9 性能与可观测性空白

**严重程度**: P2（二次审阅补充）

- `wiresToRender` 等重计算、OLED `watch` 像素绘制缺少 `performance.mark`
- 无仿真帧耗时 / 主线程阻塞预算（目标约 60fps）

**建议**: 为 `STATE_UPDATE` 处理与 `wiresToRender` 加 mark；在诊断模式暴露简易 perf 面板（可选）。

### 6.10 无障碍与键盘模型

**严重程度**: P3（二次审阅补充）

画布交互与全局 `keydown` 未系统覆盖焦点陷阱、快捷键冲突表。非阻塞；诊断模式增强键盘操作时再补快捷键表与焦点策略。

---

## 7. 改进优先级矩阵

| 优先级 | 改进项 | 影响范围 | 工作量 | 收益 |
|--------|--------|----------|--------|------|
| **P0** | 添加 ESLint + Prettier + Git Hooks（勿与大拆分同周混做） | 全项目 | 0.5 天 | 建立代码质量基线 |
| **P0** | 定 Manifest/画布 SSOT + 同步不变量测试 | 项目模型 | 1 天 | 避免拆分后双写扩散 |
| **P0** | 拆分 `EmbeddedWorkbench.vue`（**同迭代删除 UI Legacy**） | 主工作台 | 2-3 天 | 可维护性大幅提升 |
| **P1** | 拆分前契约测试（mode / manifest↔canvas / worker 协议） | 测试 | 1 天 | 大重构安全网 |
| **P1** | 拆分 `useCircuitCanvas.ts` + 消除 DOM querySelector | 画布逻辑 | 1-2 天 | 可测试性 + 可维护性 |
| **P1** | 仿真状态**分层**统一（控制面→store，数据面→shallowRef） | 仿真模块 | 1 天 | 数据流清晰且不伤热路径 |
| **P1** | Worker 消息协议类型化 | 仿真边界 | 0.5 天 | 编译期防漂移 |
| **P1** | 渐进开启 TypeScript 更严选项 + props union | 全项目 | 1 天 | 类型安全 |
| **P1** | 添加 CI (typecheck + lint + test + build) | 工程基建 | 0.5 天 | 自动化质量门禁 |
| **P1** | Feature-flag sunset（legacy routing / schema gate） | 路由+模型 | 0.5–1 天 | 消除组合爆炸 |
| **P1** | 常量/枚举统一 + 消除跨模块魔法值（随拆分落地） | 全项目 | 0.5–1 天 | 可维护性 + 防漏改 |
| **P2** | 错误边界 + Worker 可恢复 UI | 全局/仿真 | 0.5 天 | 主路径健壮性 |
| **P2** | 补全 i18n 或移除 | 全项目 | 0.5 天 | 一致性 |
| **P2** | 抽取公共 CSS / 设计 token | 样式 | 1 天 | 样式复用 |
| **P2** | Store 编排副作用表 / orchestrator | 模式切换 | 0.5 天 | 跨域可追踪 |
| **P2** | 仿真/走线 perf mark | 热路径 | 0.5 天 | 可观测性 |
| **P3** | Vue Router（仅当出现多页面时） | 路由/导航 | 1 天 | 深链接（当前收益有限） |
| **P3** | 无障碍与快捷键表 | 交互 | 0.5 天 | 诊断体验 |
| **P3** | 清理脚手架残留 | 项目 | 5 分钟 | 代码整洁 |

---

## 8. 改进方案详细设计

### 8.1 EmbeddedWorkbench.vue 拆分方案

#### 前置条件（修订）

1. 完成 [§8.5](#85-manifest--画布-ssot-方案) 的所有权约定（至少文档 + 关键写路径收敛）
2. 补齐 [§8.7](#87-拆分前回归契约测试) 中与 Workbench 相关的不变量测试
3. **目标形态默认无 Legacy 分支** — 拆分与删除 `VITE_LEGACY_SIM_TAB` 同迭代；过渡期可暂留 flag，但子组件只保留一份

#### 目标结构

```
views/
└── EmbeddedWorkbench.vue              (~120–200 行，布局编排 + 少量容器逻辑)

components/workbench/
├── WorkbenchPropertyInspector.vue     — 属性检查器（唯一实现）
├── WorkbenchFaultInjector.vue         — 故障注入面板（唯一实现）
├── WorkbenchStatusBar.vue             — 状态指示器
├── OledFrameBufferRenderer.vue        — OLED 帧缓冲渲染（订阅数据面）
└── WorkbenchHotkeys.vue               — 全局快捷键处理
```

> 不再为 legacy 单独保留 `WorkbenchSimControls` / `WorkbenchDeviceLibrary` 等平行实现；新模式组件（`TopBar`、`LayeredAssetLibrary`、`BottomConsole` 等）即为唯一 UI。

#### 拆分原则（修订）

1. **每个组件只关注一个功能域**
2. **容器可读 store，展示组件用 props** — 禁止「全树禁 store」导致 props 总线；跨域**写**路径集中在 `workbench-mode` / `project` actions
3. **共享逻辑提取到 composable** — 如 `useSimulationControls()`
4. **Legacy 与新模式不双轨维护** — 属性检查器 / 故障注入器只保留一份，拆分完成即删 legacy 模板

#### 拆分后 EmbeddedWorkbench.vue 的目标形态

```vue
<template>
  <div class="workbench">
    <TopBar @mode-change="handleModeChange" ... />

    <div class="main-layout">
      <aside class="panel left-panel">
        <LayeredAssetLibrary ... />
      </aside>

      <main class="center-workspace">
        <SplitPane ...>
          <template #primary>
            <CircuitCanvas ... />
          </template>
          <template #secondary>
            <WorkbenchWorldPane ... />
          </template>
        </SplitPane>
      </main>

      <ContextInspector>
        <template #circuit>
          <WorkbenchPropertyInspector ... />
        </template>
        <template #faults>
          <WorkbenchFaultInjector ... />
        </template>
      </ContextInspector>
    </div>

    <BottomConsole />
  </div>
</template>
```

---

### 8.2 useCircuitCanvas.ts 拆分方案

#### 目标结构

```
composables/canvas/
├── index.ts                    — 聚合入口，返回统一接口
├── useComponentDrag.ts         — 组件拖放逻辑
├── useBoardDrag.ts             — 开发板拖放逻辑
├── useWireEdit.ts              — 导线航点编辑逻辑
├── usePowerBus.ts              — 电源总线布局与交互
├── useCanvasLayout.ts          — 组件布局位置管理
├── useCanvasViewport.ts        — 画布缩放、坐标转换（template ref，禁止 querySelector）
└── useWireRendering.ts         — 走线渲染计算 (computed)
```

#### 各模块职责

**useComponentDrag.ts**:
```ts
export function useComponentDrag(ctx: CanvasContext) {
  return {
    draggedCompId,
    isComponentDragging,
    onPeripheralMouseDown,
    handleComponentMouseMove,
    handleComponentMouseUp,
  };
}
```

**useWireEdit.ts**:
```ts
export function useWireEdit(ctx: CanvasContext) {
  return {
    draggedWireId,
    selectedWireId,
    wireWaypoints,
    draggingWaypoint,
    draggingSegment,
    handleWireClick,
    handleWaypointMouseMove,
    handleWaypointMouseUp,
    removeWaypoint,
    startDragWaypoint,
  };
}
```

**useCanvasLayout.ts**:
```ts
export function useCanvasLayout(ctx: CanvasContext) {
  return {
    layoutState,
    assignLayoutForNewComponent,
    getLayoutPositions,
    setLayoutPositions,
    removeLayoutForComponent,
    getCanvasX,
    getCanvasY,
    getComponentSize,
    getComponentWidth,
    getComponentHeight,
  };
}
```

#### 聚合入口

```ts
// composables/canvas/index.ts
export function useCircuitCanvas(options: UseCircuitCanvasOptions) {
  const ctx = buildCanvasContext(options);

  const layout = useCanvasLayout(ctx);
  const viewport = useCanvasViewport(ctx);
  const componentDrag = useComponentDrag(ctx);
  const boardDrag = useBoardDrag(ctx);
  const wireEdit = useWireEdit(ctx);
  const powerBus = usePowerBus(ctx);
  const wireRendering = useWireRendering(ctx);

  return {
    ...layout,
    ...viewport,
    ...componentDrag,
    ...boardDrag,
    ...wireEdit,
    ...powerBus,
    ...wireRendering,
  };
}
```

---

### 8.3 仿真状态分层统一方案

#### 目标: 消除双重消费路径，但保留热路径性能

**改造前** (当前):
```
Worker → simulation-client.ts (ref) → watch() → simulation.store.ts (state) → 组件
                  ↑
       EmbeddedWorkbench.vue 也直接 import ref
```

**改造后** (修订目标 — 控制面 / 数据面分离):
```
Worker
  ├─ 控制面消息 → simulation.store (isRunning / isFaulted / initError / …)
  └─ 数据面消息 → simulation-runtime（shallowRef: oledFb / pinStates / traces / …）
         ↓
   组件按需订阅（storeToRefs 或 runtime refs；禁止双路径 import）
```

> **反模式**: 把 `oledFb` / `pinStates` / `traces` 以 ~60Hz 整包写入 Pinia `state` 再触发深层响应式。这会放大主线程成本，用架构纯度换卡顿。

#### 具体步骤

1. **控制面进入 store**:

```ts
// simulation.store.ts — 仅控制面 + 低频元数据
export const useSimulationStore = defineStore('simulation', {
  state: (): SimulationControlState => ({
    isInitialized: false,
    isRunning: false,
    isFaulted: false,
    initError: null,
  }),
  actions: {
    applyControlFromWorker(msg: SimControlMessage) { /* … */ },
    init() { /* 绑定 worker.onmessage，分发控制面/数据面 */ },
    stopAndClear() { /* … */ },
  },
});
```

2. **数据面留在 runtime 模块（非 Pinia，或 Pinia setup store + shallowRef）**:

```ts
// simulation-runtime.ts
export const oledFb = shallowRef<Uint8Array | null>(null);
export const pinStates = shallowRef<Record<number, boolean>>({});
export const traces = shallowRef<SimTrace[]>([]);
export const clockUs = shallowRef('0');
export const logs = shallowRef<SimLog[]>([]);

export function applyStateUpdate(payload: SimStatePayload) {
  // 可选：rAF 合并、Transferable 接收 oledFb
  clockUs.value = payload.us;
  pinStates.value = payload.pinStates ?? {};
  oledFb.value = payload.oledFb ?? null;
  traces.value = payload.traces ?? [];
}
```

3. **simulation-client.ts 变为 Worker 传输层**（创建 / postMessage / terminate），不导出「第二套」控制面 ref。

4. **消费方约定**:
   - 模式切换、TopBar、错误条 → `useSimulationStore`
   - OLED / LED / 引脚可视化 → 只从 `simulation-runtime` 订阅
   - 禁止 `EmbeddedWorkbench` 同时从 client 旧 ref 与 store 读同一语义字段

5. **可选优化**: `oledFb` 使用 `postMessage(..., [buffer])` Transferable；UI 侧用 rAF 合并多帧只绘最新一帧。

---

### 8.4 工程工具链建设方案

#### 8.4.1 ESLint 配置

```bash
npm install -D eslint @antfu/eslint-config
```

```js
// eslint.config.js
import antfu from '@antfu/eslint-config';

export default antfu({
  vue: true,
  typescript: true,
  rules: {
    'vue/no-mutating-props': 'error',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
  },
});
```

#### 8.4.2 Prettier 配置

```bash
npm install -D prettier
```

```json
// .prettierrc
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2,
  "vueIndentScriptAndStyle": false
}
```

#### 8.4.3 Git Hooks

```bash
npm install -D simple-git-hooks lint-staged
```

```json
// package.json
{
  "simple-git-hooks": {
    "pre-commit": "npx lint-staged"
  },
  "lint-staged": {
    "*.{ts,vue}": ["eslint --fix", "prettier --write"],
    "*.{css,json}": ["prettier --write"]
  }
}
```

#### 8.4.4 CI Pipeline

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: ../../../../wink-ai/packages/embedded-frontend/package-lock.json
      - working-directory: embedded-frontend
        run: |
          npm ci
          npm run build        # typecheck (vue-tsc) + vite build
          npm test              # vitest
```

---

### 8.5 Manifest / 画布 SSOT 方案

#### 目标

消除「画布数组 ↔ Manifest」双写歧义，使拆分后的子组件有单一写入口。

#### 约定

| 概念 | 角色 |
|------|------|
| `project.store.manifest` | **持久 SSOT**（保存/导出/校验/绑定的唯一真相） |
| 画布 `components` + layout | **派生视图**（渲染与指针交互） |
| `syncFromCanvas` | 收敛为显式 action（如 `commitCanvasSnapshot`），禁止散落的隐式双向 watch 长期并存 |

#### 步骤

1. 文档化写路径：添加器件 / 改属性 / 改连接 / 改布局 → 必须调用哪个 store action
2. 导入与模板：`setManifest` → 一次性 `manifestToCanvas` 投影；之后画布变更经 action 回写 Manifest
3. 单测：给定 canvas snapshot，`commit` 后 Manifest devices/positions 与导出 JSON 一致；给定 Manifest，投影后再 commit 应幂等

---

### 8.6 Worker 消息协议类型化

```ts
// types/sim-worker-protocol.ts
export type SimWorkerInbound =
  | { type: 'INIT' }
  | { type: 'START' }
  | { type: 'PAUSE' }
  | { type: 'RESET' }
  | { type: 'SET_FAULTS'; payload: SimFaultsConfig }
  | { type: 'SET_PERIPHERALS'; payload: PeripheralConfig[] }
  // …

export type SimWorkerOutbound =
  | { type: 'INIT_DONE' }
  | { type: 'RESET_DONE' }
  | { type: 'STATE_UPDATE'; payload: SimStatePayload }
  | { type: 'LOG'; payload: SimLog }
  | { type: 'ERROR'; message: string };
```

- `simulation-client` 与 `wasm-simulation.worker` 共用该模块
- 单测：对典型 outbound payload 做 `satisfies SimWorkerOutbound` / golden JSON

---

### 8.7 拆分前回归契约测试

在大拆分 PR 之前（或作为同一 PR 的前置 commit）至少覆盖：

| 契约 | 断言要点 |
|------|----------|
| Mode 状态机 | simulate 前置失败不切换；仿真中回 design 需确认；确认后 `stopAndClear` |
| Manifest ↔ Canvas | 投影 + commit 幂等；布局 positions 写入 devices |
| Worker 协议 | `STATE_UPDATE` / `ERROR` 形状；控制面与数据面分发正确 |
| 绑定校验 | 与现有 `binding-validation` 测试保持绿灯 |

走线引擎现有测试继续作为回归基线，不替代上述编排契约。

---

### 8.8 常量 / 枚举与反魔法值规范

#### 目录约定

```
src/
├── routing/constants.ts              # 已有：走线几何（保持）
├── constants/                        # 新增：跨域业务常量（或按域拆分）
│   ├── workbench-mode.ts             # WorkbenchMode + MODE_IDS
│   ├── power-rail.ts                 # PowerRail + isPowerConnection()
│   ├── oled.ts                       # OLED_WIDTH / OLED_HEIGHT / OLED_PAGES
│   └── simulation.ts                 # SIM_UI_TICK_MS / MAX_LOG_ENTRIES / …
└── types/sim-worker-protocol.ts      # 消息 type 与 §8.6 共用，禁止再写裸字符串
```

#### 推荐写法

```ts
// constants/power-rail.ts
export const PowerRail = {
  VCC: 'VCC',
  V3V3: '3V3',
  GND: 'GND',
} as const;

export type PowerRail = (typeof PowerRail)[keyof typeof PowerRail];

export function isPowerConnection(value: string): value is PowerRail {
  return value === PowerRail.VCC || value === PowerRail.V3V3 || value === PowerRail.GND;
}

// constants/oled.ts — 与 peripheralConfigs.oled.size 单一来源或互相 re-export
export const OLED_WIDTH = 128;
export const OLED_HEIGHT = 64;
export const OLED_PAGE_COUNT = OLED_HEIGHT / 8;

// constants/simulation.ts
export const SIM_UI_TICK_MS = 16;       // ~60Hz UI 推送
export const MAX_SIM_LOG_ENTRIES = 1000;
```

#### 落地策略

1. **随重构顺带抽**：拆 `EmbeddedWorkbench` / 统一仿真状态 / Worker 协议类型化时，同步替换触及的魔法值，避免单独「大扫除 PR」
2. **ESLint**：在基建周开启 `@typescript-eslint/no-magic-numbers`（先 `warn`，对 `0/1/-1` ignore）；魔法字符串靠 code review + 协议类型兜底
3. **验收**：新增业务数字/协议字面量若未进常量模块，PR 不予合并（与 Lint/Hooks 同级纪律）

---

## 9. 总结

### 整体评价

`embedded-frontend` 是一个业务复杂度较高的嵌入式仿真工作台项目。在 **领域逻辑** 层面（走线引擎、仿真集成、Manifest 模型）展现了良好的设计能力和工程素养，特别是走线引擎的模块化和测试覆盖堪称范例。

但在 **前端工程化** 和 **架构治理** 方面存在明显短板：

- 两个"上帝"文件（1880 行 Vue + 1400 行 composable）是最大的表象技术债
- **更深的根因**是数据所有权不清：画布运行时态与 Manifest 双写、仿真控制面/数据面混用模块 ref + Pinia 镜像
- 工程工具链（Lint/Format/CI）完全缺失；测试金字塔在编排层偏薄
- Feature-flag（UI legacy + 走线 legacy + schema gate）并行存在，维护成本接近翻倍且组合爆炸
- 常量/枚举治理仅走线域成熟；仿真、OLED、电源轨、模式 id 等仍大量魔法数字/字符串散落

### 建议执行路线（修订）

```
W0  工程基建 (ESLint + Prettier + Hooks + CI，含 no-magic-numbers warn)
    + Worker 协议类型 + Manifest↔Canvas 不变量 / mode 契约测试
         ↓
W1  定 SSOT 写路径
    + 拆分 EmbeddedWorkbench（同迭代删除 VITE_LEGACY_SIM_TAB）
    + 顺带抽取 PowerRail / OLED / 模式常量
         ↓
W2  拆分 useCircuitCanvas + template ref 替代 querySelector
         ↓
W3  仿真分层统一（控制面→store，数据面→shallowRef / 节流）
    + SIM_UI_TICK_MS 等仿真常量 + Worker 可恢复错误 UI
         ↓
W4+ Feature-flag sunset（legacy routing / schema gate）
    + 渐进 TS 严格化 + i18n 二选一 + 设计 token
    （Vue Router 仅在出现多页面需求时再做）
```

**与初版路线的差异**: 把「定数据契约 / 清 UI Legacy」前移到拆文件之中；仿真统一改为控制面与数据面分离；Router/i18n 后移，避免为纯度或低收益基建挤占热路径与可维护性改造。

以上改进不需要一次性完成，建议按优先级逐步推进。每完成一个阶段，项目的可维护性和团队协作效率都会有显著提升。
