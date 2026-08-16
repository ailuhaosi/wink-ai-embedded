# ADR-0061：第三方 CLI 插件动态发现与信任边界

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-06 |
| 决策者 | 项目架构师与 CLI 开发团队 |
| 关联计划 | [2026-08-06-wink-tools-architecture-evolution-plan](../../implementation-plans/tools/00-master-architecture-evolution-plan.md) |

---

## 背景（Context）

随着 `wink-tools` 生态向多芯片架构、仿真扩展与外部工具链开放，硬编码所有 CLI 命令不再满足扩展需求。需要设计一套标准化的插件发现与动态扩展机制，允许第三方 Python 包或外部模块无缝向 `wink` 注册新子命令。

## 决策（Decision）

### D1. 基于 `@command` 装饰器与 `entry_points` 动态发现
- `wink-tools` Dispatcher 扫描 `wink_tools.plugins` 组下的 Python `entry_points`。
- 动态加载符合 `CommandBase` 契约并标有 `@command` 装饰器的命令类，将其挂载至 `wink` 主命令树。

### D2. 全信任模型 (Full-Trust Model)
- 由于 `wink-tools` 为 SDK/CLI 本地构建调度工具，插件继承宿主 Python 进程的所有权限与 `AppContext` 访问权。
- 插件加载时仅验证命令名称不与内置命令命名冲突（若冲突优先保留内置命令并向 `stderr` 打印 Warning）。

---

## 后果与约束（Consequences & Constraints）

- **正向**：高扩展性，解耦核心 SDK 工具链与领域扩展；第三方驱动/仿真插件可独立发布并无缝集成。
- **约束**：命名冲突时内置命令优先级更高；插件异常由全局 dispatcher catch 并隔离。

