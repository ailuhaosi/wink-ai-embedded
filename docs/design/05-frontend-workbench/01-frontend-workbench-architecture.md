# 15. 嵌入式前端工作台架构与体验设计

本文定义 Wink-AI 嵌入式工作台的前端架构、页面布局、状态模型、模块边界和未来并入 Wink-AI 主项目前端的方式。目标是让嵌入式能力既能独立运行，又能作为专业工作台模块平滑进入主项目。

---

## 1. 设计目标

1. **专业工作台体验**：用户能在同一界面完成拓扑设计、逻辑编辑、仿真、故障注入、trace、编译和烧录。
2. **清晰状态门禁**：静态检查、仿真、故障测试、编译和烧录按 S0-S4 安全等级推进。
3. **可插件化集成**：作为独立 Vue 应用运行时不依赖主项目；集成时可懒加载到主项目路由。
4. **运行时隔离**：Wasm Worker、trace buffer、simulation bridge 与 UI 状态解耦。
5. **可测试**：核心状态机、Manifest 校验、连接校验、trace compare 可脱离页面单测。

---

## 2. 页面信息架构

推荐采用“三栏 + 底部控制台”的专业 IDE 型布局：

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Top Bar: Project / Target / Safety Level / Consistency / Build Status │
├───────────────┬───────────────────────────────────┬──────────────────┤
│ Left Panel    │ Center Workspace                  │ Right Panel      │
│ - Templates   │ - Circuit Canvas                  │ - Properties     │
│ - Board Lib   │ - Simulation View                 │ - Diagnostics    │
│ - Peripherals │ - Logic State Machine             │ - Fault Inject   │
│ - AI Assistant│ - Generated C Preview             │ - Build & Flash  │
├───────────────┴───────────────────────────────────┴──────────────────┤
│ Bottom Console: Trace / Logs / Static Check / Build Output / AI Fix    │
└──────────────────────────────────────────────────────────────────────┘
```

> **演进说明（2026-07-09）**：中心区域将从「Circuit Canvas / Simulation View 互斥 Tab」升级为**双视窗分屏**（电路 2D + 产品世界 3D），并引入 `design` / `simulate` / `diagnose` 工作模式驱动布局比例与编辑权限。完整规范见 **[02-dual-viewport-product-world-layout.md](./02-dual-viewport-product-world-layout.md)**。

核心原则：

1. 画布和仿真是中心。
2. 属性、诊断、构建是右侧上下文面板。
3. Trace 和日志放在底部，避免打断画布操作。
4. AI 助手可以在左侧入口，也可以作为诊断结果的 inline action。
5. **电路拓扑与 3D 产品世界在仿真运行时应可同屏联动**（见 02 文档 §3、§5）。

---

## 3. 页面模式

| 模式 | 主要用途 | 中心区域 |
|---|---|---|
| `design` | 拖拽器件、连线、配置属性 | Circuit Canvas |
| `logic` | 状态机/Blockly/DSL 编辑 | Logic Editor |
| `simulate` | 运行 Wasm、观察虚拟外设 | Simulation View |
| `diagnose` | 查看错误、trace、fault | Trace + Diagnostics |
| `build` | 编译、manifest、烧录 | Build & Flash Wizard |

模式可以由顶部 tab 或左侧导航切换，但底层 Project Manifest 不变。

**工作模式（Workbench Mode）**：上表中的 `design` / `simulate` / `diagnose` 将提升为顶栏主控维度；`simulate` 态中心区域默认采用 **Circuit View + Product World 分屏**（替代单一 Simulation View Tab）。`logic` 与 `build` 仍以叠加视图或向导方式呈现，不替代工作模式。详见 [02-dual-viewport-product-world-layout.md](./02-dual-viewport-product-world-layout.md) §4。

---

## 4. 前端模块边界

> **源码归属说明**：前端工作台源码已从嵌入式仓隔离目录迁移至 Wink-AI 主 monorepo 独立包：[`wink-ai/packages/embedded-frontend/`](../../../../wink-ai/packages/embedded-frontend/)（详见 [embedded-frontend/MOVED.md](../../../embedded-frontend/MOVED.md)）。

```text
wink-ai/packages/embedded-frontend/src/
├── views/
│   └── EmbeddedWorkbench.vue       # 双视窗工作台主页面
├── components/
│   ├── canvas/                     # 电路 2D 画布 (HCTR 布线)
│   ├── product-world/              # 产品世界 3D 机械/物理渲染 (Three.js/WebGL)
│   ├── device-library/
│   ├── property-inspector/
│   ├── logic-editor/
│   ├── simulation-panel/
│   ├── trace-console/
│   ├── diagnostics/
│   └── build-flash/
├── stores/                         # Pinia 状态树
│   ├── project.store.ts
│   ├── canvas.store.ts
│   ├── simulation.store.ts
│   ├── safety.store.ts
│   ├── trace.store.ts
│   └── build.store.ts
├── services/
│   ├── manifest.service.ts
│   ├── manifest-migration.ts       # Manifest v1 -> v2 演进迁移
│   ├── registry.service.ts
│   ├── validation.service.ts
│   ├── simulation-client.ts
│   ├── build-client.ts
│   └── ai-tools-client.ts
└── workers/
    └── wasm-simulation.worker.ts
