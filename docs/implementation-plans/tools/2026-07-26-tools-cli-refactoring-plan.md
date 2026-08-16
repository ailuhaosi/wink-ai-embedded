# Implementation Plan - Wink OS Tools CLI 架构重构与模块化解耦计划

本方案旨在按照业界命令行最佳设计规范（Command Pattern & Plugin Registry），对 `wink-micro-os/tools/` 进行模块化架构重构。消除 [wink.py](../../../../wink-tools/wink.py)（**实测 1636 行**）的“神类/大杂烩”隐患，建立独立内聚的 CLI 命令处理层与打包子系统。

> **架构评审修订说明（v2）**：本版在 v1 基础上修正了三个致命设计缺陷：(1) 共享状态（全局态）无归属会导致反向循环依赖；(2) Registry 装饰器注册与 Lazy Loading 自相矛盾；(3) `handle_test` 反向依赖 lint 逻辑未被识别。同时将“< 100 行”虚荣指标替换为职责边界约束，并新增 Phase 0（状态解耦）与新基建单元测试。

---

## 1. 架构目标与设计原则

1. **主入口职责收敛 (Slim Gateway)**：`wink.py` 仅保留 **bootstrap 引导（对 `cli.context` 的引用）+ 命令分发（对 `cli.dispatcher` 的调用）**，不再包含任何 `handle_*` 业务逻辑。
   > ⚠️ **不设“< 100 行”硬指标**：现有 bootstrap（UTF-8 控制台、VT 转义、`sys.path` 注入、config 加载、env 导出）本身近 270 行，属于必须**搬迁而非删除**的基建；`--skip-toolchain-check` 预扫描与门禁逻辑属于分发层横切关注点。硬凑行数只会把复杂度藏进 `__init__`，反而更隐蔽。目标是**职责单一**，而非行数最少。
2. **命令解耦 (Command Pattern)**：将 `build`, `gen`, `esp32`, `web`, `test`, `doctor`, `setup`, `lint` 8 个处理逻辑解耦为独立的命令类/处理模块。
3. **共享上下文归属 (Explicit Context)**：所有模块级全局态（路径常量、`CONFIG`、导出的环境变量）统一收拢至 `tools/cli/context.py` 的 `AppContext`，命令签名改为 `run(ctx, args)`，**杜绝命令模块反向 `from tools.wink import ...` 造成的循环依赖**。
4. **真正的延迟按需加载 (Lazy Loading)**：注册表**只登记轻量元数据**（`name` / `help` / `register_args`），重依赖（PyYAML, Jinja2, toolchain providers）**仅在 `run()` 内部按需导入**。注册过程本身**不得触发**任何重依赖 import。
5. **包目录标准化**：将根目录散落的 [pack_sdk_binary.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_binary.py) / `pack_sdk_source.py` 收拢为 `tools/pack/` 子包，同时保留向后兼容 Shim 脚本。
6. **100% 命令行与 ABI 向后兼容**：不改变现有任何 `python tools/wink.py <cmd>` 命令行语法与运行输出，且 `python tools/pack_sdk_*.py` 直接执行入口的 `sys.argv` 与相对路径解析行为不变。

---

## 2. 重构后的架构图与目录规范

