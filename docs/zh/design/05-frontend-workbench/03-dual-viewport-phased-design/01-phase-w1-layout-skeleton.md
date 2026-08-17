# W1 布局骨架 — 双视窗分屏 + 工作模式状态机

| 项 | 内容 |
|----|------|
| 阶段 | W1 |
| 预估工期 | ~2–2.5 天（含缓冲；核心 P0 约 2 天） |
| 前置依赖 | HCTR 布线稳定（Phase C 画布）✅ |
| 产出物 | SplitPane、CircuitCanvas 抽离、workbench-mode store、layout store、右栏/底栏 Tab 壳、Onboarding 向导 |
| 里程碑 | M0 + S4 — Onboarding 完成 → design 连线 → simulate 双视窗可见 → Play 不崩溃 |
| 关联总纲 | [00-master-plan.md](./00-master-plan.md) §4.6 simulate 门禁、§5.4 底栏、§6.4 测试策略 |

---

## 0. 前置约定

- **状态管理**：W1 引入 **Pinia**（`pinia` + `pinia-plugin-persistedstate`），见总纲 §11。Task 1.0 第一步安装依赖。
- **Manifest 字段**：TypeScript 与 JSON 使用 `componentId` / `name` / `valueC`，见总纲 §10。
- **Undo/Redo**：本阶段**不实现**；`Ctrl+Z` 快捷键预留，见总纲 §12。
- **simulate 门禁**：W1 **仅静态检查**；bindings 校验自 W2 接入，见总纲 §4.6。
- **i18n**：新增 UI 文案使用 `t('workbench.*')` key；MVP 仅 `zh-CN` 资源文件。

---

## 1. 目标

1. 中心区域从 `activeTab = 'canvas' | 'sim'` 互斥 Tab 升级为**可拖拽分屏双视窗**
2. 引入 `design` / `simulate` / `diagnose` **工作模式**驱动布局比例与编辑权限
3. 从 `EmbeddedWorkbench.vue` 单体中安全抽离 `CircuitCanvas.vue`（Strangler Fig 第一步）
4. 建立 Pinia Stores 基础架构（替代裸 `ref()` 导出）
5. 右栏 Inspector 从单一 Properties 拆为**上下文 Tab 壳**
6. 创建 `project.store` / `inspector.store` 空壳（W2 充实 Manifest）
7. 底栏与模式联动壳层（默认 Tab / 高度；Causal 内容待 W5）
8. 首次体验 Onboarding 向导（场景 S4 / M0）

---

## 2. SplitPane 组件

### 2.1 组件 API

```typescript
// components/layout/SplitPane.vue
interface SplitPaneProps {
  direction: 'horizontal' | 'vertical';  // 默认 horizontal
  defaultRatio: number;                   // 0-1, 左/上视窗占比
  minSizePx: number;                      // 单侧最小像素，默认 280
  storageKey?: string;                    // localStorage 持久化 key
}

interface SplitPaneEmits {
  (e: 'ratioChange', ratio: number): void;
  (e: 'collapse', side: 'left' | 'right'): void;
}
```

### 2.2 分屏拖拽手柄交互规范

| 属性 | 规范 |
|------|------|
| **宽度** | 6px（hover 时扩展为 10px） |
| **默认色** | `rgba(148, 163, 184, 0.2)`（slate-400/20%） |
| **Hover 色** | 主题蓝 `#3B82F6`（50% 不透明度） |
| **拖拽中** | 主题蓝 `#3B82F6`（100%）+ 全视窗 overlay 防止鼠标丢失 |
| **Cursor** | `col-resize`（水平）/ `row-resize`（垂直） |
| **吸附** | 拖到最小宽度时吸附折叠（显示展开箭头） |
| **双击** | 当前聚焦视窗全屏（再双击还原） |
| **Tooltip** | 拖拽时显示当前比例百分比，如 `60 : 40` |
| **动画** | 模式切换引起的比例变化使用 `300ms ease-out` 过渡 |

### 2.3 分屏方向切换

