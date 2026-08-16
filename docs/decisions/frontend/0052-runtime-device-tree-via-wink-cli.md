# ADR-0052：Runtime DeviceTree 经 wink CLI（Python frontend SSOT）

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-31 |
| 触发 | `backend-hono` 运行时依赖 `@wink-ai/unisim` 做 `wink-app.json → RuntimeDeviceTree`；部署/workspace 耦合重；希望与 C `app_codegen` 一样经 wink CLI 取产物 |
| 影响范围 | `wink-tools/tools/frontend/`；CLI `frontend-app-device-tree`；`backend-hono` DeviceTree API；`embedded-frontend` static public JSON；unisim `gen-device-tree-catalog --emit-frontend-manifest` |
| 决策者 | 项目 Owner |
| 关联 ADR | ADR-0004（静态分发）；本仓与 wink-ai 双仓同步约束 |
| 关联实现计划 | wink-ai `docs/superpowers/plans/2026-07-31-wink-frontend-app-device-tree.md` |

---

## 背景（Context）

1. 模板 micro-app 的 SSOT 仍是 `wink-micro-app/{code}/wink-app.json`。
2. 前端仿真需要 `RuntimeDeviceTree`（package pin 名 + board I2C 继承）。
3. 先前在 hono 进程内 import `@wink-ai/unisim` 做转换，使后端运行时绑定整个 unisim 包。
4. C 侧已有 `tools/codegen/app_codegen.py`；前端转换不应写入 codegen 主路径，但应落在 wink-tools 并由同一 CLI 网关调用。

## 方案比选（Options）

| 方案 | 做法 | 结论 |
|------|------|------|
| A. 保留 unisim 运行时依赖 | hono 继续 `buildDeviceTreeObject` | ❌ workspace 部署复杂、启动耦合 |
| B. 在 hono 内重写转换 | 纯 TS 复刻 | ❌ 与 catalog / manifest 漂移风险 |
| **C. Python `tools/frontend/runtime_device_tree.py` + CLI + emit `manifest_index.json`** | hono spawn wink CLI；pin/property SSOT 由 unisim emit | ✅ **采纳** |

## 决策结论（Decision）

1. **Python** `wink-tools/tools/frontend/runtime_device_tree.py` 为运行时转换实现（与 C `app_codegen` 并列、互不污染）。
2. **unisim** `gen-device-tree-catalog.ts --emit-frontend-manifest` 产出 `manifest_index.json`（完整 pin：`name` / `aliases` / `required` / `direction` + properties + `i2c_role`），提交于 **embedded** 仓。
3. **CLI** `frontend-app-device-tree`：stdout 纯 JSON；校验错误 stderr 为结构化 JSON line；exit 2 = 校验失败。CLI/hono **恒 strict**。
4. **hono** `GET /api/unisim/device-tree/:projectCode` 经 `WinkCliService.exportAppDeviceTree` 取树；去掉 `@wink-ai/unisim` 运行时依赖。
5. **static**（`?wasmSource=dev`）：`public/template-projects/device-tree/{code}.json`；长期只保留 public 为 static SSOT，catalog 仅 sync 测试 fallback。

## 后果与约束（Consequences）

- 改 builtin manifest 后必须：unisim emit → 提交 embedded `manifest_index.json` → 再合 PR。
- 每次 GET spawn Python 有冷启动延迟；本轮不缓存（Deferred）。
- 验收：CLI 产物与 catalog **语义 deep-equal**，不要求字节级一致。

## 回写活规范

见 [04-integration-with-wink-ai.md](../../design/01-system-overall/04-integration-with-wink-ai.md) Runtime DeviceTree 段。

