# 阶段二详细计划：混合动词优先 CLI 重构、pack/i18n 集成与插件自动发现 (Phase 2 Detailed Plan - Rev.7)

> **归属计划**：`2026-08-06-wink-tools-architecture-evolution-plan`  
> **实施目标**：重构 CLI 为“混合动词优先”范式，集成独立打包 (`pack`) 与国际化 (`i18n`) 命令，提供隐藏 Parser 别名转发与插件引擎  

---

## 1. 目标与设计考量 (Goal & Design Decisions)

阶段二重构 CLI 的体系结构与路由引擎：
1. **100% 统一 CLI 网关 (Full Command Integration)**：将此前独立的 SDK 发布打包 (`tools/pack/source.py` / `binary.py`)、国际化扫描 (`tools/i18n_scanner.py`) 与 WASM 导出生成 (`tools/wasm_export_codegen.py`) 统一收拢至 CLI：
   - `wink pack source` / `wink pack binary`
   - `wink i18n scan`
   - `wink gen wasm-export`
2. **混合动词优先范式与显式命名**：遵循 `cargo` / `idf.py` 的工业级 CLI 标准，将构建、代码生成、调试、创建、打包等动作作为核心动词；同时使用极具直观性的 `gen app-schema` 与 `unisim-plugin`，做到全面见名知意。
3. **`gen` 兼容叶子与组双重路由 (`nargs='?'` Optional Subparsers)**：解决原 `gen.py`（已存在）既要支持无子命令的 `wink gen --app X`（代码生成），又要挂载 `app-schema` / `unisim-plugin-schema` / `wasm-export` 子动词的问题。
4. **`build` 独立二级 Subparser 离散参数集**：解决 `build host/wasm` 与 `build unisim-plugin` 在同一个 Parser 下的 Flag 冲突，为 3 个 build 目标建立独立的选项解析器。
5. **隐藏 Parser 透明别名转发 (Hidden Alias Redirection)**：在 argparse 层级使用 `help=argparse.SUPPRESS` 注册废弃的顶层旧命令，解决 `wink --skip-toolchain-check build-peripheral` 等全局 Flag 前置时的路由失败问题。
6. **高效且诚实信任模型的插件发现 (Plugin Auto-Discovery)**：保持内建命令在 `register_default_commands()` 显式注册（确保冷启动 < 30ms），第三方插件走 `wink_tools.plugins` entry_points 全信任模型（符合 ADR-0061 契约）。

---

## 2. 详细技术实现方案 (Technical Design)

### 2.1 混合动词优先 CLI 全景树 (整合 pack / i18n 后)

全仓命令重构后的直观层次结构如下：

```text
wink
├── build [host | wasm | unisim-plugin]     <-- 编译 Host 仿真、WASM 仿真或 Unisim 插件 (替代旧 build-peripheral)
├── dev [unisim-plugin]                     <-- 启动 Unisim 插件热重载监听 (替代旧 dev-peripheral)
├── gen [app-schema | unisim-plugin-schema | wasm-export] 
│                                           <-- 无子命令: 跑设备树代码生成 (wink gen --app X)
│                                           <-- 带子命令: 导出电路 Schema、插件 Schema 或 WASM 导出胶水
├── pack [source | binary]                  <-- SDK 统一发布打包 (整合源 source.py / binary.py)
├── i18n [scan]                             <-- i18n 国际化硬编码扫描 (整合源 i18n_scanner.py)
├── create <dal | app>                      <-- 创建 C 语言 DAL 驱动或 App 脚手架 (替代旧 new-dal)
├── schema <migrate>                        <-- Schema 迁移 (替代旧 migrate-schema)
├── test                                    <-- 运行 Python/C 单元测试与架构规约检查
├── doctor / setup / lint                   <-- 工具链健康检查与架构治理
└── web                                     <-- 启动 Vue Vite 前端服务
```

### 2.2 `pack` 与 `i18n` 新增 CLI 命令模块实现