- 快捷键 `Ctrl+\` 切换水平/垂直分屏
- 状态持久化到 `layout.store` + `localStorage`
- 竖向分屏适合 21:9 超宽屏场景

### 2.4 分屏比例与工作模式联动

> 比例语义见总纲 §2.1.1。`splitRatio` = 中心区内 Circuit 宽度占比（0–1）。

| 工作模式 | 中心内 Circuit : World（`splitRatio`） | 中心区高度 | 底栏高度 | 说明 |
|----------|--------------------------------------|-----------|----------|------|
| `design`（接线优先） | 70 : 30（`0.7`） | 75% | 25% | 3D 为装配预览 |
| `design`（结构优先） | 30 : 70（`0.3`） | 75% | 25% | 见 §2.5 |
| `simulate` | 40 : 60（`0.4`） | 70% | 30% | 强调产品运动 |
| `diagnose` | **50 : 50（`0.5`）** | **50%** | **50%** | 底栏因果链为主视野 |

模式切换时比例变化使用 `300ms ease-out` 动画过渡。用户手动拖拽过比例后，不再被模式切换自动覆盖（除非 Reset Layout）。

### 2.5 `designSubMode` 切换规则

| 触发 | 行为 |
|------|------|
| 默认 | `circuit-first`，`splitRatio = 0.7` |
| 用户从顶栏 design 工具条选择「结构优先」 | `structure-first`，`splitRatio = 0.3` |
| 首次向 3D 占位符/视窗添加机械件（W3a 前为模板按钮） | 自动切 `structure-first` + 3D 宽度 ≥ 40% |
| 用户手动拖拽分屏后 | 不自动切换 subMode |

顶栏 design 工具条控件：`[接线优先 | 结构优先]` 分段按钮（SegmentedControl），与 Wire/Grid 同级。

---

## 3. 工作模式状态机

### 3.1 Store 定义

```typescript
// stores/workbench-mode.store.ts
import { defineStore } from 'pinia';

type WorkbenchMode = 'design' | 'simulate' | 'diagnose';

interface ModeState {
  current: WorkbenchMode;
  previous: WorkbenchMode | null;
  designSubMode: 'circuit-first' | 'structure-first';
  userOverriddenRatio: boolean;  // 用户手动拖拽后为 true
}

