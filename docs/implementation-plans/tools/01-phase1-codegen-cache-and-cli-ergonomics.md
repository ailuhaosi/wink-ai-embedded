# 阶段一详细计划：原子级代码生成增量 Skip 与 Console 累积服务 (Phase 1 Detailed Plan - Rev.4)

> **归属计划**：`2026-08-06-wink-tools-architecture-evolution-plan`  
> **实施目标**：消除 CMake/Ninja 依赖抖动下的级联重编译，提供线程安全且带数据累积的 ConsoleService  

---

## 1. 目标与真实场景定位 (Goal & Scope)

### 1.1 精准定位问题
在 CMake 构建流程中，`wink-micro-app/*/CMakeLists.txt` 与 `wink-micro-os/CMakeLists.txt` 通过 `add_custom_command` 绑定了 `DEPENDS`（包含 `wink-app.json`、`app_codegen.py`、模板与 drivers）。
当开发者切换 git 分支或触碰 `DEPENDS` 文件导致 mtime 改变时，CMake 会强制重跑 codegen。如果不做内容比对，直接覆盖生成的头文件（如 `device_tree.h`），会导致包含该头文件的所有 C 源文件全量重新编译。

### 1.2 阶段一核心任务
1. **原子级增量 Skip 写入器**：改写 `tools/codegen/app_codegen.py` 与 `tools/codegen/config_h.py`，采用字节比较 + 临时文件替换，保持相同内容的 mtime 不变。
2. **ConsoleService 累积服务与全局 Flag 注册**：构建支持 `result/artifacts/records` 累积与 `stderr` 隔离的 ConsoleService，在 Dispatcher 的 `global_parent` 中注册全局标志。
3. **测试发现网齐备**：修改 `tools/cli/commands/test.py`，将 `tools/tests/` 下现有的 39 个测试文件及后续新增测试文件全量纳入回归（共计 45 个测试）。

---

## 2. 详细技术实现方案 (Technical Implementation)

### 2.1 原子级增量写入器 (`tools/codegen/io_utils.py`)

避免使用 Hash 计算开销，采用字节直比（短路高效），并利用同目录临时文件 + `os.replace` 确保文件写入的原子性，同时严格保留 `newline="\n"`：

```python
import os
import tempfile
from pathlib import Path

def write_file_if_changed(target: Path, content: str, encoding: str = "utf-8", newline: str = "\n") -> bool:
    """Write content to target only if content differs.
    Uses direct byte comparison and atomic tmpfile replacement.
    
    Returns:
        bool: True if written/updated, False if skipped due to identical content.
    """
    normalized_content = content.replace("\r\n", "\n")
    data = normalized_content.encode(encoding)

    if target.exists():
        try:
            if target.read_bytes() == data:
                return False  # Content identical: preserve mtime!
        except OSError:
            pass

    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target)
    except Exception:
        if os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
        raise

    return True
```

### 2.2 ConsoleService 累积器与 Stderr 隔离

定义在 `tools/cli/console.py` 中（已支持 `set_result` 泛型载荷）：

```python
from dataclasses import dataclass, field
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

@dataclass
class LogRecord:
    level: str
    message: str

class ConsoleService:
    def __init__(self, verbose: bool = False, quiet: bool = False, json_mode: bool = False):
        self.verbose = verbose
        self.quiet = quiet
        self.json_mode = json_mode
        self.records: List[LogRecord] = []
        self.artifacts: List[Path] = []
        self.result: Optional[Dict[str, Any]] = None

    def info(self, msg: str) -> None:
        self.records.append(LogRecord("INFO", msg))
        if not self.quiet and not self.json_mode:
            print(f"[wink] {msg}")

    def warn(self, msg: str) -> None:
        self.records.append(LogRecord("WARN", msg))
        if not self.quiet:  # Stderr output is NEVER suppressed by json_mode!
            print(f"[wink] Warning: {msg}", file=sys.stderr)

    def error(self, msg: str) -> None:
        self.records.append(LogRecord("ERROR", msg))
        print(f"[wink] Error: {msg}", file=sys.stderr)

    def add_artifact(self, path: Path) -> None:
        self.artifacts.append(path.resolve())

    def set_result(self, data: Dict[str, Any]) -> None:
        """Attach structured data payload for JSON envelope output (e.g. doctor probes)."""
        self.result = data
```

**AppContext 安全注入方案**：
在 `AppContext` 中提供默认工厂避开 `TypeError`，Dispatcher 在解析 argparse 完全局 flag 后，通过 `object.__setattr__(ctx, "console", console)` 将其实例注入不可变 `AppContext` 内部，完全符合 ADR-0060 规范：

```python
@dataclass(frozen=True)
class AppContext:
    ...
    console: ConsoleService = field(default_factory=ConsoleService)
```

---

## 3. 逐项修改清单 (Files Modified)

| 变更类型 | 文件路径 | 描述 |
| :--- | :--- | :--- |
| **[NEW]** | `tools/codegen/io_utils.py` | 原子级字节直比写入器 `write_file_if_changed` |
| **[NEW]** | `tools/cli/console.py` | 提供带 `set_result` 与 stderr 隔离的 `ConsoleService` |
| **[MODIFY]** | `tools/codegen/app_codegen.py` | 修改 `render_all()` 使用 `write_file_if_changed` |
| **[MODIFY]** | `tools/codegen/config_h.py` | 修改配置文件写入接入增量 Skip |
| **[MODIFY]** | [context.py](../../../../../wink-tools/tools/cli/context.py) | 增加 `console: ConsoleService = field(default_factory=ConsoleService)` |
| **[MODIFY]** | [test.py](../../../../../wink-tools/tools/cli/commands/test.py) | 增加对 `tools/tests/` 目录的 `unittest discover` 支持 |
| **[NEW]** | `tools/tests/test_codegen_incremental.py` | 验证文件内容未变时 mtime 完全锁死 |

---

## 4. 阶段一验证与对照实验 (Verification Plan)

1. **增量对照实验**：
   - 执行 `python wink-tools/wink.py build host --app oled_dashboard` 完成初始构建。
   - 使用 `touch wink-tools/tools/codegen/templates/device_tree.h.j2` 手动刷新模板的时间戳。
   - 再次执行 `python wink-tools/wink.py build host --app oled_dashboard`。
   - **验证指标**：得益于 `write_file_if_changed`，重新生成的 `device_tree.h` 的 mtime 不变，Ninja 报告重编译 C 单元数量为 **0**。
2. **测试全量回归**：
   - 执行 `python wink-tools/wink.py test`，验证 `tools/codegen/tests/` 和 `tools/tests/` 下的 45 个测试文件 100% PASS。
