# Wire Net from Pins — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除宿主硬编码 `getNetDefinitions` type 表，改为从外设包 `definition.pins` 派生走线网表，使同构新外设（如舵机）写好 `pins[]` 即可自动出线，对齐 `04-adding-a-peripheral` 插件化纪律。

**Architecture:** 在 `UnifiedPinDef` 增加可选 `wireNet`（`'primary' | 'secondary' | 'vcc' | 'gnd'`）。纯函数 `deriveNetDefinitions(pins)` 按 `wireNet`（缺省则启发式推断）聚合成现有 `NetDefinition[]`。`getNetDefinitions(type)` 改为 `registry.get(type)?.pins` → derive，不再维护 led/button/oled/ultrasonic 平行表。画布渲染 / 拖拽冻结轨道继续消费同一 API，零改 HCTR。

**Tech Stack:** Vue 3 + TypeScript + Vitest（`embedded-frontend`）；文档回写 Layer ① `04-adding-a-peripheral.md`。

## Global Constraints

- **不改** Manifest `connections` schema、HCTR 布线算法、`NetDefinition.mode` 四档枚举（本套件不扩到 N 路信号网）。
- **不**在宿主为单个 type 开特例；舵机出线必须来自 pins 派生。
- 外设包仍禁止直连 `simulation-runtime`（本套件不碰仿真数据面）。
- 现有 led / button / oled / ultrasonic **视觉 parity**：必测网表 shape；button 的 pins SSOT 与旧硬编码不一致处，以 **pins 为准**并在 Task 中显式标注。
- 每个 Task 结束：相关 vitest 绿；涉及文档的 Task 同步改 `04-adding-a-peripheral.md`。
- Commit message 英文、原子化；一次 commit 一个逻辑模块。
- 本套件**不做**：外设↔外设直连、多点总线、`ConnectionEntry` 扩字段、项目 JSON 持久化大改。

---

## 1. 背景与问题

| 现象 | 原因 |
|------|------|
| 避障模板 `neck_servo` 有 `manifest.connections`，画布无连线 | `getNetDefinitions('servo')` 返回 `[]` |
| 按 `04-adding-a-peripheral` 加外设仍可能无线 | 走线网表是宿主硬编码平行 SSOT，文档未要求改它 |

数据分层（保持不变）：

```text
definition.pins     → 类型：脚几何 / 默认 /（本计划）wireNet
manifest.connections → 实例：接到板子哪脚
pinConnections      → 画布视图（hydrate）
NetDefinition[]     → 画哪几根线（本计划：由 pins 派生）
```

---

## 2. 文件结构（将创建 / 修改）

| 文件 | 职责 |
|------|------|
| `../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts` | `UnifiedPinDef` 增加可选 `wireNet` |
| `../../../../wink-ai/packages/embedded-frontend/src/peripherals/derive-net-definitions.ts` | **新建** 纯函数派生 `NetDefinition[]` |
| `../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts` | **新建** 派生单测 + 四外设 parity + servo/motor |
| `../../../../wink-ai/packages/embedded-frontend/src/types/peripheral-pins.ts` | `getNetDefinitions` 改为查 registry + derive；删 `netMaps` |
| `../../../../wink-ai/packages/embedded-frontend/src/peripherals/{led,button,oled,ultrasonic,servo,motor_driver_stub}/definition.ts` | 补齐 `wireNet` 注解（显式 > 启发式） |
| `../../../../wink-ai/packages/embedded-frontend/src/services/templates/avoidance-car-w2-minimal.ts` | `props` → `properties`（顺手） |
| `docs/design/05-frontend-workbench/04-adding-a-peripheral.md` | 文档：走线由 pins/`wireNet` 派生 |
| `../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/definition.ts` | 模板注释示例 `wireNet`（若存在 pins） |

**不改（仅消费旧 API）：** `useWireRendering.ts`、`useComponentDrag.ts`、`net-pin-resolver.ts`（签名保持）。

---

## 3. 派生规则（实现契约）

### 3.1 `wireNet` 字段

```ts
// UnifiedPinDef 新增
wireNet?: 'primary' | 'secondary' | 'vcc' | 'gnd';
```

- 同一 `wireNet` 的多个 pin → 同一 `NetDefinition.pinCandidates`（OR 候选，如按钮 `1.l`/`1.r`）。
- 未标注时走启发式（§3.2）；**已注册外设应显式标注**，避免超声 TRIG/ECHO 顺序颠倒。

### 3.2 缺省启发式（仅 fallback）