export const useWorkbenchModeStore = defineStore('workbench-mode', {
  state: (): ModeState => ({
    current: 'design',
    previous: null,
    designSubMode: 'circuit-first',
    userOverriddenRatio: false,
  }),
  
  actions: {
    async switchTo(target: WorkbenchMode): Promise<boolean> {
      // 门禁检查（W1：仅静态检查；W2 增加 bindings，见总纲 §4.6）
      if (target === 'simulate' && this.current === 'design') {
        const ok = await staticCheckService.run();
        if (!ok) return false;
        // W2+: await canEnterSimulate() — 见 02-phase-w2 §3.3（static-check → validateBindings）
      }
      if (target === 'design' && this.current === 'simulate') {
        const confirmed = await this.confirmStopSimulation();
        if (!confirmed) return false;
      }
      this.previous = this.current;
      this.current = target;
      return true;
    },
    
    resetToDesign() {
      this.previous = this.current;
      this.current = 'design';
      // 清空 Runtime State，不修改 Manifest
    }
  },
  
  getters: {
    canEditCircuit: (state) => state.current === 'design',
    canEditMechanical: (state) => state.current === 'design',
    canEditEnvironment: (state) => state.current !== 'diagnose', // sim 也可调环境
    canEditFaults: (state) => state.current !== 'design',
    showTransportControls: (state) => state.current !== 'design',
  }
});
```

### 3.2 状态转换门禁

| 转换 | 门禁条件（W1） | 门禁条件（W2+） | 失败行为 |
|------|---------------|----------------|----------|
| design → simulate | ① 静态检查通过 | ① + ② bindings 无 blocking error | 底栏 Static Check / Diagnostics 展开 + 错误列表 |
| simulate → design | 用户确认停止仿真（Modal） | 同左 | — |
| simulate → diagnose | Fault 触发（自动）或用户手动 | 同左 | 自动暂停仿真 |
| diagnose → simulate | 用户点击 Resume | 同左 | 保留因果链历史 |
| any → design | Reset 按钮 | 同左 | 清空 Runtime State |

**`static-check.service.ts`**（W1 沿用现有逻辑）：

- 位置：`../../../../../wink-ai/packages/embedded-frontend/src/services/static-check.service.ts`
- 入口：`staticCheckService.run(): Promise<boolean>`
- 失败：返回 `false`，`workbench-mode.store` 不切换模式；`layout.store` 展开底栏并激活 `Static Check` Tab
- 与 bindings：**W1 不调用** `binding-validation.service`（W2 创建）

**停止仿真确认 Modal**（`simulate → design`）：

- 标题：「停止仿真？」
- 正文：「返回设计模式将停止当前仿真，运行时状态将被清除。」
- 按钮：`取消`（主） / `停止并返回`（危险色）

### 3.3 模式切换动画

```css
/* 模式切换时的顶栏工具条过渡 */
.mode-toolbar-enter-active,
.mode-toolbar-leave-active {
  transition: opacity 200ms ease, transform 200ms ease;
}
.mode-toolbar-enter-from { opacity: 0; transform: translateY(-8px); }
.mode-toolbar-leave-to   { opacity: 0; transform: translateY(8px); }
```

---

## 4. 顶栏重构（两行式）

### 4.1 布局结构

```text
┌─────────────────────────────────────────────────────────────────┐
│ 行1 (全局上下文):                                                │
│   [Logo] Wink-AI   ProjectName ▾   Target: ESP32-S3 ▾          │
│                          Safety: S2 ▾   [Causal OK ✅]          │
├─────────────────────────────────────────────────────────────────┤
│ 行2 (模式工具条 — 随模式切换内容):                                │
│   [design]  [simulate] [diagnose]  │  <<模式专属控件>>          │
│                                     │                           │
│   design:   Wire:Auto/Manual │ Tidy │ Grid:On/Off              │
│   simulate: ▶ Pause │ ⏹ Stop │ Step │ Speed:1x ▾ │ Time:12ms  │
│   diagnose: ▶Resume │ ⏹ Stop │ [Fault:bounce] │ Time:12ms    │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 响应式 Overflow

当窗口宽度 < 1440px：
- 行1 的 Safety Level 和一致性标签收入 `⋯` 菜单
- 行2 的次要控件（Grid、Tidy）收入 `⋯` 菜单

### 4.3 模式切换器视觉设计

```text
┌──────────┬──────────┬──────────┐
│  Design  │ Simulate │ Diagnose │
│  ✏️ 编辑  │  ▶️ 仿真  │  🔍 诊断 │
└──────────┴──────────┴──────────┘
```

- 当前模式：实心背景 + 白色文字
- 非当前模式：透明背景 + 次要色文字
- Hover：背景半透明高亮
- 切换动画：下划线滑动（200ms ease）

---

## 5. CircuitCanvas 抽离

### 5.1 抽离范围

从 `EmbeddedWorkbench.vue` 提取以下代码块至 `components/circuit/CircuitCanvas.vue`：

| 代码区域 | 大约行数 | 目标 |
|----------|---------|------|
| SVG `<circuit-svg>` 模板 | ~300 行 | CircuitCanvas template |
| Board / Pin 渲染逻辑 | ~200 行 | CircuitCanvas template |
| HCTR 路由可视化 | ~150 行 | CircuitCanvas template |
| 连线 / 外设 SVG | ~250 行 | CircuitCanvas template |
| 画布事件处理 (click/drag) | ~200 行 | CircuitCanvas script |
| 路由计算 / waypoint | ~100 行 | CircuitCanvas script 或 composable |

**零逻辑变更原则**：抽离是纯重构，不修改任何渲染/交互逻辑。

### 5.2 Props / Emits 契约与导线路由类型 (Gap 6)

> **W1 范围**：仅 **TypeScript 类型预定义** + Props 契约；`ConnectionRouting` 写入 Manifest 在 **W2** 完成。W1 抽离不改变 HCTR 运行时行为。

