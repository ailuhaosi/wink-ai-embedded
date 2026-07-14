# ⚠️ MOVED — 代码已迁移到主仓库

`@wink-ai/unisim`（Wink-AI 统一仿真引擎）源码已迁移到 Wink-AI 主 monorepo：

**新位置**：[`wink-ai/packages/unisim/`](../../wink-ai/packages/unisim/)

本目录下的源码已删除，不再维护。设计文档（SSOT）仍在：

- [`wink-ai-embedded/docs/design/04-wasm-simulation/`](../docs/design/04-wasm-simulation/) — UniSim 引擎设计
- [`wink-ai-embedded/docs/design/decisions/`](../docs/design/decisions/) — ADR 决策记录（0002/0003/0004/0009/0017/0025 等）
- [`wink-ai-embedded/wink-micro-os/targets/wasm/wasm_bridge.h`](../wink-micro-os/targets/wasm/wasm_bridge.h) — C 侧 ABI SSOT

## 开发命令迁移

```bash
cd ../../wink-ai
bun run build             # 构建所有包（含 @wink-ai/unisim）
cd packages/unisim
bun test                  # 运行所有测试（含 ssotAlignment 契约校验）
```

## 核心模块

详见 [`../../wink-ai/packages/unisim/README.md`](../../wink-ai/packages/unisim/README.md)：

- `core/pin-arbiter.ts` — 4 值逻辑（0/1/Z/X）+ 3 级驱动强度引脚仲裁
- `core/peripheral-registry.ts` — 虚拟外设生命周期与电源域
- `core/VirtualClock.ts` — μs 精度 bigint 确定性虚拟时钟
- `bridge/` — WASM ↔ JS 桥接（createUnisimImports / I2CBus / InterruptQueue / Emscripten 适配器）
- `worker/SimWorker.ts` — Web Worker 编排器（前端 Worker 唯一入口）
- `worker/WasmPhysicalBridge.ts` — 物理退化桥与故障注入
