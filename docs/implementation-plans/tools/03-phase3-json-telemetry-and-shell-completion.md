# 阶段三详细计划：JSON Envelope 结构化载荷与 Shell 双端补全 (Phase 3 Detailed Plan - Rev.5)

> **归属计划**：`2026-08-06-wink-tools-architecture-evolution-plan`  
> **实施目标**：提供带 `result` 载荷的 JSON Envelope 通信协议与涵盖 `pack`/`i18n` 的 Bash/PowerShell 双端补全  

---

## 1. 目标与设计考量 (Goal & Scope)

阶段三聚焦于构建**系统级的外部集成能力**：
1. **带 `result` 载荷的 JSON Envelope 协议 (ADR-0062)**：通过 Dispatcher 的 `try...finally` 统一组包，增加 `result` 字典传输非文件类的结构化数据（如 `doctor` 的探针健康列表）。
2. **Strict Stdout/Stderr 隔离**：硬性约束 `stdout` 在 `--json` 模式下**有且仅有**一个 JSON 字符串，所有诊断日志保持输出到 `stderr`，保障 CI/CD 与 IDE 可调试性。
3. **Bash & PowerShell 双端自动补全**：为团队主流平台（Windows PowerShell / Linux & macOS Bash）提供原生的动态 Tab 补全脚本，涵盖 13 个全量核心动词（含 `pack` 与 `i18n`）。

---

## 2. 详细技术实现方案 (Technical Design)

### 2.1 Dispatcher 驱动的 JSON Envelope 组包机制 (带 result 载荷)

在 `tools/cli/dispatcher.py` 的 `dispatch()` 函数中，采用 `try...finally` 包裹命令执行：

```python
import time
import json

def dispatch(ctx: AppContext, argv: list[str] | None = None) -> Optional[int]:
    ...
    start_time = time.monotonic()
    rc = 1
    cmd_name = getattr(args, "command", "unknown")

    try:
        cmd_obj = CommandRegistry.create(cmd_name)
        rc = cmd_obj.run(ctx, args) or 0
    except SystemExit as e:
        rc = e.code if isinstance(e.code, int) else 1
    except Exception as e:
        rc = 1
        console.error(f"{type(e).__name__}: {e}")
    finally:
        duration_ms = int((time.monotonic() - start_time) * 1000)
        if getattr(args, "json_mode", False):
            envelope = {
                "schema_version": 1,
                "status": "success" if rc == 0 else "error",
                "command": cmd_name,
                "exit_code": rc,
                "duration_ms": duration_ms,
                "artifacts": [str(p) for p in console.artifacts],
                "result": console.result,  # 支持 doctor 探针列表等结构化载荷！
                "errors": [r.message for r in console.records if r.level == "ERROR"],
                "warnings": [r.message for r in console.records if r.level == "WARN"],
            }
            # Output EXACTLY ONE JSON object on stdout!
            print(json.dumps(envelope, ensure_ascii=False, indent=2))

    return rc
```

### 2.2 Shell 双端补全代码生成器 (`tools/cli/commands/completion.py`)

涵盖全量 13 个核心动词：
`build dev create gen schema pack i18n esp32 web test doctor setup lint`

#### PowerShell Completer (Windows 主力)
```powershell
Register-ArgumentCompleter -Native -CommandName wink -ScriptBlock {
    param($wordToComplete, $commandAst, $cursorPosition)
    $verbs = @("build", "dev", "create", "gen", "schema", "pack", "i18n", "esp32", "web", "test", "doctor", "setup", "lint")
    
    if ($commandAst.Elements.Count -le 2) {
        $verbs | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
            [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
        }
    }
}
```

#### Bash Completer (Linux / macOS)
```bash
_wink_completion() {
    local cur prev
    _init_completion || return
    local verbs="build dev create gen schema pack i18n esp32 web test doctor setup lint"
    if [ $cword -eq 1 ]; then
        COMPREPLY=( $(compgen -W "${verbs}" -- ${cur}) )
        return 0
    fi
}
complete -F _wink_completion wink
```

---

## 3. 逐项修改清单 (Files Modified)

| 变更类型 | 文件路径 | 描述 |
| :--- | :--- | :--- |
| **[MODIFY]** | [dispatcher.py](../../../../../wink-tools/tools/cli/dispatcher.py) | 增加 `try...finally` 结构的 JSON Envelope 输出 (含 `result` 载荷) |
| **[NEW]** | `tools/cli/commands/completion.py` | 实现包含 `pack`/`i18n` 的 `wink completion` 双端脚本生成器 |
| **[MODIFY]** | [doctor.py](../../../../../wink-tools/tools/cli/commands/doctor.py) | 使用 `console.set_result(data)` 格式化导出全量探针报告 |
| **[NEW]** | `tools/tests/test_cli_json_mode.py` | 验证 `stdout` 仅包含合法 JSON，`stderr` 保留日志输出 |
| **[NEW]** | `tools/tests/test_cli_completion.py` | 验证 Bash 与 PowerShell 脚本生成成功 |

---

## 4. 阶段三验收标准 (Acceptance Criteria)

1. **JSON Envelope & doctor 探针验证**：
   - 运行 `python wink-tools/wink.py doctor --json`
   - **验证**：`stdout` 成功捕获到符合 `schema_version: 1` 的 JSON 对象，且 `result` 字段包含完备的工具链探针数据，日志全部在 `stderr` 中。
2. **PowerShell / Bash 双端补全脚本验证**：
   - 运行 `python wink-tools/wink.py completion powershell`
   - 运行 `python wink-tools/wink.py completion bash`
   - **验证**：均包含正确的 13 个全量动词列表，且无报错生成补全脚本。
