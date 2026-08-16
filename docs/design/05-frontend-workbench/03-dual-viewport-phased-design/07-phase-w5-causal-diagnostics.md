# W5 因果链 + 诊断模式 — CausalChainConsole 与回放基础

| 项 | 内容 |
|----|------|
| 阶段 | W5 |
| 预估工期 | ~1.5 天 |
| 前置依赖 | W3c 传感器桥接完成（W4 可并行） |
| 产出物 | CausalChainConsole、正向/反向追溯、diagnose 联动、回放基础接口 |
| 里程碑 | M6 — 避障闭环全流程在因果链面板中 ≥5 步可正向/反向追溯 |
| 关联上游 | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §10–§11 |

---

## 1. 目标

1. 实现 `CausalChainConsole` 底栏面板，可视化因果链时间线
2. 支持**正向叙述**和**反向追溯**双向导航
3. 实现 diagnose 模式联动：Fault 自动暂停 → 因果链聚焦 → 双视窗压缩
4. 环形缓冲策略（500 步限制）+ 同类合并
5. 预留仿真回放接口（Phase 3 实现）
6. 支持 JSON 导出（Golden Trace 对比扩展点）

---

## 1.1 W5 MVP 范围（因果层覆盖）

| 层 | W5 MVP | 推迟 |
|----|--------|------|
| `world` | ✅ 主线程 EnvState / Rapier 埋点 | — |
| `env` | ✅ ideal 值变化 | — |
| `actuator` | ✅ `actuatorOutput` 变化 | — |
| `world_feedback` | ✅ ActuatorMirror 反馈 | — |
| `app` | ⚠️ **Stub**：从 trace 日志解析关键分支，或 Worker 显式 `causalStep` 若 spike 通过 | 完整 CFG 插桩 |
| `pal` | ⚠️ **Stub**：主线程对比 ideal vs `STATE_UPDATE` 中退化后读数；或 Worker 推送 | Wasm 内逐行插桩 |

**M6 验收最低标准**：6 层中 **至少 4 层有真实数据**（world/env/actuator/feedback 必须真实）；`pal`/`app` 允许 stub 标注 `[inferred]`。

**Worker `causalStep` spike（W5 前，0.5d）**：验证 App 是否可通过现有 trace 事件推导；若否，仅实现 `pal` 层从 `STATE_UPDATE` diff 推断。

---

## 2. 因果链数据模型

### 2.1 增强的 CausalChainStep

在上游规范基础上增加 `parentStepId` 支持图结构，以及 `relatedBindings` 支持联动高亮：

```typescript
// types/causal-chain.ts

export interface CausalChainStep {
  stepId: string;                     // 唯一 ID（UUID 或递增）
  simTimeUs: bigint;
  layer: CausalLayer;
  summary: string;                    // 人类可读摘要
  data?: Record<string, unknown>;     // 结构化数据
  parentStepId?: string;              // 反向追溯链接
  relatedBindings?: string[];         // 关联的 bindingId，用于高亮
  severity?: 'info' | 'warning' | 'fault';
}

export type CausalLayer = 
  | 'world'           // 3D 物理事件（碰撞、射线命中）
  | 'env'             // 环境域 ideal 值计算
  | 'pal'             // PAL 信号退化
  | 'app'             // App 业务逻辑决策
  | 'actuator'        // 执行器输出
  | 'world_feedback'; // 3D 物理世界反馈（轮子停转等）

export const LAYER_CONFIG: Record<CausalLayer, {
  label: string;
  color: string;
  icon: string;
  defaultCollapsed: boolean;
}> = {
  world:          { label: '3D 物理', color: '#22d3ee', icon: '🌍', defaultCollapsed: false },
  env:            { label: '环境域',  color: '#3B82F6', icon: '📡', defaultCollapsed: false },
  pal:            { label: 'PAL 退化', color: '#f59e0b', icon: '⚡', defaultCollapsed: true },
  app:            { label: 'App 逻辑', color: '#10b981', icon: '🧠', defaultCollapsed: false },
  actuator:       { label: '执行器',  color: '#8b5cf6', icon: '⚙️', defaultCollapsed: false },
  world_feedback: { label: '物理反馈', color: '#06b6d4', icon: '🔄', defaultCollapsed: false },
};
```