对每个 pin（按 `pins` 数组顺序）：

1. `signalType === 'power'`：
   - `defaultConnection === 'GND'` 或 `name === 'GND'` → `gnd`
   - `defaultConnection` 为 `VCC`/`3V3` 或 name 为 `VCC`/`3V3`/`VIN` → `vcc`
   - 其余 power → 忽略（不出线网）
2. `signalType` 为 `digital` | `i2c` | `custom`：
   - 按出现顺序，尚未占用的档位依次赋 `primary`，再 `secondary`
   - 第 3 个及以后 **静默忽略**（本套件不扩 mode；OLED 的 DC/RST/CS 与今日一致：默认不画）

### 3.3 `deriveNetDefinitions(pins)` 输出

对每个出现的 mode 生成一条：

```ts
{
  mode: 'primary' | 'secondary' | 'vcc' | 'gnd',
  signalType: 'digital' | 'i2c' | 'power',  // 取该组第一个 pin 的 signalType；power 网强制 'power'
  pinCandidates: string[],                 // 同 wireNet 的 name 列表，保持 pins 顺序
  defaultConnection?: PinConnectionValue,  // 组内第一个非 null/undefined 的 defaultConnection
}
```

返回顺序：`primary` → `secondary` → `vcc` → `gnd`（稳定，便于测）。

### 3.4 已注册外设显式 `wireNet`（parity 目标）

| type | primary | secondary | vcc | gnd |
|------|---------|-----------|-----|-----|
| `led` | `A` | — | — | `C` |
| `button` | `1.l`, `1.r` | — | — | `2.l` |
| `oled` | `DATA` | `CLK` | `3V3`, `VIN` | `GND` |
| `ultrasonic` | `ECHO` | `TRIG` | `VCC` | `GND` |
| `servo` | `SIG` | — | `VCC` | `GND` |
| `motor_driver_stub` | `PWM_LEFT` | `PWM_RIGHT` | `VCC` | `GND` |

**Button 物理/仿真一致性修复：** 旧 `buttonDefinition.pins` 中 `2.l` 默认连接被错误设置成了 `VCC`，导致与仿真注入行为（按下接地）冲突。本计划借此机会修正 `2.l` 默认连接为 `GND`，并标注其 `wireNet: 'gnd'`，从而保持 GND 连线，对齐物理逻辑。

---

## 4. 推荐执行顺序

```text
T1 类型 + derive 纯函数（TDD）
 → T2 getNetDefinitions 改走 registry
 → T3 外设 definition 标注 wireNet（含 servo/motor）
 → T4 模板 properties 修正
 → T5 文档 + 全量回归
```

> **执行提示：** Task 2 与 Task 3 建议同一 commit（或紧邻），避免 ultrasonic/servo 中间态红测。

---

### Task 1: `deriveNetDefinitions` 纯函数（TDD）

**Files:**
- Create: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/derive-net-definitions.ts`
- Create: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts`（`UnifiedPinDef.wireNet?`）

**Interfaces:**
- Consumes: `UnifiedPinDef` from `./types`；`NetDefinition` / `PinConnectionValue` from `@/types/peripheral-pins`
- Produces: `export function deriveNetDefinitions(pins: readonly UnifiedPinDef[]): NetDefinition[]`

- [ ] **Step 1: 扩展 `UnifiedPinDef`**

在 `types.ts` 的 `UnifiedPinDef` 增加：

```ts
  /**
   * 画布走线网角色。同 wireNet 的脚合并为一条 NetDefinition 的 pinCandidates。
   * 省略时由 deriveNetDefinitions 启发式推断（见 derive-net-definitions.ts）。
   */
  wireNet?: 'primary' | 'secondary' | 'vcc' | 'gnd';
```

- [ ] **Step 2: 写失败单测**

在 `derive-net-definitions.test.ts` 写入至少以下用例（完整内容以仓库实测为准，勿省略断言）：

1. 显式 `wireNet` 分组 + mode 顺序 `primary → vcc → gnd`
2. 同 `wireNet` 多脚合并 candidates，`defaultConnection` 取组内第一个非空
3. 无 `wireNet` 时启发式：power→vcc/gnd；信号脚按数组顺序 primary/secondary（**锁定启发式与 ultrasonic 旧表相反的契约**，故生产必须显式标注）
4. 第 3 个及以后无 `wireNet` 的信号脚忽略
5. **强约束校验**：校验核心/已注册外设中，凡包含 2 个及以上信号引脚的，必须显式标注 `wireNet`，不允许依赖隐式启发式分配。