```

---

## 5. 状态分层

| 状态 | 来源 | 是否持久化 | 示例 |
|---|---|---|---|
| Project State | Manifest | 是 | devices、connections、logic |
| Derived State | 计算结果 | 否，可重建 | validation、safety gate |
| Runtime State | Worker/Build Job | 否 | running、heartbeat、build progress |
| UI State | 页面交互 | 可选 | selected component、panel collapsed |

不得将 Worker runtime state 写回 Manifest，除非是明确的 trace、build manifest 或 safety result。

---

## 6. Manifest 驱动数据流

```text
User Action / AI Patch
        │
        ▼
Project Manifest Mutation
        │
        ▼
Schema Validation
        │
        ▼
Connection + Device Model Validation
        │
        ▼
Codegen / Device Tree Generation
        │
        ▼
Static Check
        │
        ▼
Simulation / Build Gate Update
```

所有 UI 操作最终应表达为 Manifest patch，便于撤销、重做、协作和 AI 修复。

---

## 7. 画布设计

画布对象：

1. Board Node
2. Peripheral Node
3. Wire Edge
4. Bus Group
5. Virtual Input Control
6. Warning Marker

画布必须实时执行校验：

| 校验 | 展示方式 |
|---|---|
| 引脚类型不匹配 | 阻止连线，红色提示 |
| 电压域危险 | 黄色/红色警告，提供自动添加转换器 |
| I2C 地址冲突 | 总线高亮，阻止部署 |
| 启动敏感脚占用 | 警告并推荐替代引脚 |
| 资源不足 | 右侧诊断面板列出 |

### 7.1 连线布线（HCTR）

工作台默认采用 **HCTR**（Hierarchical Channel Track Routing，分层通道轨道布线）生成正交连线，替代原 A* 通道 fallback。实现位于 `../../../../wink-ai/packages/embedded-frontend/src/routing/`，由 `peripheral-pins.ts` re-export 对外 API。

**拓扑分类**（`WireTopology`）：

| 拓扑 | 判定条件 | 路径模板 |
|------|----------|----------|
| `local` | 曼哈顿距离 < 80px 且引脚方向可见 | 短距 L 型 |
| `same-side` | 起终点同在板中心左侧或右侧 | 单竖直轨道 + stub |
| `cross-side` | 起终点分居板中心两侧 | U 型 bypass（竖直 → 水平 → 竖直） |
| `power-tap` / `power-trunk` | 电源星型拓扑 | 独立电源轨，不走 HCTR 模板 |

**轨道分配**（`buildTrackAssignments`）：

1. 按 `priority`（power < i2c < digital）、`channel`（left / cross / right）、平均 Y 排序。
2. 同通道内按 lane 递增分配 `verticalTrackX` / `horizontalTrackY`，间距 `TRACK_SPACING = 10px`。
3. I2C bundle（`bundleId`）双线平行偏移 `I2C_BUNDLE_GAP = 8px`。
4. 边界：`start.x === boardCenterX` 归入 left 桶（`<= centerX`）。

**段占用与冲突**（`SegmentOccupancyRegistry` + `conflict-resolver`）：

- 已布线段注册到占用表；新线与既有段重叠时 bump 轨道（最多 `MAX_BUMP_COUNT = 5`），仍失败则回退 legacy。
- 引脚坐标不 snap；轨道坐标 snap 至 4px 网格（`snapTrackCoord`）。

**板缘绕行**（`resolveBoardPinEndDir` + `resolvePeripheralPinStartDir` + `routePathAroundObstacle`）：

- 开发板引脚的 `endDir` 取「最后一段进焊盘」方向，stub 锚点 `p2` 自动落在板体外侧。
- 外设引脚的 `startDir` 按引脚相对组件包围盒的最近边几何计算，stub 锚点 `p1` 自动落在器件体外侧（替代原类型启发式）。
- **底排针**（如超声波）：若竖直总线 X 落在模块宽度内，走线改为沿**左/右侧外缘**下行至引脚高度，再接入（`buildBottomPinSideApproachPath`），禁止从上方直穿模块。
- **同侧绕行**：左/右侧由来线方向决定（`resolveBypassEdgeX`：竖直总线或电源节点在外设左半边 → 走左侧外缘，反之右侧），同一外设的多根线（VCC/GND/TRIG/ECHO）共用同一侧，避免左右分叉。
- 模板生成后若仍有段穿过板/本体外侧障碍，沿最近外侧边缘插入拐点绕行（仅允许首尾短距进出焊盘）。

**手动编辑**（Manual Routing Mode）：

- 用户点击连线插入 waypoint 后进入手动模式：路径经 `forcedPoints` / `waypoints` 直连，不走模板。
- 「Tidy Wires」清除 waypoint 后恢复自动 HCTR 布线。

**拖拽行为**：

- `mousemove`：冻结 `trackAssignments`，仅增量更新被拖元器件的引脚坐标，避免全画布闪烁。
- `mouseup`：解冻并全量重分配轨道。

**回退与调试**：

| 开关 | 作用 |
|------|------|
| `VITE_LEGACY_WIRE_ROUTING=true` | 回退至 `wire-routing-legacy.ts` |
| `?legacy_routing=true` | 浏览器 URL 即时回退，无需重启 |
| `?routing_debug=true` | 叠加轨道虚线、占用段、topology 标签（dev 验收用） |

---

## 8. 属性面板

属性面板由 Device Model 的 `properties` schema 生成：

```text
selected component
  ↓