为支持 HCTR 正交布线的持久化与画布解析，补充定义以下路由相关的 TypeScript 类型（对齐 `sim_specs_deep_assessment.md` 缺口 6）：

```typescript
export type WireRouteMode = 'orthogonal' | 'custom';

/** 二维网格坐标点 */
export interface CircuitPoint {
  x: number;
  y: number;
}

/** 正交路由命令解析类型 (如 v15 代表垂直移 15, h-30 代表水平移 -30, * 代表自动连接) */
export type OrthogonalCommand = `v${number}` | `h${number}` | '*';

/** 导线连接路由结构 */
export interface ConnectionRouting {
  mode: WireRouteMode;
  /** 仅在 orthogonal 模式下有效 */
  path?: OrthogonalCommand[];
  /** 仅在 custom 模式下有效，记录绝对转折点 */
  points?: CircuitPoint[];
}

// components/circuit/CircuitCanvas.vue
interface CircuitCanvasProps {
  readonly: boolean;                  // simulate/diagnose 模式为 true
  showRoutingDebug: boolean;          // ?routing_debug=true
  highlightedComponentIds: string[];  // 选中联动
  connections: Array<{
    id: string;
    from: string;
    to: string;
    routing: ConnectionRouting;       // 正交布线数据
  }>;
}

interface CircuitCanvasEmits {
  (e: 'componentSelect', id: string): void;
  (e: 'componentAdd', type: string, position: CircuitPoint): void;
  (e: 'connectionCreate', from: PinRef, to: PinRef, routing: ConnectionRouting): void;
  (e: 'canvasClick', position: CircuitPoint): void;
}
```

### 5.3 回归防护

1. **HCTR 快照测试**：现有布线输出的 SVG path 需有快照基线
2. **Feature Flag**：`VITE_LEGACY_SIM_TAB=true` 恢复旧 Tab 行为
3. **视觉回归**：抽离后截图对比（可用 Playwright screenshot 比较）

---

## 6. 右栏 Inspector Tab 壳

### 6.1 Tab 结构

```vue
<!-- components/inspector/ContextInspector.vue -->
<template>
  <div class="inspector-panel">
    <div class="inspector-tabs">
      <TabButton 
        v-for="tab in visibleTabs" 
        :key="tab.id"
        :active="activeTab === tab.id"
        :pinned="tab.pinned"
        @click="activateTab(tab.id)"
      >
        {{ tab.label }}
      </TabButton>
    </div>
    <div class="inspector-content">
      <CircuitInspector    v-if="activeTab === 'circuit'" />
      <MechanicalInspector v-if="activeTab === 'mechanical'" />
      <BindingsInspector   v-if="activeTab === 'bindings'" />
      <EnvironmentInspector v-if="activeTab === 'environment'" />
      <FaultsInspector     v-if="activeTab === 'faults'" />
      <DiagnosticsInspector v-if="activeTab === 'diagnostics'" />
    </div>
  </div>
</template>
```

### 6.2 自动聚焦规则

| 选中对象类型 | 自动激活 Tab | 例外 |
|-------------|-------------|------|
| 电路外设 / 开发板引脚 | `circuit` | 用户 Pin 了其他 Tab 时不切换 |
| 3D 机械件 | `mechanical` | — |
| 3D 环境道具 | `environment` | — |
| 可绑定对象（有 binding） | `bindings` | — |
| 无选中 | 上次激活的 Tab | — |

### 6.3 Pin 机制

- 每个 Tab 标题旁有 📌 图标
- Pin 后该 Tab **不会被自动聚焦覆盖**（用户仍可手动切换 Tab）
- W1 仅允许同时 Pin **一个** Tab（多 Pin 见总纲 §12 Phase 2）
- 点击其他 Tab 的 Pin 替换当前 Pin

### 6.3.1 右栏 icon 模式（`< 1440px`）

| 行为 | 规范 |
|------|------|
| 展示 | 仅显示 Tab 图标（Circuit=⚡, Mechanical=🔧, …） |
| Tooltip | hover 显示 Tab 全称 |
| 点击 | 侧栏展开为 overlay（320px 宽），不挤压中心双视窗 |
| 关闭 | 点击 overlay 外区域或 `Escape` |

