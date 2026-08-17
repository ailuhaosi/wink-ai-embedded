# 04. 如何新增外设插件（含仿真）

面向新手的最短路径：在 `embedded-frontend` 新增一个**具备仿真能力**的外设。  
外设包负责资产库、画布/世界渲染、属性面板、仿真 I/O 声明与语义 UI 绑定；**固件 DAL / C 驱动不在本包**。

> **现行状态（2026-07-12）：** 仿真数据面重构 M0–M6 已落地（[ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md) Accepted）。宿主是纯总线；同构外设 = **独立目录 + 一行 import**，不改 Worker / Workbench 特判。

口径：**3 种输出观测 + 1 种输入注入 = 4 条数据面**（禁止说「4 种观测」）。

---

## 0. 五分钟总览（先读这段）

```text
1. 选通道（入④ / 出①②③）+ 确认 Raw 已存在 → 同构，零改 Worker
2. 复制 _template → peripherals/<type>/
3. 填 definition.ts（pins / props / observe|inject / ui / actuatorObserve）
4. 写纯展示 CanvasGlyph（只吃 props，禁止 import simulation-runtime）
5. index.ts 注册 definition（③ 再注册 converter）+ peripherals/index.ts 一行 import
6. npm test + 架构守卫；Simulate 看语义量 / 注入闭环
```

| 你要的效果 | 主通道 | 抄谁 |
|------------|--------|------|
| 上层看到角度/转速等**语义量实时同步** | **③** | `servo/`、`motor_driver_stub/` |
| 按钮按下 / 距离滑块灌进固件 | **④** | `button/`、`ultrasonic/` |
| LED 亮灭（电路视窗） | **①**（面板可选再加 ③） | `led/` |
| OLED 刷屏 | **②** | `oled/` |

**同构** = 复用既有 Raw（`gpio` / `pwm` / `ssd1306_fb`）或既有 inject API（`setPinIdeal` / `setUltrasonicDistance`）。  
**非同构** = 现有出口表达不了 → 先扩 Wasm export + Worker，再写外设包（需评审）。

---

## 1. 先选通道（写代码前强制）

依据 [ADR-0027](../../decisions/unisim/0027-sim-observation-data-planes.md)。跳过这一步直接抄错外设，是最常见返工原因。

```text
是「用户/环境 → 固件」吗？
  ├─ 是 → ④ Ideal Inject（输入；不是观测）
  └─ 否（固件 → UI）→
        整块显示缓冲？ → ② Display Payload
        需要角度/转速/频率/语义色，或要进执行器面板？ → ③ Actuator Observation
        仅脚电平、主要在电路视窗？ → ① Pin Mirror
```

| 口径 | 数量 | 包含 |
|------|------|------|
| 输出观测 | **3** | ① `pinStates` · ② `oledFb` / display · ③ `actuatorObservations` |
| 输入注入 | **1** | ④ Ideal Inject |
| 合计 | **4** | ① + ② + ③ + ④ |

### 禁止（架构测试会拦 / 评审失败）

- 在 `bind*` / `EmbeddedWorkbench` / `simulation-client` 加 `type === 'xxx'`
- Glyph / WorldWidget **直读** `simulation-runtime` 的数据面 ref（必须经 `ui.*` + props）
- 把 framebuffer 塞进 `ActuatorObservation`
- 把 ④ 输入包装成 ③「方便面板展示」
- 消费 ① 时对布尔值裸判断 → 必须用 `isPinHigh(...)`（见 `peripherals/types.ts`）