```text
wink-micro-os/tools/
├── wink.py                       # CLI 门面入口：bootstrap 引用 + dispatch 调用（无业务 handler）
├── cli/                          # 【新增】CLI 命令路由与分发子系统
│   ├── __init__.py
│   ├── context.py                # 【关键】AppContext：路径常量/CONFIG/env 导出的唯一归属地
│   ├── bootstrap.py              # UTF-8 控制台、VT 转义、sys.path 注入等启动引导（从 wink.py 搬迁）
│   ├── dispatcher.py             # 命令分发 + --skip-toolchain-check 预扫描 + 工具链门禁横切逻辑
│   ├── base.py                   # CommandBase 抽象基类
│   ├── registry.py               # 命令注册管理中心（仅登记轻量元数据）
│   ├── _shared.py                # 命令间复用逻辑（如 test/lint 共享的 lint 编排入口）
│   └── commands/                 # 各子命令独立的实现模块
│       ├── __init__.py
│       ├── gen.py                # GenCommand 代码生成命令
│       ├── build.py              # BuildCommand 构建命令
│       ├── esp32.py              # Esp32Command 真机编译与烧录命令
│       ├── web.py                # WebCommand Web 前端启动命令
│       ├── test.py               # TestCommand 自动化测试命令（仅编排，不内联 lint 实现）
│       ├── doctor.py             # DoctorCommand 环境诊断命令
│       ├── setup.py              # SetupCommand 配置持久化命令
│       └── lint.py               # LintCommand 静态架构治理命令
├── pack/                         # 【新增】SDK 打包发布子系统
│   ├── __init__.py
│   ├── binary.py                 # (原 pack_sdk_binary.py 主体移入，含 main())
│   └── source.py                 # (原 pack_sdk_source.py 主体移入，含 main())
├── pack_sdk_binary.py            # 【向后兼容 Shim 脚本】(转呼叫 tools.pack.binary:main)
├── pack_sdk_source.py            # 【向后兼容 Shim 脚本】(转呼叫 tools.pack.source:main)
├── codegen/                      # 代码生成引擎 (保留既有结构)
├── lint/                         # 静态架构 Linter 引擎 (保留既有结构；下沉可复用 lint 编排 API)
├── toolchain/                    # 工具链探测与门控 (保留既有结构)
└── esp32/                        # ESP32 沙箱隔离构建层 (保留既有结构)
```

### 2.1 模块依赖方向（严禁反向）

```text
wink.py
   │  (imports)
   ▼
cli.bootstrap ──► cli.context (AppContext)      ◄── 唯一全局态归属，被所有命令只读依赖
   │                    ▲
   ▼                    │ (ctx 通过参数注入 run(ctx, args))
cli.dispatcher ──► cli.registry ──► cli.commands.*  ──► cli._shared ──► tools.lint / tools.toolchain
```

**铁律**：`cli.commands.*` 与 `cli._shared` **不得** import `tools.wink`；一切共享数据经 `AppContext` 参数注入。此约束应由 Phase 1 新增的 `test_cli_no_reverse_import.py` 强制守护。

---

## 3. 核心设计细节

### 3.0 共享上下文 `AppContext` (`tools/cli/context.py`) —— 【本次重构的地基】

> **问题背景**：现有 `wink.py` 的 `handle_*` 严重依赖模块级全局态——`SDK_ROOT`、`WORKSPACE_ROOT`、`CONFIG`，以及导出的一批环境变量（`WINK_SDK_PATH` / `WINK_FRONTEND_PATH` / `WINK_ESP32_PATH` / `WINK_SCRIPTS_PATH` / `WINK_CODEGEN_ROOT`，见 bootstrap 30–304 行）。若直接把 `handle_*` 搬到 `cli/commands/*.py` 而不处理这些全局态，命令模块将被迫 `from tools.wink import SDK_ROOT`，**立即形成 wink → dispatcher → registry → commands → wink 的反向循环依赖**。

```python
# tools/cli/context.py
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict

@dataclass(frozen=True)
class AppContext:
    """CLI 全局运行上下文：全局态的唯一归属地，只读，经参数注入各命令。"""
    sdk_root: Path            # wink-micro-os/
    workspace_root: Path      # 其父目录
    app_dir: Path             # 由 --app 预解析得到
    config: Dict[str, Any]    # load_workspace_config() 结果
    env: Dict[str, str]       # 已导出的 WINK_* 环境变量快照

    @classmethod
    def bootstrap(cls, argv: list[str]) -> "AppContext":
        """在 dispatch 之前完成 UTF-8 控制台、sys.path 注入、config 加载与 env 导出，返回不可变上下文。"""
        ...
```

### 3.1 命令基类与注册器设计 (`tools/cli/base.py` & `registry.py`)

> **问题背景**：v1 的 `@CommandRegistry.register` 装饰器注册模式与“Lazy Loading”自相矛盾——一旦为触发注册而 import 命令模块，其顶部的 PyYAML/Jinja2/toolchain 依赖就会被全部拉起，懒加载失效；且 v1 `register()` 内 `inst = cmd_cls()` 立即实例化、`get_all()` 又返回类，语义混乱。
>
> **修订方案**：注册表**只登记轻量元数据 + 惰性工厂**。命令模块顶部**只 import argparse 与本文件**，重依赖一律推迟到 `run()` 内部。