### 2.2 故障审计日志与故障域隔离结构 (Gap 3 & Gap 5)

为承接 C 侧 Wasm 内置的故障域隔离框架与审计环形缓冲区（对齐 `sim_specs_deep_assessment.md` 缺口 3 和缺口 5），补充定义以下结构，用于 TS 侧从 Worker 内存拉取故障记录：

```typescript
// ─── 故障审计日志 (Gap 3) ───

export enum FaultType {
  GPIO_BOUNCE = 1,
  I2C_DROP = 2,
  I2C_NOISE = 3,
  CLOCK_DRIFT = 4,
  ADC_DEVIATION = 5,
}

/** 故障审计日志事件，由 TS 侧在仿真异常暂停时拉取并注入因果链 */
export interface FaultAuditLogEvent {
  /** 发生时的虚拟时钟值 (bigint) */
  timestampUs: bigint;
  /** 故障退化类型 */
  faultType: FaultType;
  /** 发生故障的 GPIO 引脚号或 I2C 总线端口 */
  pinOrBus: number;
  /** 全局单调递增序号，用于一致性分析与 CI 校验 */
  sequence: number;
}

// ─── 故障域隔离控制 (Gap 5) ───

export enum FaultDomainId {
  GLOBAL = 0,
  GPIO = 1,
  I2C0 = 2,
  I2C1 = 3,
  SPI0 = 4,
  CLOCK = 5,
}

/** 故障域控制包，用于按具体外设域注入故障 */
export interface FaultDomainControl {
  domainId: FaultDomainId;
  armed: boolean;
}
```

### 2.3 因果链 Store

```typescript
// stores/causal-chain.store.ts

export const useCausalChainStore = defineStore('causal-chain', {
  state: () => ({
    steps: [] as CausalChainStep[],
    maxSteps: 500,
    selectedStepId: null as string | null,
    filterLayers: new Set<CausalLayer>(['world', 'env', 'pal', 'app', 'actuator', 'world_feedback']),
    isVerboseMode: false,     // diagnose 或 ?causal=verbose 时开启
    autoScroll: true,
  }),
  
  actions: {
    pushStep(step: CausalChainStep) {
      // 同类合并：连续的 world_feedback 且 summary 相同 → 合并
      const last = this.steps[this.steps.length - 1];
      if (last && last.layer === step.layer && last.summary === step.summary && step.layer === 'world_feedback') {
        last.data = { ...last.data, mergedCount: ((last.data?.mergedCount as number) ?? 1) + 1 };
        return;
      }
      
      this.steps.push(step);
      
      // 环形缓冲
      if (this.steps.length > this.maxSteps) {
        this.steps.shift();
      }
    },
    
    selectStep(stepId: string) {
      this.selectedStepId = stepId;
      const step = this.steps.find(s => s.stepId === stepId);
      if (step?.relatedBindings) {
        // 通知双视窗高亮相关对象
        useSelectionStore().highlightBindingGroup(step.relatedBindings);
      }
    },
    
    // 反向追溯
    traceBack(stepId: string): CausalChainStep[] {
      const chain: CausalChainStep[] = [];
      let current = this.steps.find(s => s.stepId === stepId);
      while (current) {
        chain.unshift(current);
        if (!current.parentStepId) break;
        current = this.steps.find(s => s.stepId === current!.parentStepId);
      }
      return chain;
    },
    
    // 正向展开
    traceForward(stepId: string): CausalChainStep[] {
      return this.steps.filter(s => s.parentStepId === stepId);
    },
    
    clear() {
      this.steps = [];
      this.selectedStepId = null;
    },
  },
  
  getters: {
    filteredSteps: (state) => {
      return state.steps.filter(s => state.filterLayers.has(s.layer));
    },
    
    faultSteps: (state) => {
      return state.steps.filter(s => s.severity === 'fault');
    },
  },
});
```

---

## 3. 因果链生成

### 3.1 各层因果步骤的生成时机