### 6.4 W1 阶段内容

W1 阶段各 Tab 内容为**空壳**：

| Tab | W1 内容 |
|-----|---------|
| `Circuit` | 迁移现有 Property Inspector 代码 |
| `Mechanical` | 「W3a 阶段实现」占位文字 |
| `Bindings` | 「W2 阶段实现」占位文字 |
| `Environment` | 「W4 阶段实现」占位文字 |
| `Faults` | 迁移现有 Fault Injector 代码 |
| `Diagnostics` | 「W5 阶段实现」占位文字 |

---

## 7. ProductWorld 占位符

### 7.1 空状态设计

```vue
<!-- components/world/ProductWorldPlaceholder.vue -->
<template>
  <div class="world-placeholder">
    <div class="placeholder-card">
      <img src="@/assets/3d-preview-illustration.svg" alt="" />
      <h3>3D 产品世界</h3>
      <p>拖入底盘零件，开始搭建你的产品</p>
      <div class="quick-actions">
        <button @click="loadTemplate('tpl_avoidance_car')">
          🚗 避障小车模板
        </button>
        <button @click="loadTemplate('tpl_temp_alarm')">
          🌡️ 温感报警模板
        </button>
      </div>
      <p class="hint">或使用上方模板快速开始（W2 起可从左侧 Mechanical 库拖入零件）</p>
    </div>
  </div>
</template>
```

### 7.2 占位符何时替换

当 `VITE_ENABLE_PRODUCT_WORLD=true` 且 `mechanical.parts.length > 0` 时，替换为 `ProductWorld3D.vue`。

---

## 8. Layout Store

```typescript
// stores/layout.store.ts
import { defineStore } from 'pinia';

interface LayoutState {
  splitDirection: 'horizontal' | 'vertical';
  splitRatio: number;         // 0-1, 中心区内 Circuit 宽度占比
  leftPanelCollapsed: boolean;
  leftPanelCollapsedBeforeSimulate: boolean;  // simulate 前左栏状态，用于恢复
  rightPanelCollapsed: boolean;
  rightPanelMode: 'full' | 'icon';  // icon 模式仅显示 Tab 图标
  bottomPanelHeight: number;  // px
  bottomPanelUserResized: boolean;  // 用户手动拖拽底栏后为 true
  bottomPanelActiveTab: 'trace' | 'causal' | 'logs' | 'build' | 'static-check';
  pipEnabled: boolean;        // Phase 2；W1 仅预留字段
  pipPosition: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  pipScale: number;           // 0.25–0.5
}

export const useLayoutStore = defineStore('layout', {
  state: (): LayoutState => ({
    splitDirection: 'horizontal',
    splitRatio: 0.7,
    leftPanelCollapsed: false,
    leftPanelCollapsedBeforeSimulate: false,
    rightPanelCollapsed: false,
    rightPanelMode: 'full',
    bottomPanelHeight: 200,
    bottomPanelUserResized: false,
    bottomPanelActiveTab: 'static-check',
    pipEnabled: false,
    pipPosition: 'bottom-right',
    pipScale: 0.3,
  }),
  
  actions: {
    applyModeDefaults(mode: WorkbenchMode) {
      const modeStore = useWorkbenchModeStore();
      // 分屏比例（见 §2.4 / 总纲 §2.1.1）
      if (!modeStore.userOverriddenRatio) {
        const ratioByMode: Record<WorkbenchMode, number> = {
          design: modeStore.designSubMode === 'structure-first' ? 0.3 : 0.7,
          simulate: 0.4,
          diagnose: 0.5,
        };
        this.splitRatio = ratioByMode[mode];
      }
      // 底栏高度与默认 Tab（见 §9）
      if (!this.bottomPanelUserResized) {
        const heightByMode: Record<WorkbenchMode, number> = {
          design: 0.25,
          simulate: 0.30,
          diagnose: 0.50,
        };
        const vh = window.innerHeight * heightByMode[mode];
        this.bottomPanelHeight = Math.round(vh);
      }
      const tabByMode: Record<WorkbenchMode, LayoutState['bottomPanelActiveTab']> = {
        design: 'static-check',
        simulate: 'trace',
        diagnose: 'causal',
      };
      this.bottomPanelActiveTab = tabByMode[mode];
      // simulate：记住并折叠左栏
      if (mode === 'simulate') {
        this.leftPanelCollapsedBeforeSimulate = this.leftPanelCollapsed;
        this.leftPanelCollapsed = true;
      }
      // 回到 design：恢复左栏
      if (mode === 'design' && this.leftPanelCollapsedBeforeSimulate !== undefined) {
        this.leftPanelCollapsed = this.leftPanelCollapsedBeforeSimulate;
      }
    },
    
    resetLayout() {
      this.$reset();
      useWorkbenchModeStore().userOverriddenRatio = false;
      this.bottomPanelUserResized = false;
    }
  },
  
  persist: { key: 'wink-layout' }  // pinia-plugin-persistedstate
});
```