load peripheral model
  ↓
render SchemaForm
  ↓
validate property constraints
  ↓
patch manifest.devices[].properties
```

属性变更需要触发：

1. connection validation
2. codegen hash invalidation
3. simulation reset prompt
4. safety level downgrade if needed

---

## 9. 仿真客户端架构

```text
Simulation Panel
        │ commands/events
        ▼
Simulation Client
        │ postMessage
        ▼
Wasm Simulation Worker
        ├── Wasm Runtime
        ├── JS Bridge
        ├── Virtual Peripheral Registry
        ├── Fault Injector
        └── Trace Buffer
```

Worker 命令：

```typescript
type SimulationCommand =
  | { type: 'loadProject'; manifest: EmbeddedProjectManifest; registryLockHash: string }
  | { type: 'start' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'injectFault'; scenarioId: string }
  | { type: 'setVirtualInput'; componentId: string; name: string; value: unknown }
  | { type: 'exportTrace' }
```

Worker 事件：

```typescript
type SimulationEvent =
  | { type: 'heartbeat'; timestampMs: number; loopCount: number; memoryBytes: number }
  | { type: 'stateChanged'; state: 'ready' | 'running' | 'paused' | 'faulted' | 'terminated' }
  | { type: 'traceEvent'; event: TraceEvent }
  | { type: 'diagnostic'; diagnostic: Diagnostic }
  | { type: 'virtualPeripheralUpdate'; componentId: string; patch: unknown }