| 层 | 生成位置 | 触发条件 |
|----|----------|----------|
| `world` | `EnvStateManager.tick()` | 射线命中距离变化 > 5cm，或碰撞事件 |
| `env` | `EnvStateManager.tick()` | ideal 值发生变化 |
| `pal` | Worker `causalStep` 事件 | 退化前后值差异 > 阈值（或 verbose 模式全输出） |
| `app` | Worker `causalStep` 事件 | App 逻辑分支执行（if/switch） |
| `actuator` | Worker `actuatorOutput` 事件 | GPIO/PWM 输出变化 |
| `world_feedback` | `ActuatorMirror.applyOutputs()` | 关节速度变化 |

### 3.2 主线程侧生成

```typescript
// 在 EnvStateManager.tick() 中
if (Math.abs(prevDistance - newDistance) > 5) {
  causalChainStore.pushStep({
    stepId: generateId(),
    simTimeUs,
    layer: 'world',
    summary: `Raycast hit ${hitObjectId} @ ${newDistance}cm`,
    data: { bindingId, prevDistance, newDistance, hitObjectId },
    relatedBindings: [bindingId],
  });
  
  causalChainStore.pushStep({
    stepId: generateId(),
    simTimeUs,
    layer: 'env',
    summary: `ideal_distance_cm = ${newDistance}`,
    data: { bindingId, value: newDistance },
    parentStepId: worldStepId,
    relatedBindings: [bindingId],
  });
}
```

### 3.3 Worker 侧生成

Worker 通过 `causalStep` 事件推送 `pal` 和 `app` 层步骤：

```typescript
// wasm-simulation.worker.ts 中
// 当 PAL 退化产生显著差异时
postMessage({
  type: 'causalStep',
  step: {
    stepId: generateId(),
    simTimeUs: currentSimTimeUs,
    layer: 'pal',
    summary: `+noise → ${degradedValue}cm, warmup ${warmupOk ? 'OK' : 'pending'}`,
    data: { idealValue, degradedValue, noiseAmount, warmupStatus },
    parentStepId: lastEnvStepId,
  }
});

// 当 App 执行条件分支时
postMessage({
  type: 'causalStep',
  step: {
    stepId: generateId(),
    simTimeUs: currentSimTimeUs,
    layer: 'app',
    summary: `if (dist < 40) stop motors`,
    data: { condition: 'dist < 40', result: true, distValue: 31.7 },
    parentStepId: lastPalStepId,
  }
});
```

---

## 4. CausalChainConsole UI

### 4.1 布局