---

## 9. 底栏（Bottom Console）壳层

> 与总纲 §5.4 对齐。W1 迁移现有 Trace / Logs / Build / Static Check；`Causal Chain` Tab 显示 W5 占位。

### 9.1 Tab 与模式默认

| Tab | W1 内容 | 默认激活模式 |
|-----|---------|-------------|
| `Trace` | 迁移现有 Trace 面板 | `simulate` |
| `Causal Chain` | 「W5 阶段实现」占位 | `diagnose` |
| `Logs` | 迁移现有 Logs | — |
| `Build` | 迁移现有 Build 输出 | — |
| `Static Check` | 迁移现有静态检查列表 | `design`；检查失败时强制展开 |

### 9.2 联动规则

- `workbench-mode.store.switchTo()` 成功后调用 `layout.store.applyModeDefaults(mode)`
- 首次 `design → simulate`：底栏展开 + 激活 `Trace`（总纲 §5.2 渐进披露）
- 静态检查失败：不切换模式，底栏展开 `Static Check`
- 用户拖拽底栏高度 → `bottomPanelUserResized = true`，后续模式切换不覆盖高度

### 9.3 组件边界

```text
components/console/BottomConsole.vue   # 壳 + 拖拽高度手柄
components/console/TracePanel.vue      # 从 Workbench 迁出
components/console/StaticCheckPanel.vue
components/console/CausalChainPlaceholder.vue  # W5 替换
```

---

## 10. Onboarding 向导

> 场景 **S4** / 里程碑 **M0** 组成部分。见总纲 §5.1。

### 10.1 组件

```text
components/onboarding/OnboardingWizard.vue   # 三步聚光灯引导
composables/useOnboarding.ts                 # localStorage 读写
```

### 10.2 步骤与验收

| Step | 行为 | 验收 |
|------|------|------|
| 1 | 高亮双视窗 + 说明文案 | 用户点击「下一步」 |
| 2 | 展开左栏 Templates，高亮避障小车 | 用户点击模板或「跳过」 |
| 3 | 脉冲高亮 Play；允许 3D 占位态下 Play | 用户点击 Play 且无崩溃 |

- `localStorage` key：`wink_onboarding_completed`
- 设置面板提供「重新显示引导」
- 已完成用户不再自动弹出

---

## 11. 实施任务清单

#### Task 1.0：Pinia 脚手架与核心 Store

| 字段 | 内容 |
|------|------|
| 预估工时 | 3h |
| 修改文件 | `package.json`, `main.ts`, `stores/*.ts` |

- [ ] 安装 `pinia`、`pinia-plugin-persistedstate`；`main.ts` 注册
- [ ] `workbench-mode` / `layout` / `selection` / `canvas` / `inspector` / `simulation` / `project`（空壳）stores
- [ ] `simulation.store` 渐进包装 `simulation-client.ts`：W1 迁入 `isRunning` / `simTimeUs` / `lastError`；组件**统一**经 store 访问，禁止新增对 client 裸 ref 的引用
- [ ] Vitest：模式转换守卫（含 W1 仅静态检查）