#### 2.2.1 新建 `tools/cli/commands/pack.py` (整合 SDK 打包)
```python
class PackCommand(CommandBase):
    name = "pack"
    help = "Package Wink Micro OS SDK (source tarball or binary SDK)"

    def register_args(self, parser: argparse.ArgumentParser) -> None:
        sub = parser.add_subparsers(dest="pack_type", required=True)
        
        # wink pack source
        p_src = sub.add_parser("source", help="Pack source SDK release tarball (ADR-0028)")
        p_src.add_argument("--out", default="build/wink-sdk-source.tar.gz")

        # wink pack binary
        p_bin = sub.add_parser("binary", help="Pack precompiled binary SDK release (ADR-0028)")
        p_bin.add_argument("--out", default="build/wink-sdk-binary")
        p_bin.add_argument("--target", choices=["host", "wasm", "esp32", "all"], default="all")

    def run(self, ctx: AppContext, args: argparse.Namespace) -> Optional[int]:
        if args.pack_type == "source":
            from tools.pack.source import pack_source_sdk
            return pack_source_sdk(ctx, Path(args.out))
        elif args.pack_type == "binary":
            from tools.pack.binary import pack_binary_sdk
            return pack_binary_sdk(ctx, Path(args.out), target=args.target)
        return 1
```

#### 2.2.2 新建 `tools/cli/commands/i18n.py` (整合国际化扫描)
```python
class I18nCommand(CommandBase):
    name = "i18n"
    help = "Scan repository for unextracted i18n Chinese text strings"

    def register_args(self, parser: argparse.ArgumentParser) -> None:
        sub = parser.add_subparsers(dest="action", required=True)
        p_scan = sub.add_parser("scan", help="Scan C/C++/TS/YAML files for raw i18n strings")
        p_scan.add_argument("--path", default=None, help="Specific directory to scan")
        p_scan.add_argument("--strict", action="store_true", help="Fail with non-zero exit code if unextracted strings found")

    def run(self, ctx: AppContext, args: argparse.Namespace) -> Optional[int]:
        from tools.i18n_scanner import run_scanner
        scan_target = Path(args.path) if args.path else ctx.workspace_root
        return run_scanner(scan_target, strict=args.strict)
```

---

## 3. 逐项修改清单 (Files Modified)

| 变更类型 | 文件路径 | 描述 |
| :--- | :--- | :--- |
| **[MODIFY]** | [registry.py](../../../../../wink-tools/tools/cli/registry.py) | 注册 `pack` 与 `i18n` 内建命令模块 |
| **[MODIFY]** | [dispatcher.py](../../../../../wink-tools/tools/cli/dispatcher.py) | 适配 `pack` 与 `i18n` 的门控与路由 |
| **[NEW]** | `tools/cli/commands/pack.py` | 新增 SDK 打包 CLI 模块 (`wink pack source|binary`) |
| **[NEW]** | `tools/cli/commands/i18n.py` | 新增 i18n 国际化扫描 CLI 模块 (`wink i18n scan`) |
| **[MODIFY]** | `tools/cli/commands/gen.py` | 扩充 `gen wasm-export` 子命令分发 |
| **[MODIFY]** | [build.py](../../../../../wink-tools/tools/esp32/build.py) | 重构为 3 个独立 subparser (`host`, `wasm`, `unisim-plugin`) |

---

## 4. 阶段二验收标准 (Acceptance Criteria)

1. **统一 SDK 打包命令验证**：
   - 运行 `python wink-tools/wink.py pack source` 成功生成源码 SDK 发布包。
   - 运行 `python wink-tools/wink.py pack binary --target host` 成功打包二进制 SDK。
2. **i18n 国际化扫描验证**：
   - 运行 `python wink-tools/wink.py i18n scan` 成功输出未提取英化/中化文本报告。
3. **`gen` 完整双重路由**：
   - 运行 `python wink-tools/wink.py gen app-schema --app oled_dashboard` 成功导出电路 Schema JSON。
   - 运行 `python wink-tools/wink.py gen wasm-export` 成功生成 WASM 胶水头文件。