```

### 9.1 仿真数据面分层

Simulation Client 与 Wasm Simulation Worker **底层共用**同一条 `STATE_UPDATE` 通道，但前端消费契约按语义分层，而非单一结构承载一切（详见 [ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md)）：

| 层 | 内容 | 消费方 |
|---|---|---|
| ① Pin Mirror | `pinStates`（脚级电平真相） | 电路视窗、PinArbiter、故障可视化 |
| ② Display Payload | `oledFb` 等显示 framebuffer | 显示类外设面板 |
| ③ Actuator Observation | `actuatorObservations`（语义化物理量） | 执行器面板 / 未来 ActuatorMirror（SSOT） |
| ④ Ideal Inject | 按钮/超声等理想输入注入 | 输入激励，不计入观测 |

计数口径：**3 种输出观测（①②③）+ 1 种输入注入（④）= 4 条数据面**；「统一」指消费纪律与演进方向收敛到 ③，不是删除通道或把 ④ 并入观测。W3b（[03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md](03-dual-viewport-phased-design/04-phase-w3b-physics-actuators.md)）落地 ③ 作为执行器 SSOT，W3c（[03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md](03-dual-viewport-phased-design/05-phase-w3c-sensors-env-bridge.md)）演进 ④；分阶段实施见 [roadmap](../../implementation-plans/unisim/00-roadmap.md)。

---

## 10. Trace Console

Trace Console 应支持：

1. 按事件类型过滤。
2. 按 componentId 过滤。
3. 展示状态迁移链路。
4. 高亮 fault 前后的关键事件。
5. 导出 JSON。
6. 一键发送给 AI 分析。
7. 与 Golden Trace 对比。

Trace UI 不应展示所有底层噪声事件，默认只展示语义事件。

---

## 11. Build & Flash 向导

向导步骤：

```text
1. Check Safety Gate
2. Select Target
3. Review Manifest / Hash
4. Submit Build Job
5. Show Build Log
6. Review Firmware Manifest
7. Flash or Download
8. Optional Hardware Trace
```

烧录按钮启用条件：

1. `safety.level >= S2`
2. static check passed
3. simulation normal run passed
4. required fault tests passed
5. build success
6. artifact sha256 verified
7. browser capability available

---

## 12. AI 助手交互位置

| 场景 | 入口 |
|---|---|
| 新建项目 | 模板页 AI 生成项目 |
| 连线错误 | 诊断卡片「让 AI 推荐连线」 |
| 静态检查失败 | 错误行「AI 修复」 |
| 仿真 fault | Trace Console「解释 fault」 |
| 编译失败 | Build Log「解释并修复」 |
| 烧录失败 | Flash Wizard「指导进入 bootloader」 |

AI patch 必须先进入预览，不得自动修改并烧录。

---

## 13. 主项目集成方式

未来集成到主项目前端时：

1. 主项目 `router` 添加 `/embedded` 懒加载入口。
2. 主项目 sidebar 通过动态导航注册显示「嵌入式工作台」。
3. `embedded-frontend` 接收 host context：

```typescript
interface EmbeddedHostContext {
  userId?: string
  workspaceId?: string
  projectId?: string
  theme: 'light' | 'dark'
  apiBaseUrl: string
  aiEnabled: boolean
  desktopRuntime?: boolean
}
```

4. 嵌入式模块不得直接依赖主项目前端内部 store。
5. 跨模块通信通过 props、events、API client 和 shared types 完成。

---

## 14. MVP 前端范围

MVP-0：

1. 三栏工作台骨架。
2. ESP32 Board + LED + Button。
3. 连线校验。
4. Manifest 保存/加载。
5. 生成 device_tree 和 App 示例。
6. Wasm Worker mock 或最小运行。
7. Trace Console 基础事件。

MVP-1：

1. HC-SR04 + Servo。
2. Fault injection 面板。
3. DSL 状态机编辑。
4. Build Job 提交。
5. Firmware Manifest 展示。

MVP-2：

1. WebSerial 烧录。
2. 硬件 trace 采集。
3. Trace compare。
4. 主项目路由集成。

