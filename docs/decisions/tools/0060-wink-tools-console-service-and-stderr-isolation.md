# ADR-0060：`ConsoleService` 累积服务与 Stderr 日志隔离协议

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-06 |
| 决策者 | 项目架构师与 CLI 开发团队 |
| 关联计划 | [2026-08-06-wink-tools-architecture-evolution-plan](../../implementation-plans/tools/00-master-architecture-evolution-plan.md) |

---

## 背景（Context）

在过去，`wink-tools` CLI 内散落着直接调用 `print()` 和 `sys.stderr.write()` 的代码。这导致：
1. `--quiet`、`--verbose` 与 `--json` 等全局控制选项无法全局统一干预控制台输出；
2. 命令执行过程中的 Warning 和 Error 容易写到 `stdout`，打断与下游工具（如 IDE、前端 Web 界面或 CI 脚本）的 JSON 管道通信；
3. 没有统一的记录/结构化载荷累积器，导致无法优雅收集命令产物 Path 与 Telemetry 结果数据。

## 决策（Decision）

### D1. 建立全局不可变 `ConsoleService`
- 定义在 `tools/cli/console.py` 中，支持记录 `LogRecord`（级别与消息）、生成的 `artifacts` Path 列表及 `result` 结构化载荷字典。
- 注入至 `AppContext` 中（`console: ConsoleService = field(default_factory=ConsoleService)`），Dispatcher 解析全局标志后，安全更新 Context 绑定的 `ConsoleService`。

### D2. Stderr 严格日志隔离
- `info()`：普通日志，在非 `--quiet` 且非 `--json` 模式下输出到 `stdout`。
- `warn()` 与 `error()`：警告与错误日志，在非 `--quiet` 模式下**始终输出到 `stderr`**，严禁污染 `stdout`。
- `--json` 模式下，`stdout` 被独占留给系统生成的唯一 JSON Envelope。

---

## 后果与约束（Consequences & Constraints）

- **正向**：彻底解决日志污染 JSON 管道的问题；控制台输出可控性强；便于结构化收集诊断与调试信息。
- **约束**：所有 CLI 命令处理逻辑应统一使用 `ctx.console.info()` / `warn()` / `error()`，避免随意直接调用 `print()`。