- [ ] **Step 3: 跑测确认失败**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/peripherals/__tests__/derive-net-definitions.test.ts
```

Expected: FAIL（模块或函数不存在）

- [ ] **Step 4: 实现 `derive-net-definitions.ts`**

实现要点：

1. 先扫描所有显式 `wireNet === 'primary'|'secondary'`，占用信号槽
2. 再按 `pins` 顺序 `inferWireNet`（显式优先；power 按 default/name；信号占剩余 primary/secondary）
3. 按桶合并 `pinCandidates`；`defaultConnection` = 组内第一个非 `null`/`undefined`
4. 输出顺序固定：`primary` → `secondary` → `vcc` → `gnd`
5. `vcc`/`gnd` 的 `signalType` 强制 `'power'`；其余取组内首脚 `signalType`（`i2c` 保留，`custom` 映射为 `digital`）

- [ ] **Step 5: 跑测确认通过**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/peripherals/__tests__/derive-net-definitions.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add ../../../../wink-ai/packages/embedded-frontend/src/peripherals/types.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/derive-net-definitions.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts
git commit -m "feat(peripherals): derive canvas wire nets from pin wireNet"
```

---

### Task 2: `getNetDefinitions` 改走 registry

**Files:**
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/types/peripheral-pins.ts`（替换实现；删除 `netMaps`）
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts`（或新建 get-net 集成测）

**Interfaces:**
- Consumes: `registry` from `@/peripherals/registry`；`deriveNetDefinitions`
- Produces: 保持 `export function getNetDefinitions(type: string): NetDefinition[]`

- [ ] **Step 1: 改写 `getNetDefinitions`**

删除 `netMaps`。替换为：

```ts
import { registry } from '@/peripherals/registry';
import { deriveNetDefinitions } from '@/peripherals/derive-net-definitions';

export function getNetDefinitions(type: string): NetDefinition[] {
  const def = registry.get(type);
  if (!def) return [];
  return deriveNetDefinitions(def.pins);
}
```

**循环依赖护栏：** `registry.ts` 不得 import `peripheral-pins.ts`。若出现循环，把 `getNetDefinitions` 挪到 `peripherals/get-net-definitions.ts`，由 `peripheral-pins.ts` re-export；更新 `useWireRendering` / `useComponentDrag` 的 import 仅在必要时。

- [ ] **Step 2: 增加未知 type 断言**

```ts
expect(getNetDefinitions('unknown_xyz')).toEqual([]);
```

- [ ] **Step 3: 跑 resolver + derive 测**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/routing/__tests__/net-pin-resolver.test.ts src/peripherals/__tests__/derive-net-definitions.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**（若与 Task 3 合并则跳到 Task 3 统一提交）

```bash
git add ../../../../wink-ai/packages/embedded-frontend/src/types/peripheral-pins.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts
git commit -m "refactor(canvas): resolve getNetDefinitions via peripheral registry"
```

---

### Task 3: 外设 `pins` 标注 `wireNet` + parity 锁测

**Files:**
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/button/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/servo/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/definition.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts`

**Interfaces:**
- Consumes: Task 1–2
- Produces: §3.4 表由 `getNetDefinitions(type)` 测死

- [ ] **Step 1: 按 §3.4 给六个 definition 的 pins 加 `wireNet`**

关键：
1. ultrasonic **必须** `ECHO`→`primary`，`TRIG`→`secondary`。  
2. oled：仅 DATA/CLK/3V3/VIN/GND；DC/RST/CS 不标。  
3. button：`1.l`+`1.r`→`primary`；**修正 `2.l` 的 `defaultConnection` 为 `'GND'` 并设置 `wireNet: 'gnd'`**；`2.r` 不标。

- [ ] **Step 2: parity 测试**

对 `led` / `ultrasonic` / `oled` / `servo` / `motor_driver_stub` / `button` 断言 `getNetDefinitions(type)` 的各 mode → `pinCandidates` 等于 §3.4。测试文件顶部 `import '@/peripherals'`。

- [ ] **Step 3: 跑测**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/peripherals/__tests__/derive-net-definitions.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add ../../../../wink-ai/packages/embedded-frontend/src/types/peripheral-pins.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/led/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/button/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/ultrasonic/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/servo/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/motor_driver_stub/definition.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/derive-net-definitions.test.ts
git commit -m "refactor(canvas): pluginize wire nets from peripheral pins"
```

---

### Task 4: 避障模板 `properties` 修正

