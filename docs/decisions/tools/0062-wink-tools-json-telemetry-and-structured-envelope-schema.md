# ADR-0062：`--json` 模式下的系统级 Telemetry Schema 规范

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-06 |
| 决策者 | 项目架构师与 CLI 开发团队 |
| 关联计划 | [2026-08-06-wink-tools-architecture-evolution-plan](../../implementation-plans/tools/00-master-architecture-evolution-plan.md) |

---

## 背景（Context）

命令行工具在自动化 CI/CD 管道、IDE 插件集成以及 Web 前端 Workbench 中往往需要通过 `--json` 提取结构化报告（例如 `wink doctor --json`）。缺乏统一 Schema 格式会导致上游了解解析失败，且难以统一传输日志记录与生成产物。

## Decision（决策）

### D1. 标准 JSON Envelope 载荷规范
当用户指定 `--json` 全局标志时，`wink` Dispatcher 在命令执行完（无论成功还是捕获异常）之后，在 `try-finally` 块中通过 `stdout` 输出且仅输出一份标准 JSON 载荷：

```json
{
  "schema_version": "1.0",
  "command": "doctor",
  "success": true,
  "exit_code": 0,
  "result": { ... },
  "artifacts": [ "build/doctor_report.json" ],
  "logs": [
    { "level": "INFO", "message": "Checking toolchain..." }
  ]
}
```

### D2. `stdout` 独占与 `stderr` 辅助
- `stdout` 严格用于输出且仅输出上述格式的 JSON Envelope 字符串。
- 人类可读日志、实时编译进度输出（当未加 `--quiet` 时）输出到 `stderr`。

---

## 后果与约束（Consequences & Constraints）

- **正向**：为上游自动化、IDE 插件提供 100% 稳定可靠且严格 Schema 校验的结构化交互数据。
- **约束**：命令逻辑中不得随意 `print(json)`，必须通过 `ctx.console.set_result(data)` 传递载荷，由 Dispatcher 统一包装输出。

