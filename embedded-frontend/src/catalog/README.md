# Device Catalog — 四目录关系说明

工作台里「器件从哪来、查哪去」的分层说明。四个目录**并列**，不合并父目录；关联通过 **SSOT + Facade** 表达。

## 总览

```
peripherals/     boards/          world-assets/
  (电路外设 SSOT)  (开发板 SSOT)    (机械/环境 SSOT)
       \              |                  /
        \             |                 /
         v            v                v
              catalog/  ← 只读 Facade（merge + query）
                    |
        资产库 / binding 校验 / Manifest / pin-resolver
```

| 目录 | 职责 | 手写入口 | 查询 API |
|------|------|----------|----------|
| [`peripherals/`](../peripherals/) | 电路域外设插件（引脚、画布、世界视口、仿真 observe） | `*/definition.ts` | `registry` → `deviceCatalog.listDevices()` |
| [`boards/`](../boards/) | 开发板（GPIO 能力、Board 画布布局） | `*/definition.ts` | `boardRegistry` → `deviceCatalog.getBoard()` |
| [`world-assets/`](../world-assets/) | 机械零件、环境道具（无电路引脚） | `mechanical/builtin.ts` 等 | `worldRegistry` → `listMechanicalModels()` |
| **`catalog/`（本目录）** | **聚合 Facade**，禁止手写业务条目 | 仅 `derive-*.ts` 派生逻辑 | `deviceCatalog` |

项目级 binding 实例不在以上目录，而在 Manifest `bindings.*`。

---

## 数据流

### 1. 注册（启动时 side-effect import）

```ts
// device-catalog.ts 顶部
import '@/peripherals';   // registry.register(...)
import '@/boards';       // boardRegistry.register(...)
import '@/world-assets'; // worldRegistry.register(...)
```

### 2. 派生（catalog 内）

| 文件 | 输入 | 输出 |
|------|------|------|
| `derive-catalog-entry.ts` | `PeripheralDefinition` | `DeviceCatalogEntry`（含 pins、worldCoupling） |
| `derive-board-catalog-entry.ts` | `BoardDefinition` | board 型 `DeviceCatalogEntry` |

引脚 SSOT 在 `peripherals/definition.pins[]`（含 `catalogType`），**不在** `catalog.pins` 手写。

### 3. 消费（业务只读 `deviceCatalog`）

- **资产库** — `listDevices()` / `listBoards()` / `listMechanicalModels()`
- **绑定校验** — `getDevice(modelId).simulation.worldCoupling`、`pins`
- **Manifest → 画布** — `canvasTypeForModelId()`、`getBoard()`
- **引脚解析** — `getBoard(manifest.target.boardId).gpioPins`

画布渲染、属性面板、仿真 observe 仍直接读 **`registry.get(type)`**（peripherals 插件能力）。

---

## 新增器件 Checklist

### 电路外设（可拖拽、有引脚）

1. 复制 `peripherals/_template/` → `peripherals/<type>/`
2. 填写 `definition.ts`（`pins[]` + `catalog` + **必选** `CanvasGlyph.vue`）
3. `peripherals/index.ts` 增加 `import './<type>'`
4. 跑 `npm test`（含 `catalog-mapping-consistency`）

### 开发板

1. 复制 `boards/esp32-devkit-v1/` → `boards/<boardId>/`
2. 在 `boards/index.ts` 注册

### 机械 / 环境

1. 在 `world-assets/mechanical/` 或 `environment/` 增加定义
2. 在 `world-assets/index.ts` 注册

### 禁止

- 在 `device-catalog.ts` 手写 `category: 'peripheral' | 'stub' | 'board'` 条目
- 在 `catalog` 与 `pins[]` 双写引脚
- 在 `simulation` 与 `catalog` 双写 `worldCoupling`

---

## 何时需要改 `catalog/`？

**不是「永远不改」**，而是**不在这里手写具体器件**。边界如下：

| 场景 | 改哪里 | 是否动 `catalog/` |
|------|--------|-------------------|
| 新增 LED / 传感器 / stub 外设 | `peripherals/<type>/` | ❌ 通常不需要 |
| 新增 ESP32 以外的开发板 | `boards/<boardId>/` | ❌ 通常不需要 |
| 新增 chassis / 围墙等世界资产 | `world-assets/` | ❌ 通常不需要 |
| 调整 `pins[]` → catalog 派生规则 | `derive-catalog-entry.ts` | ✅ 要改 |
| 扩展统一查询 API（新 filter、别名） | `device-catalog.ts` | ✅ 要改 |
| 新增第四种 SSOT 来源（如新总线注册表） | `device-catalog.ts` merge 逻辑 | ✅ 要改 |
| 交叉校验（mapping、merge 契约） | `catalog/__tests__/` | ✅ 要改 |

**记忆口诀：**

- **改「有什么器件」** → 声明层（`peripherals` / `boards` / `world-assets`）
- **改「怎么查、怎么合并、怎么校验」** → `catalog/`

---

## 与平台文档

- [如何新增外设](../../../docs/design/05-frontend-workbench/04-adding-a-peripheral.md)
- [Catalog SSOT 收敛计划](../../../docs/design/implementation-plans/2026-07-11-catalog-ssot-convergence-plan.md)
- [Device Model Registry §9 前端映射](../../../docs/design/07-platform-governance/01-device-model-registry.md)