```text
┌─ Causal Chain ────────────────────────────────────────────────────┐
│ [Filter: 🌍 📡 ⚡ 🧠 ⚙️ 🔄]  [Verbose ☐]  [Export JSON]  [Clear] │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│ T=12000us  🌍 Raycast hit wall_north @ 32cm                      │
│              │                                                    │
│ T=12000us  📡 ideal_distance_cm = 32                [bind_radar] │
│              │                                                    │
│ T=12016us  ⚡ +noise → 31.7cm, warmup OK      [▶ expand details] │
│              │   bounce_us=2000, adc_noise_v=0.01                │
│              │                                                    │
│ T=12016us  🧠 if (dist < 40) stop motors              ← FAULT?  │
│              │                                                    │
│ T=12016us  ⚙️ PWM_LEFT=0, PWM_RIGHT=0                           │
│              │                                                    │
│ T=12032us  🔄 wheel_angular_vel = 0                              │
│                                                                   │
│ ◄ [反向追溯] ──────────────────── [时间轴] ────── [正向展开] ►      │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 交互行为

| 交互 | 行为 |
|------|------|
| **点击步骤** | 选中 → 双视窗高亮 relatedBindings → 右栏显示绑定详情 |
| **双击 pal 步骤** | 展开/折叠退化参数详情 |
| **点击反向追溯** | 从当前选中步骤向上回溯，高亮整条链 |
| **点击正向展开** | 显示当前步骤的所有后继步骤 |
| **Fault 自动滚动** | severity=fault 的步骤自动滚入视野并脉冲高亮 |
| **Filter 图标** | 点击切换各层可见性 |
| **Verbose 开关** | 开启后 Worker 推送全量 causalStep |
| **Export JSON** | 导出当前缓冲区为 JSON 文件 |
| **时间轴拖拽** | （回放基础，W5 预留 UI 但 Phase 3 实现功能） |

### 4.3 反向追溯 UI

当用户点击「反向追溯」时，UI 切换为**聚焦模式**：

```text
┌─ Reverse Trace: "wheel stopped" ─────────────────────────────────┐
│                                                                   │
│ 🔄 wheel_angular_vel = 0                                 [当前]  │
│   ↑ 为什么轮子停了？                                              │
│ ⚙️ PWM_LEFT=0, PWM_RIGHT=0                                      │
│   ↑ 为什么 PWM 为 0？                                            │
│ 🧠 if (dist < 40) stop motors     dist=31.7cm                   │
│   ↑ 距离值从哪来？                                                │
│ ⚡ +noise → 31.7cm (ideal: 32cm)                                 │
│   ↑ ideal 值从哪来？                                              │
│ 📡 ideal_distance_cm = 32                                        │
│   ↑ 距离怎么测的？                                                │
│ 🌍 Raycast hit wall_north @ 32cm                          [根因] │
│                                                                   │
│                                         [返回时间线视图]           │
└───────────────────────────────────────────────────────────────────┘
```

### 4.4 自动反向追溯

当 `actuatorOutput` 中有异常值（如 PWM 突然变为 0），自动生成反向追溯摘要并显示提示：

```typescript
function detectAnomalousOutputChange(prev: ActuatorOutputBatch, curr: ActuatorOutputBatch) {
  for (const [pin, duty] of Object.entries(curr.pwm)) {
    const prevDuty = prev.pwm[pin] ?? 0;
    if (prevDuty > 0.1 && duty === 0) {
      // PWM 从运行突然变为 0 → 自动触发反向追溯
      const lastActuatorStep = findLastStepByLayer('actuator');
      if (lastActuatorStep) {
        const trace = causalChainStore.traceBack(lastActuatorStep.stepId);
        showAutoTraceNotification(`电机停止：${trace.length} 步因果链已生成`, trace);
      }
    }
  }
}
```

---

## 5. Diagnose 模式联动

### 5.1 触发条件

| 触发 | 来源 | 行为 |
|------|------|------|
| Fault 事件 | Worker `stateChanged: 'faulted'` | 自动切换到 diagnose + 暂停 |
| 用户手动 | 顶栏按钮或 `Ctrl+Shift+D` | 切换模式 |
| 校验异常 | 绑定校验 blocking error | 保持 design 但 Diagnostics Tab 弹出 |

### 5.2 Diagnose 模式布局变化

```typescript
// 在 workbench-mode.store.ts 的 switchTo('diagnose') 中
function enterDiagnoseMode() {
  // 1. 自动暂停仿真
  simulationClient.pause();
  
  // 2. 压缩双视窗（25:25），底栏拉高至 50%
  layoutStore.splitRatio = 0.5;
  layoutStore.bottomPanelHeight = window.innerHeight * 0.5;
  
  // 3. 底栏切到 Causal Tab
  layoutStore.activateBottomTab('causal');
  
  // 4. 开启 verbose 因果链推送
  causalChainStore.isVerboseMode = true;
  
  // 5. 滚动因果链到最近的 fault 步骤
  const faultStep = causalChainStore.faultSteps.at(-1);
  if (faultStep) {
    causalChainStore.selectStep(faultStep.stepId);
  }
}
```

### 5.3 从 Diagnose 恢复

```typescript
function exitDiagnoseMode() {
  // 保留因果链历史（不清空）
  causalChainStore.isVerboseMode = false;
  
  // 恢复布局
  layoutStore.applyModeDefaults('simulate');
}
```

---

## 6. 环形缓冲与性能

### 6.1 缓冲策略

| 模式 | 最大步数 | 推送策略 |
|------|----------|----------|
| `simulate`（默认） | 500 | 仅推送 world/env/app/actuator 层；pal 仅在 delta > 阈值时推送 |
| `simulate` + verbose | 500 | 全量推送（包括每帧的 world_feedback） |
| `diagnose` | 500 | 全量推送 + 自动标记 fault |

### 6.2 合并策略

连续的同类型步骤（如每帧的 `world_feedback: wheel_angular_vel = 0`）合并为一条，附带 `mergedCount`：

```text
🔄 wheel_angular_vel = 0 (×47 帧)
```

### 6.3 不在 simulate 默认开启全量 causalStep

出于性能考虑：

```typescript
// Worker 侧判断
if (isVerboseMode || severity === 'fault') {
  postMessage({ type: 'causalStep', step });
} else {
  // 仅推送 app/actuator 层有变化时
  if (step.layer === 'app' || step.layer === 'actuator') {
    if (hasValueChanged(step)) {
      postMessage({ type: 'causalStep', step });
    }
  }
}
```

---

## 7. 仿真回放基础（Phase 3 预留）

### 7.1 帧数据记录接口

```typescript
// types/replay.ts（W5 定义接口，Phase 3 实现）