**Files:**
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/services/templates/avoidance-car-w2-minimal.ts`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/services/__tests__/manifest-to-canvas.test.ts`

**Interfaces:**
- Consumes: `DeviceEntry.properties`
- Produces: hydrate 后 `neck_servo.props` 含 `pwmChannel` / `minPulseMs` / `maxPulseMs`

- [ ] **Step 1: 模板 `props:` → `properties:`**

```ts
properties: {
  pwmChannel: 0,
  minPulseMs: 0.5,
  maxPulseMs: 2.5,
},
```

- [ ] **Step 2: 测试断言 `props` 含上述字段**

- [ ] **Step 3: 跑测**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/services/__tests__/manifest-to-canvas.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add ../../../../wink-ai/packages/embedded-frontend/src/services/templates/avoidance-car-w2-minimal.ts \
  ../../../../wink-ai/packages/embedded-frontend/src/services/__tests__/manifest-to-canvas.test.ts
git commit -m "fix(templates): use DeviceEntry.properties for neck_servo"
```

---

### Task 5: 文档回写 + 全量回归 + 人工门禁

**Files:**
- Modify: `docs/design/05-frontend-workbench/04-adding-a-peripheral.md`
- Modify: `../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/definition.ts`（若有 pins，加 `wireNet` 注释示例）

- [ ] **Step 1: 更新 `04-adding-a-peripheral.md`**

补充：

1. 画布走线由 `definition.pins` + 推荐显式 `wireNet` 派生；**禁止**再维护宿主 type→网表。
2. 实例连线仍在 `manifest.connections`。
3. `wireNet`：`primary` | `secondary` | `vcc` | `gnd`；同值合并 candidates。
4. 金样板：`servo/`、`ultrasonic/`（ECHO=primary）。

- [ ] **Step 2: 全量测**

```bash
cd ../../../../wink-ai/packages/embedded-frontend && bun test && bun run typecheck
```

Expected: 全绿

- [ ] **Step 3: 人工验收**

1. 避障模板 → `neck_servo` 三线可见  
2. OLED 模板 → I2C/电源线观感正常  
3. 拖拽舵机/超声 → 线跟随无报错  

- [ ] **Step 4: Commit**

```bash
git add docs/design/05-frontend-workbench/04-adding-a-peripheral.md \
  ../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/definition.ts
git commit -m "docs(workbench): document pin wireNet for canvas nets"
```

---

## 5. 非目标（本套件不做）

1. 扩展 `NetDefinition.mode` 超过 4 档（但 `deriveNetDefinitions` 内部实现应保持通道数组设计的灵活性，使未来平滑过渡到多信号总线如 SPI/UART 不受阻碍）。  
2. 给 button 增加新的物理引脚（直接修正 `2.l` 默认连接为 GND 即可恢复正常 GND 线网）。  
3. Manifest 拓扑增强（外设↔外设、总线）。  
4. HCTR 算法改动。  
5. 新开 ADR（默认文档回写即可；评审要求再补）。

---

## 6. 验收标准（套件级）

1. `peripheral-pins.ts` **无**按 type 硬编码网表。  
2. `getNetDefinitions('servo')` 非空，含 primary/vcc/gnd。  
3. ultrasonic primary=`ECHO`。  
4. 避障模板 `neck_servo` 使用 `properties`，hydrate 含 pulse 配置。  
5. `04-adding-a-peripheral.md` 写明 wireNet。  
6. `npm test` 全绿；人工确认舵机三线可见。

---

## 7. 风险与缓解

| 风险 | 缓解 |
|------|------|
| registry ↔ peripheral-pins 循环依赖 | derive 放 peripherals；必要时搬家 getNetDefinitions |
| button 去掉假 gnd | 文档声明；人工看 OLED；不阻塞舵机 |
| 启发式 TRIG/ECHO 颠倒 | ultrasonic 强制显式 wireNet + parity 测 |
| Task 2/3 中间态红 | 同 commit 或紧邻提交 |

---

## 8. 文档变更记录

- 2026-07-12：初稿 — pins/`wireNet` 派生网表；删硬编码表；模板 properties；文档回写。

---

## Spec self-review

| 需求 | Task |
|------|------|
| 从 pins 派生网表 | T1 |
| 删硬编码表 | T2 |
| 舵机/电机出线 | T3 |
| 旧外设 parity | T3 |
| 模板 props→properties | T4 |
| 文档对齐加外设流程 | T5 |
| 不扩 Manifest/HCTR | Constraints / 非目标 |
