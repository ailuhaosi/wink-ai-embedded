# W6 文档回写与 Schema 闭环

| 项 | 内容 |
|----|------|
| 阶段 | W6 |
| 预估工期 | ~0.5 天 |
| 前置依赖 | W5 因果链 MVP 完成（W4 可与 W5 并行，但 W6 需全阶段验收通过） |
| 产出物 | Manifest schema v2 正式回写、实施计划同步、导航索引、迁移脚本规格 |
| 里程碑 | 设计规范 / 实施计划 / TypeScript 类型三者一致 |
| 关联总纲 | [00-master-plan.md](./00-master-plan.md) §9–§10 |

---

## 1. 目标

1. 将 W2 定义的 `mechanical` / `environment` / `bindings` 正式写入 [`02-project-manifest-schema.md`](../../03-app-codegen/02-project-manifest-schema.md)
2. 同步 [`02-dual-viewport-product-world-layout.md`](../02-dual-viewport-product-world-layout.md) §8 与分阶段文档中的字段命名（以 schema 规范为准）
3. 将 [`implementation-plans/2026-07-09-dual-viewport-layout-plan.md`](../../../implementation-plans/frontend/2026-07-09-dual-viewport-layout-plan.md) 标记为 **归档**，指向本目录为执行 SSOT
4. 定义 `manifest-migration.ts` 验收标准（实现可在 W2 启动，W6 验收）
5. 评估并记录 Three.js 域边界是否需要 ADR

---

## 2. 回写清单

| # | 动作 | 目标文件 | 验收 |
|---|------|----------|------|
| D1 | 新增 §mechanical / §environment / §bindings 正式章节 | `03-app-codegen/02-project-manifest-schema.md` | JSON 示例与 W2 types 一致 |
| D2 | `schemaVersion: 2` 迁移说明 + v1→v2 规则 | 同上 §迁移 | 与 `manifest-migration.ts` 行为一致 |
| D3 | 更新中心区域描述 + 分阶段设计链接 | `01-frontend-workbench-architecture.md` | 交叉引用有效 |
| D4 | 更新 §15 实施状态为已完成 | `02-dual-viewport-product-world-layout.md` | 链接 phased-design |
| D5 | 导航增加 `03-dual-viewport-phased-design/` | `docs/design/README.md` | 可点击 |
| D6 | 实施计划 v1.1：W3→W3a/b/c、SSOT 指向 | `implementation-plans/2026-07-09-dual-viewport-layout-plan.md` | 状态 Archived |
| D7 | Wasm 桥接契约回写（若 W3 spike 有结论） | `04-wasm-simulation/` 或 `tech-designs/` | 与 W3c/W4 桥接表一致 |
| D8 | ADR 评估结论记录 | `00-master-plan.md` §9 或新 ADR | Accepted / 不需要 |

---

## 3. Schema 回写内容纲要

回写至 `02-project-manifest-schema.md` 时须包含（字段名严格遵循 [00-master-plan.md](./00-master-plan.md) §10）：

### 3.1 顶层

- `schemaVersion: 2` 时可选三节：`mechanical`、`environment`、`bindings`
- v1 项目加载时三节默认为空对象/空数组，不阻断

### 3.2 `mechanical`

- `parts[]`：`partId`, `modelId`, `displayName`, `parentPartId?`, `transform`, `physics`
- `joints[]`：`jointId`, `type`, `parentPartId`, `childPartId`, `axis`, `limits?`

### 3.3 `environment`

- `props[]`：`propId`, `modelId`, `transform`, `physics?`, `properties?`（如火源 `coreTemperatureC`）
- `fields[]`：`fieldId`, `type`, `valueC`（温场）, `falloff?`, `falloffRadiusM?`, `region?`

> **注意**：分阶段文档早期草稿使用 `intensity` 表示环境温度，**正式 schema 统一为 `valueC`**（与上游 02 布局规范一致）。

### 3.4 `bindings`

- `actuators[]`：`bindingId`, `deviceComponentId`, `pin`, `mechanicalJointId?`, `mechanicalPartId?`, `mapping`
- `sensors[]`：`bindingId`, `deviceComponentId`, `mechanicalPartId?`, `environmentPropId?`, `mapping`
- `displays[]`：`bindingId`, `deviceComponentId`, `mechanicalPartId?`, `mapping`

### 3.5 绑定校验规则

回写 B-01～B-08（含 B-07 扩展，见 W2 §3.2）。

---

## 4. `manifest-migration.ts` 验收标准

| 用例 | 输入 | 期望输出 |
|------|------|----------|
| M-01 | `schemaVersion: 1`，无 mechanical | `schemaVersion: 2`，三节空数组 |
| M-02 | `schemaVersion: 2`，缺 bindings | 补全 `bindings: { actuators:[], sensors:[], displays:[] }` |
| M-03 | 未知 `schemaVersion: 99` | 抛出可读错误 |
| M-04 | v2 完整样例 round-trip | `JSON.stringify` 后关键字段不变 |

实现位置：`../../../../../wink-ai/packages/embedded-frontend/src/services/manifest-migration.ts`（W2 创建，W6 验收）。

---

## 5. 实施计划归档模板

在 `2026-07-09-dual-viewport-layout-plan.md` 头部追加：

```markdown
> **归档说明（2026-07-09）**：执行细节已拆至
> [`03-dual-viewport-phased-design/`](../../../README.md)。
> 本文保留为背景与工时汇总；**以分阶段设计目录为 SSOT**。
```

计划状态改为：`📦 已归档（v1.1）→ 见 phased-design`。

---

## 6. ADR 评估（Three.js 域边界）

| 问题 | 选项 | 建议 |
|------|------|------|
| 是否需要 ADR-00XX？ | A. 不需要（已在 ADR-0009 双域模型覆盖） | **默认采纳 A** |
| | B. 新 ADR 明确 JS 3D 域 / Wasm 域 import 白名单 | 若 W3 spike 发现新边界再开 |

评估结论写入 D8，若选 B 则 W6 阻塞于 ADR Accepted。

---

## 7. 验收标准

| # | 验收项 | 验证方法 |
|---|--------|----------|
| A1 | `02-project-manifest-schema.md` 含 v2 三节完整定义 | 人工对照 W2 types |
| A2 | 三份文档字段名零冲突（schema / 02-layout / W2 types） | diff 检查 |
| A3 | `docs/design/README.md` 含 phased-design 导航 | 链接有效 |
| A4 | 实施计划已归档并指向 phased-design | 阅读 header |
| A5 | `manifest-migration` Vitest M-01～M-04 通过 | `npm run test` |
| A6 | ADR 评估结论已记录 | 00 §9 或 decisions/ |

---

*文档变更记录：*

- 2026-07-09：初版创建（评审修补清单 #7）。