export interface ReplayFrame {
  frameIndex: number;
  simTimeUs: bigint;
  idealInputs: IdealInputBatch;
  actuatorOutputs: ActuatorOutputBatch;
  physicsSnapshot?: {
    bodies: Array<{ partId: string; position: Vector3; rotation: Quaternion }>;
  };
}

export interface ReplayRecorder {
  startRecording(): void;
  stopRecording(): ReplayFrame[];
  isRecording(): boolean;
}

export interface ReplayPlayer {
  loadFrames(frames: ReplayFrame[]): void;
  seekTo(frameIndex: number): void;
  play(): void;
  pause(): void;
  getProgress(): { current: number; total: number };
}
```

### 7.2 时间轴 UI 预留

在因果链面板底部预留时间轴滑块区域：

```text
◄────────────────────────────────────────────────────────────►
0ms        |        5ms        |        10ms        |   12ms
           ▲ 播放头（Phase 3 激活）
```

W5 阶段该区域显示为只读进度条（显示当前 SimTime），Phase 3 实现拖拽回放。

---

## 8. JSON 导出

```typescript
// 导出格式，兼容 Golden Trace 对比
export interface CausalChainExport {
  version: 1;
  exportedAt: string;
  simTimeRangeUs: { start: bigint; end: bigint };
  steps: CausalChainStep[];
  manifest: {
    projectName: string;
    schemaVersion: number;
    bindingsSummary: string[];
  };
}

function exportCausalChain(): string {
  const data: CausalChainExport = {
    version: 1,
    exportedAt: new Date().toISOString(),
    simTimeRangeUs: {
      start: causalChainStore.steps[0]?.simTimeUs ?? 0n,
      end: causalChainStore.steps.at(-1)?.simTimeUs ?? 0n,
    },
    steps: causalChainStore.steps.map(s => ({
      ...s,
      simTimeUs: s.simTimeUs.toString(), // bigint 序列化
    })),
    manifest: {
      projectName: projectStore.manifest.projectName,
      schemaVersion: projectStore.manifest.schemaVersion,
      bindingsSummary: projectStore.manifest.bindings?.actuators.map(a => a.bindingId) ?? [],
    },
  };
  
  return JSON.stringify(data, null, 2);
}
```

---

## 9. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | 避障小车闭环产生 ≥ 5 步因果链（world→env→pal→app→actuator→feedback） | 手动 |
| A2 | 正向时间线显示正确，步骤按时间排序 | 视觉 |
| A3 | 点击步骤 → 双视窗高亮相关绑定对象 | 手动 |
| A4 | 反向追溯从 actuator 回溯到 world 根因 | 手动 |
| A5 | PAL 层默认折叠，展开显示退化参数 | 手动 |
| A6 | Fault 触发 → 自动进入 diagnose → 因果链滚动到 fault 步骤 | 手动 |
| A7 | diagnose 模式底栏占 50% + 因果链聚焦 | 视觉 |
| A8 | 环形缓冲 500 步正确裁剪 | Vitest |
| A9 | 同类 world_feedback 合并显示 (×N) | 手动 |
| A10 | JSON 导出格式正确、可反序列化 | Vitest |
| A11 | Filter 图标切换各层可见性 | 手动 |
| A12 | 时间轴 UI 预留位置显示当前 SimTime | 视觉 |

---

*文档变更记录：*

- 2026-07-09：初版创建。
- 2026-07-09：评审修补——§1.1 W5 MVP 因果层覆盖与 pal/app stub 策略。