```python
# tools/cli/base.py
import argparse
from abc import ABC, abstractmethod
from typing import Optional
from tools.cli.context import AppContext

class CommandBase(ABC):
    """CLI 命令抽象基类。约束：模块顶部禁止 import 重依赖（PyYAML/Jinja2/toolchain）。"""

    name: str = ""    # 命令名，如 'build'
    help: str = ""    # 命令简短说明（用于 --help，注册期即可读，不触发重依赖）

    @abstractmethod
    def register_args(self, parser: argparse.ArgumentParser) -> None:
        """注册该子命令特有的命令行参数（纯 argparse，轻量）。"""

    @abstractmethod
    def run(self, ctx: AppContext, args: argparse.Namespace) -> Optional[int]:
        """命令业务逻辑入口。重依赖在此方法内部按需 import。"""
```

```python
# tools/cli/registry.py
from typing import Callable, Dict, List
from tools.cli.base import CommandBase

class CommandRegistry:
    """命令集中注册与惰性分发中心。注册期仅保存工厂，不 import 命令模块。"""

    _factories: Dict[str, Callable[[], CommandBase]] = {}
    _help: Dict[str, str] = {}

    @classmethod
    def register(cls, name: str, help: str, factory: Callable[[], CommandBase]) -> None:
        if name in cls._factories:
            raise ValueError(f"duplicate command registration: {name}")
        cls._factories[name] = factory
        cls._help[name] = help

    @classmethod
    def create(cls, name: str) -> CommandBase:
        return cls._factories[name]()      # 分发时才真正 import + 实例化

    @classmethod
    def names(cls) -> List[str]:
        return sorted(cls._factories)
```

### 3.2 分发器与横切关注点 (`tools/cli/dispatcher.py`)

将 `main()` 中的以下**分发层横切逻辑**显式保留于此，避免为压缩行数而揉碎：
- `--skip-toolchain-check` 的 `sys.argv` 预扫描 hack（现 wink.py 1617–1622，因 `parents=[global_parent]` 默认值覆盖问题而存在）；
- `_resolve_gate_command(args)` + `_apply_toolchain_gate(...)` 工具链门禁（`doctor`/`setup`/`lint` 三个诊断命令豁免）。

### 3.3 `TestCommand` 的耦合下沉 —— 【避免“换名字的大杂烩”】

> **问题背景**：现 `handle_test`（707–1090，近 400 行）并非普通命令：它**内联调用 lint**（`from tools.lint.cli import handle_lint` + 内联 `LintArgs`，运行 `["layering","api","arduino"]` 包）、调用 `_run_esp32_guard_density_lint`、`_run_adr0017_l1_strict_lint`（后者 shell 出 `gcc`/`nm`，用 `tempfile`）。若原样搬进 `commands/test.py`，将造成 `commands/test.py` 反向依赖 `commands/lint.py`。
>
> **修订方案**：把这些可复用编排逻辑**下沉为 `tools/lint/` 的公共 API**（如 `tools.lint.orchestrate.run_packs(...)`），或收敛到 `cli/_shared.py`。`TestCommand.run()` 与 `LintCommand.run()` 均调用该公共 API，命令层只做**编排**不含实现。

---

## 4. 实施阶段计划 (Proposed Changes)

### Phase 0: 状态解耦与复用逻辑下沉（新增，最高优先级）

#### [NEW] [context.py](../../../../wink-tools/tools/cli/context.py)
* 定义 `AppContext`（frozen dataclass），收拢 `SDK_ROOT`/`WORKSPACE_ROOT`/`app_dir`/`CONFIG`/`env` 全局态。

#### [NEW] [bootstrap.py](../../../../wink-tools/tools/cli/bootstrap.py)
* 从 wink.py 30–304 行搬迁 UTF-8 控制台、VT 转义、`sys.path` 注入、`--app` 预解析、`load_workspace_config()`、`WINK_*` env 导出，产出 `AppContext`。

#### [NEW] [_shared.py](../../../../wink-tools/tools/cli/_shared.py) / lint 编排 API 下沉
* 将 `handle_test` 内联的 lint 编排（`LintArgs` + `run(["layering","api","arduino"])`）、`_run_esp32_guard_density_lint`、`_run_adr0017_l1_strict_lint` 下沉为可被 test/lint 共同调用的公共 API。

---

### Phase 1: 创建 `tools/cli/` 命令框架与分发器

#### [NEW] [base.py](../../../../wink-tools/tools/cli/base.py)
* 定义 `CommandBase` 抽象基类与通用 CLI 异常基类；约束模块顶部禁止 import 重依赖。

