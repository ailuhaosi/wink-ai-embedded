# CLAUDE.md — Wink-AI 嵌入式（WinkMicroOS）

> 本文件是 Claude Code 在本项目的必读指南，每次会话启动时加载。

## Repository Overview
Wink-AI 嵌入式运行时及仿真系统（**WinkMicroOS**）：面向 AI 生成嵌入式应用的低代码开发平台。
实现可视化/AI 生成的业务逻辑在浏览器 Wasm 仿真（行为级高保真）与 ESP32 物理硬件上的同源编译与执行。

## Key Components

### 1. 运行时内核 (`wink-micro-os/`)
- **PAL (Platform Abstraction Layer)**: [pal/include/](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/pal/include/) — 平台无关 OSAL 与 HAL API。
- **DAL (Device Abstraction Layer)**: [dal/include/](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/dal/include/) — 语义级器件驱动 API（如舵机、超声波）。
- **Targets**: [targets/](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/targets/) — Wasm 仿真与真机（ESP32）的 OSAL/HAL 实现适配。

### 2. 设计文档库 (`docs/design/`)
- **设计规范** (`01~07/`): 活文档，代表系统的最新设计真相。
- **评审记录** (`reviews/`): 时间点快照，归档后不可修改。
- **架构决策 (ADR)** (`decisions/`): 重大决策记录（如 [ADR-0001](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0001-error-code-sign-convention.md), [ADR-0004](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md)）。

## Critical Patterns
- **编译期静态分发**: 偏离传统 C 语言 OOP 多态，不使用虚拟函数表或 `container_of` 强转。DAL 外设实例使用 POD 结构体与命名 API（详见 [ADR-0004](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md)）。
- **负数错误码**: 所有可能失败的函数返回 `wink_status_t`，**0 = 成功，负数 = 错误**（详见 [ADR-0001](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0001-error-code-sign-convention.md)）。
- **双 target 同源编译**: 编写的 C 代码必须同时兼容 Emscripten/wasm32 与 ESP-IDF/xtensa 编译（详见 [ADR-0002](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0002-dual-target-compilation.md)）。

## Git Commit Rules
- 保持提交的原子性。推荐对修改过的文件分别提交（每次 commit 按一个独立逻辑模块聚合）。
- Commit message 使用英文描述，清晰阐明变更意图并关联相关决策。

## Workflow Best Practices
- **规划与确认**: 复杂变更必须先产出实施计划（Implementation Plan）并获得用户确认。
- **决策结论回写**: 重大决策（ADR）在 Accepted 后，**必须立刻**回写并更新至对应的 `01~07` 设计规范中。
- **Bypass 范围收窄**: 仿真隔离代码（`#ifdef SIMULATION`）应尽可能置于底层，以确保更多协议代码被同源测试。

## Documentation
- 详细 C 编码与 API 规范见 [.claude/rules/c-code.md](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/.claude/rules/c-code.md)。
- 详细文档库组织与 ADR 规范见 [.claude/rules/docs-adr.md](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/.claude/rules/docs-adr.md)。