#### Task 1.1–1.5（P0）

与 §2–§7、§9 对应：SplitPane、CircuitCanvas 抽离、Workbench 壳、顶栏模式、Inspector Tab 壳、底栏壳。

| Task | 内容 | 优先级 |
|------|------|--------|
| 1.1 | SplitPane + layout 联动 | P0 |
| 1.2 | workbench-mode 状态机 | P0 |
| 1.3 | Workbench 壳 + 双视窗挂载 | P0 |
| 1.4 | TopBar 两行式 | P0 |
| 1.5 | ContextInspector + BottomConsole 壳 | P0 |
| 1.5b | CircuitCanvas 抽离（~1200 行） | P1（可延至 W1 末 / W1.5） |

#### Task 1.6：Smoke E2E（见 §13）

#### Task 1.7：Onboarding 向导（见 §10）

| 字段 | 内容 |
|------|------|
| 预估工时 | 2h |
| 优先级 | 🟢 P0（S4 / M0） |
| 前置 | Task 1.3 |

- [ ] `OnboardingWizard.vue` + `useOnboarding.ts`
- [ ] 三步聚光灯 + 模板快捷入口联动
- [ ] 验收：新用户 3 步内完成 Play（3D 可为占位）

---

## 12. 验收清单

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | SplitPane 可拖拽调整比例，最小 280px | 手动 + 组件测试 |
| A2 | 双击分割条全屏/还原 | 手动 |
| A3 | `Ctrl+\` 切换水平/垂直分屏 | 手动 |
| A4 | 模式切换 → 比例动画过渡（300ms） | 视觉 |
| A5 | design → simulate 门禁（静态检查）正常工作 | Vitest |
| A6 | simulate 模式下电路连线不可编辑 | 手动 |
| A7 | simulate 模式顶栏隐藏布线控件 | 手动 |
| A8 | `VITE_LEGACY_SIM_TAB=true` 恢复旧 Tab 互斥行为 | 手动 |
| A9 | CircuitCanvas 抽离后 HCTR 布线零回归 | 快照测试 |
| A10 | 右栏 Tab 切换正常，Pin 机制工作 | 手动 |
| A11 | 3D 占位符显示引导卡片和模板快捷按钮 | 视觉 |
| A12 | 窗口 < 1440px 右栏自动折叠为图标模式 | 手动 |
| A13 | Pinia stores 注册，`npm run build` 通过 | CI |
| A14 | W1：`design → simulate` 仅静态检查门禁（无 bindings 阻塞） | Vitest |
| A15 | simulate 折叠左栏 → 回 design 恢复折叠前状态 | 手动 |
| A16 | simulate 首次进入底栏展开 Trace；diagnose 展开 Causal 占位 | 手动 |
| A17 | SplitPane / 底栏高度 localStorage 持久化 | 手动 |
| A18 | Onboarding 3 步完成 + `wink_onboarding_completed` 写入 | 手动 + E2E |
| A19 | diagnose 模式：中心 50% 高 + 底栏 50% 高 + 中心内 50:50 分屏 | 视觉 |

---

## 13. Task 1.6 — Smoke E2E（可选，推荐）

| 字段 | 内容 |
|------|------|
| 预估工时 | 2h |
| 优先级 | 🟡 P1 |
| 前置 | Task 1.3 |

**步骤：**

- [ ] 引入 Playwright（或 Cypress，团队择一并在 README 注明）
- [ ] 覆盖 Strangler Fig §S1 最小流：打开页 → Onboarding 跳过 → 添加 LED → 切换 simulate → 双视窗可见 → Play 不崩溃
- [ ] CI 可选：仅 `main` 分支 nightly

**验证：** 本地 `npx playwright test` 通过

> W3c 前扩展 E2E 覆盖避障闭环（见总纲 §12）。

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——Pinia 定案、project/inspector store、Task 1.6 E2E、Undo 推迟。
- 2026-07-09：二次评审修补——§4.6 bindings 过渡、§9 底栏、§10 Onboarding、diagnose 布局、Task 1.7、验收 A14–A19。