#### [NEW] [registry.py](../../../../wink-tools/tools/cli/registry.py)
* 实现 `CommandRegistry`（惰性工厂 + 重名冲突检测），集中登记 8 个命令的字符串路径惰性 import。

#### [NEW] [dispatcher.py](../../../../wink-tools/tools/cli/dispatcher.py)
* 承载 `--skip-toolchain-check` 预扫描 hack、`_resolve_gate_command`、`_apply_toolchain_gate` 门禁（`doctor`/`setup`/`lint` 豁免），调用 `registry.create(name).run(ctx, args)`。

#### [NEW] 新基建单元测试
* `test_cli_registry.py`：注册/重名冲突/`names()` 排序。
* `test_cli_lazy_import.py`：断言仅注册命令**不触发** PyYAML/Jinja2/toolchain import。
* `test_cli_no_reverse_import.py`：静态断言 `cli.commands.*` 与 `cli._shared` 不 import `tools.wink`。

---

### Phase 2: 按“由易到难”拆分并迁移子命令逻辑至 `tools/cli/commands/`

#### [NEW] [doctor.py](../../../../wink-tools/tools/cli/commands/doctor.py)
* 提取 `handle_doctor`；`tools.toolchain.*` 依赖移入 `run()` 内部延迟 import。

#### [NEW] [web.py](../../../../wink-tools/tools/cli/commands/web.py)
* 提取 `handle_web` 前端服务启动逻辑（`npm run dev`）。

#### [NEW] [gen.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/cli/commands/gen.py)
* 提取 `handle_gen` 及其辅助逻辑。

#### [NEW] [setup.py](../../../../wink-tools/tools/cli/commands/setup.py)
* 提取 `handle_setup`、`_handle_setup_noargs`、`_handle_setup_set`、`_handle_setup_install`。

#### [NEW] [build.py](../../../../wink-tools/tools/esp32/build.py)
* 提取 `handle_build`（含 `--clean` 的 `shutil` 逻辑、host/wasm CMake 分支）。

#### [NEW] [esp32.py](../../../../wink-tools/tools/cli/commands/esp32.py)
* 提取 `handle_esp32` 及其 `idf_args` 透传与 env 设置逻辑。

#### [NEW] [lint.py](../../../../wink-tools/tools/cli/commands/lint.py)
* 提取 `_lazy_handle_lint`，复用 Phase 0 下沉的 lint 编排 API。

#### [NEW] [test.py](../../../../wink-tools/tools/cli/commands/test.py)
* 提取 `handle_test`，**仅做编排**，lint/guard-density/ADR0017 逻辑一律调用 Phase 0 下沉的公共 API。

---

### Phase 3: 重构主入口 `wink.py`

#### [MODIFY] [wink.py](../../../../wink-tools/wink.py)
* 清理所有 `handle_*` 与 bootstrap 实现，改为：`ctx = bootstrap(sys.argv)` → `dispatch(ctx, sys.argv)`。
* 保留 `if __name__ == "__main__": main()` 入口语义。

---

### Phase 4: 规范打包发布子系统 `tools/pack/`

#### [NEW] [binary.py](../../../../wink-tools/tools/pack/binary.py)
* 将 [pack_sdk_binary.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_binary.py) 主主体重构移入 `tools/pack/binary.py`。

#### [NEW] [source.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_source.py)
* 将 [pack_sdk_source.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_source.py) 主主体重构移入 `tools/pack/source.py`。

#### [MODIFY] [pack_sdk_binary.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_binary.py)
* 改造为向后兼容 Shim 脚本（仅保留调用 `from tools.pack.binary import main`）。

#### [MODIFY] [pack_sdk_source.py](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/wink-micro-os/tools/pack_sdk_source.py)
* 改造为向后兼容 Shim 脚本（仅保留调用 `from tools.pack.source import main`）。

---

## 5. 验证计划 (Verification Plan)

### 自动化单元测试矩阵
```bash
python -m unittest discover -s tools/tests
```
**期望结果**：全量单元与集成测试依然 100% 保持亮绿灯（`OK`）。

### CLI 功能黑盒测试
```bash
python tools/wink.py doctor
python tools/wink.py gen --app oled_dashboard
python tools/wink.py build host --app oled_dashboard
python tools/wink.py test
python tools/wink.py lint --explain LAYER_VIOLATION_BAL_TO_DAL
```