更细的场景矩阵见[技术设计 §6](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md#6-场景决策矩阵外设作者速查)。

---

## 2. SSOT 归属（新增前必读）

| 数据域 | SSOT 位置 | 查询入口 |
|--------|-----------|----------|
| 电路外设（有引脚、可拖拽） | `peripherals/<type>/definition.ts` | `registry` → `deviceCatalog` |
| 开发板 | `boards/<boardId>/definition.ts` | `boardRegistry` |
| 机械/环境资产（无电路引脚） | `world-assets/<id>/definition.ts` | `worldRegistry` |
| 映射类型 schema | `types/mapping-registry.ts` | binding 校验 |
| 用户 binding 实例 | `manifest.bindings` | 项目 JSON |

**纪律：**

- `pins[]` 是引脚**唯一**手写来源；`catalog.pins` 已废弃。
- 画布走线网表由 `definition.pins` + 推荐显式声明 `wireNet` 派生；**禁止**在宿主维护任何按外设类型硬编码的平行走线表。
- `wireNet` 可选角色有 `'primary' | 'secondary' | 'vcc' | 'gnd'`。相同 wireNet 角色的引脚在派生时会被自动聚合成同一个 `NetDefinition` 的 `pinCandidates` 中。
- `worldCoupling` 只写在 `definition.catalog`。
- **禁止**在 `device-catalog.ts` 手写 peripheral/stub/board 条目。
- 有引脚、参与 `connections` 的器件必须提供 `CanvasGlyph.vue`。

完整 Checklist 亦见 [外设插件注册计划 · 附录 A](../../implementation-plans/core/2026-07-10-peripheral-plugin-registry-plan.md#14-附录-a--新增外设-checklistp3-完成后的最终形态)。  
四目录关系：[`../../../../wink-ai/packages/embedded-frontend/src/catalog/README.md`](../../../../wink-ai/packages/embedded-frontend/src/catalog/README.md)。

---

## 3. 标准工作流（同构外设 · 5 步）

### 步骤 1 — 脚手架

```bash
cp -r ../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template ../../../../wink-ai/packages/embedded-frontend/src/peripherals/<type>
```

`<type>` 与 `definition.type` 一致（全局唯一）。

### 步骤 2 — 填写 `definition.ts`

契约类型：[`peripherals/types.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts) → `PeripheralDefinition`。

| 字段 | 用途 |
|------|------|
| `type` / `displayName` / `category` | 身份与资产库分组 |
| `pins` | **唯一引脚 SSOT**（含 `catalogType`、`defaultConnection`、`relX`/`relY`） |
| `props` | 属性 schema → 属性面板自动生成（无需宿主 per-type 分支） |
| `size` / `wireColor` | 画布尺寸与走线色 |
| `catalog` | `id` / `worldCoupling` / `allowed*Mappings`（**不含** `pins`） |
| `canvas` / `world` | 视口组件（有引脚则 `canvas` 必选） |
| `inspectorExtra` | 可选；schema 表达不了的控件（如距离滑块） |
| **`simulation.observe`** | 输出采集声明（①/②/③ Raw 源） |
| **`simulation.inject`** | **④** 理想输入注入（`apply` / 可选 `idle`） |
| **`actuatorObserve`** | **③** 语义 profile（quantity / unit / convert id） |
| **`ui.canvasProps` / `ui.worldProps`** | 把 `SimViewContext` 映射成 Glyph props（宿主自动调用） |

**按通道补契约：**

| 通道 | 在 definition 里写什么 |
|------|------------------------|
| **①** | `ui.*` 从 `ctx.pinStates` 取，经 `isPinHigh` |
| **②** | `observe` → `watchDisplay('ssd1306_fb')`（+ 可选 `watchI2C` 仅元数据）；`ui.*` 传 FB |
| **③** | `actuatorObserve` + `watchActuatorSource`；`ui.*` 从 `ctx.actuatorObservations` 取语义量 |
| **④** | `simulation.inject`；**不要**假 `observe` / `watchUltrasonic` |

Observe Builder API（[`observe-builder.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/observe-builder.ts)）：

| 方法 | 通道 | 说明 |
|------|------|------|
| `watchGpio(pins)` | ① | GPIO 数字量 |
| `watchI2C(sda, scl)` | 元数据 | **不**再隐含开启 OLED FB |
| `watchDisplay(kind)` | ② | 如 `'ssd1306_fb'` |
| `watchActuatorSource(...)` | ③ | 执行器 Raw 源（`pwm_channel` / `gpio_pin`） |
| `watchUltrasonic(...)` | — | **已废弃**；距离走 ④ `inject` |
| `setParam(key, value)` | — | 自定义 Worker 参数 |

#### ③ 骨架（语义实时同步 · 最常见）

```ts
actuatorObserve: {
  profile: {
    defaultQuantity: 'angular_position', // 或 angular_velocity / state …
    unit: 'deg',
    convert: 'my_convert_id', // 在 index.ts 注册
  },
},
simulation: {
  observe: (comp, builder) => {
    builder.watchActuatorSource({
      deviceComponentId: comp.id,
      transport: 'pwm_channel', // 或 'gpio_pin'
      transportKey: (comp.props.pwmChannel as number) ?? 0,
    });
  },
},
ui: {
  canvasProps: (comp, ctx) => {
    const obs = ctx.actuatorObservations.find(
      (o) => o.deviceComponentId === comp.id && o.quantity === 'angular_position',
    );
    return {
      id: comp.id,
      label: comp.props.label ?? comp.id,
      angle: typeof obs?.value === 'number' ? obs.value : 90,
    };
  },
},
```

金样板：`servo/definition.ts`、`motor_driver_stub/definition.ts`。

#### ④ 骨架（输入注入）

```ts
simulation: {
  inject: {
    kind: 'gpio_ideal', // 或 'ultrasonic_distance'
    apply(comp, ctx) {
      // ctx.apis.setPinIdeal(pin, level)
      // ctx.apis.setUltrasonicDistance(trig, echo, cm)
    },
    // idle(comp, ctx) { ... }  // 按钮释放态等
  },
},
```

金样板：`button/definition.ts`、`ultrasonic/definition.ts`。

### 步骤 3 — 纯展示组件

| 文件 | 何时需要 |
|------|----------|
| `CanvasGlyph.vue` | 有引脚、画布可见 → **必选** |
| `WorldWidget.vue` | 产品世界视口需要 |
| `InspectorExtra.vue` | schema 表达不了的控件 |

**纪律：** 组件**只吃 props**。禁止 `import` `simulation-runtime` / `simulation-client` / Wasm / 全局 `window` 状态。  
宿主构造只读 `SimViewContext`，再调用 `definition.ui.canvasProps(comp, ctx)` 注入。

### 步骤 4 — `index.ts` 注册

```ts
import { registry } from '../registry';
import { myDefinition } from './definition';
import { actuatorConverterRegistry } from '@/services/actuator-converter-registry';

// 仅通道 ③：Raw → 语义（可用 ctx.props / ctx.simTimeUs / ctx.stateStore）
actuatorConverterRegistry.register('my_convert_id', (raw, ctx) => {
  return {
    quantity: 'angular_position',
    value: /* … */,
    unit: 'deg',
    role: 'command',
  };
});

registry.register(myDefinition);
```

参考：`servo/index.ts`（占空比→角度）、`motor_driver_stub/index.ts`（占空比→rpm + `stateStore` 惯性）。

### 步骤 5 — 一行挂载

在 [`peripherals/index.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/index.ts)：

```ts
import './<type>';
```

采用**显式 import**（不用 `import.meta.glob`）。

**同构场景到此结束：** 不改 Worker、`simulation-client`、`EmbeddedWorkbench`，不加任何 `type ===`。

Registry API：`register` / `get` / `list` / `listByCategory` / `getWireColor` / `getSize` / `getDefaultProps` / `getDefaultPinConnections`（见 [`registry.ts`](../../../../wink-ai/packages/embedded-frontend/src/peripherals/registry.ts)）。

---

## 4. 按通道最小清单

### A. ③ 执行器（语义变量实时同步）

1. `actuatorObserve` + `watchActuatorSource` + `ui.canvasProps`
2. `index.ts` 注册 converter
3. Glyph 只显示语义 props
4. 一行 import
5. 验收：Simulate → `SimActuatorPanel` 出现语义行；画布跟变

改动面：仅 `peripherals/<type>/` + `peripherals/index.ts`。

### B. ④ 传感器 / 人机

1. `simulation.inject`（`apply` + 可选 `idle`）
2. `inspectorExtra` 或控件改 `comp.props`
3. 不要 `watchUltrasonic` / 假 observe
4. 验收：滑块/按键 → 固件行为变化

### C. ① LED 类

1. `ui.*` 读 `ctx.pinStates` + `isPinHigh`
2. 若要进执行器面板：再加 ③（见 `led/` 的 `gpio_to_state`）

### D. ② 显示类

1. `watchDisplay('ssd1306_fb')`（+ 可选 `watchI2C`）
2. Glyph 吃 binder 传入的 FB，本地 paint
3. **新屏协议** → 非同构，先扩 Worker `displayKinds`

### E. 非同构

1. 评审批准新 Raw / Wasm export
2. Worker 采集扩展
3. 再走 A–D

---

## 5. 运行时：系统自动帮你做的事

**输出（Wasm → UI）：**

```text
Wasm Raw → Worker STATE_UPDATE → simulation-runtime
  ├─ ① pinStates
  ├─ ② display / oledFb
  └─ ③ Mapper + converter → actuatorObservations
→ SimViewContext → ui.canvasProps → Glyph 刷新
```

`SimActuatorPanel` **只读 ③**：新执行器声明 Observation 后，面板**零改**自动列出语义量。

**输入（UI → Wasm）：**

```text
控件事件 → runInject / runInjectIdle（按 definition.inject）
→ Worker 与 simTimeUs 对齐写入 → 固件 read
```

---

## 6. 验收

### 自动化

```bash
cd ../../../../wink-ai/packages/embedded-frontend
bun test
bun run typecheck
bun run build
bunx vitest run src/peripherals/__tests__/architecture-data-plane.test.ts
# 期望：offenders = []（M2 已清零；Glyph 不得直连 simulation-runtime）
```

若改了 `PeripheralDefinition` 接口，同步更新 `_template/`，并通过 `peripherals/__tests__/template-contract.test.ts`。

### 手动

1. 资产库拖入 → 画布尺寸 / 引脚锚点正确
2. 属性面板 schema 可编辑；`inspectorExtra` 可用
3. Simulate：
   - **③** → 执行器面板语义量实时变；Glyph 跟变
   - **④** → 注入驱动固件闭环（按键 / 距离滑块）
   - **①** → 电路视窗电平正确
   - **②** → 屏刷新正常
4. 同构场景：确认**未改** Worker / Workbench 的 `type ===` 特判

---

## 7. 不在本包 / 不该做的事

| 不做 | 原因 |
|------|------|
| 固件 DAL / C 驱动 | 走 Wasm App / `wink-micro-os` |
| 在 `WorkbenchPropertyInspector` / `bind*` / Workbench 加 `type ===` | 用 `props` / `inspectorExtra` / `ui.*` / `inject` |
| 在 `simulation-client` / Worker 硬编码外设 type（同构时） | 观察与注入放在 definition |
| Glyph 直连 `simulation-runtime` | 架构守卫失败；经 `ui.bind` 传 props |
| 现有 Raw 不够时私下改协议不评审 | 非同构须先扩 Wasm/Worker |

---

## 8. 仿真接入路径（现行主路径）

| 路径 | 何时使用 | 状态 |
|------|----------|------|
| **`simulation.observe` + `ui.*` +（③）`actuatorObserve`/converter** | 输出：①/②/③ | ✅ **现行主路径**（同构外设） |
| **`simulation.inject`** | 输入：④ | ✅ **现行主路径**（按钮 / 超声等） |
| **`catalog.worldCoupling` + binding** | 传感器/执行器与产品世界映射 | 声明保留；W3c 统一 ideal-inputs 桥演进中，**不替代**上两行 |

新外设：**先走 observe / inject / ui 插件契约**；同时按需声明 `worldCoupling` 与 `allowed*Mappings`，勿再把 binding 桥当成「加仿真外设的主入口」。

---

## 9. 代码锚点

| 用途 | 路径 |
|------|------|
| 契约类型 / `isPinHigh` / Inject | `peripherals/types.ts` |
| Observe Builder | `peripherals/observe-builder.ts` |
| Converter 注册表 | `services/actuator-converter-registry.ts` |
| 模板 | `peripherals/_template/` |
| ③ 金样板 | `peripherals/servo/`、`motor_driver_stub/` |
| ④ 金样板 | `peripherals/button/`、`ultrasonic/` |
| ① + 可选 ③ | `peripherals/led/` |
| ② | `peripherals/oled/` |
| 架构护栏 | `peripherals/__tests__/architecture-data-plane.test.ts` |

---

## 10. 相关文档

- [ADR-0027：仿真数据面分层：3 出 + 1 入](../../decisions/unisim/0027-sim-observation-data-planes.md)
- [实施计划套件 · 00-roadmap（M0–M6，已完成）](../../implementation-plans/unisim/00-roadmap.md)
- [技术设计：仿真数据面分层](../../tech-designs/unisim/2026-07-12-sim-observation-layers-design.md)
- [Catalog SSOT 收敛计划](../../implementation-plans/core/2026-07-11-catalog-ssot-convergence-plan.md)
- [外设插件注册实施计划](../../implementation-plans/core/2026-07-10-peripheral-plugin-registry-plan.md)
- [前端工作台架构](./01-frontend-workbench-architecture.md)
- [双视窗产品世界布局](./02-dual-viewport-product-world-layout.md)

