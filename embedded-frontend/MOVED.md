# ⚠️ MOVED — 代码已迁移到主仓库

Embedded Workbench 前端源码已迁移到 Wink-AI 主 monorepo：

**新位置**：[`wink-ai/packages/embedded-frontend/`](../../wink-ai/packages/embedded-frontend/)

本目录下的源码已删除，不再维护。设计文档（SSOT）仍在：

- [`wink-ai-embedded/docs/design/05-frontend-workbench/`](../docs/design/05-frontend-workbench/) — 工作台前端架构
- [`wink-ai-embedded/docs/design/04-wasm-simulation/`](../docs/design/04-wasm-simulation/) — 仿真引擎设计
- [`wink-ai-embedded/docs/design/decisions/`](../docs/design/decisions/) — ADR 决策记录

## 开发命令迁移

```bash
cd ../../wink-ai/packages/embedded-frontend
bun run dev               # Vite dev server :5174（base=/simulator/）
bun run build             # 构建到 ../frontend/public/simulator
bun run wasm:build:oled   # 构建 oled_dashboard 示例 wasm（自动调用 ../wink-ai-embedded/wink-tools/wink.py）
bun run wasm:build:avoidance
bun run test              # Vitest 单元测试
bun run test:e2e          # playwright-cli e2e
```

## 架构概览

详见 [`../../wink-ai/packages/embedded-frontend/README.md`](../../wink-ai/packages/embedded-frontend/README.md)：

- 控制面/数据面分离（Pinia vs shallowRef）
- Web Worker 驱动 @wink-ai/unisim 仿真引擎
- iframe 宿主模式（`/simulator/?projectId=...&backendUrl=...`）
- 外设插件系统（`peripherals/registry.ts`）
- SSE wasm 构建流（`/api/projects/:id/unisim/build-stream`）
