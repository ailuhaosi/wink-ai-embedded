# 2026-08-06 `wink-tools` 架构演进计划评审

| 项 | 内容 |
|----|------|
| 评审对象 | `docs/implementation-plans/2026-08-06-wink-tools-architecture-evolution-plan/` 下 4 份计划：`00-master`、`01-phase1`、`02-phase2`、`03-phase3` |
| 评审日期 | 2026-08-06 |
| 评审角色 | 软件架构师 / CLI 工具链工程师视角 |
| 评审方法 | ① 通读 4 份计划；② 逐项对照 `wink-tools/` 真实代码（registry/context/dispatcher/bootstrap/base、codegen 全部写入点、各 command）；③ 追踪 `wink gen`→CMake→C 编译的真实依赖图；④ 核对打包配置、测试发现机制、app 目录结构；⑤ 按"事实错误 / 设计空洞 / 流程缺失"分级给出修订建议 |
| 影响范围 | `wink-tools/tools/cli/**`、`wink-tools/tools/codegen/**`、`wink-micro-os/CMakeLists.txt`、各 `wink-micro-app/*/CMakeLists.txt`、测试与 CI、未来第三方插件契约 |
| 严重度 | **高**：方向正确，但存在一处动摇 Phase 1 立项根基的架构误判、多处与代码不符的硬错误、以及 Phase 2/3 的关键设计空洞；若按原文直接执行，核心收益无法兑现且会返工 |
| 结论 | **退回修订**。Phase 1 的核心痛点归因与真实构建图不符，需重写问题陈述与验收标准；三份子计划均存在路径/文件名/API 错误；Phase 2 的命令分组低估为 dispatcher 两级路由重构、Phase 3 的 JSON 协议缺命令回传结构化数据的通道。建议按本评审 §7 修订后再进入实施，且其中 4 项跨模块契约应先补 ADR |

---

## 1. 总体评价

### 1.1 值得肯定的部分

- **分期顺序合理**："效率（增量 codegen）→ 解耦（命令分组/插件）→ 生态（JSON/补全）"由内而外、每阶段可独立验收，符合渐进式演进原则。
- **痛点真实存在**：
  - codegen 写入点确实使用"无脑覆盖"（`app_codegen.py:623` 的 `target.write_text(...)`、`config_h.py:161` 的 `open(..., "w")`），不做内容比对；
  - CLI 输出确实零散在 `print()` / `sys.stderr` 中——经统计 `tools/cli/commands/` 下 14 个命令文件共 **126 处** `print`/`stderr.write`；
  - `registry.py` 当前确实是"手工硬编码 14 个 factory"的扁平结构，无扩展点。
- **零破坏承诺与废弃别名方向正确**，保护既有 CI/CD。

### 1.2 核心问题概览

| 编号 | 问题 | 严重度 | 所属阶段 |
|---|---|---|---|
| F-1 | Phase 1 立项根基错误：`wink gen` 的输出目录并不被 C 构建消费，"二次构建提速 80%"的因果链不成立 | 🔴 阻断 | Phase 1 |
| F-2 | 路径/文件名/API 多处与代码不符（入口路径、不存在的文件、`ep.value.__doc__`、AppContext 测试夹具等） | 🔴 阻断 | 全阶段 |
| F-3 | Phase 2 命令分组被描述为"加 CommandGroup 类"，实为 dispatcher 单层→两级路由重构，改造量被严重低估 | 🟠 高 | Phase 2 |
| F-4 | Phase 3 JSON 协议只有输出样例，缺命令回传结构化数据的通道（`run()` 只返回退出码） | 🟠 高 | Phase 3 |
| F-5 | `wink test` 只跑 `codegen/tests/`，计划新增的 `tools/tests/test_cli_*.py` 不在回归网内 | 🟠 高 | 全阶段 |
| F-6 | ConsoleService 在 quiet/json 下吞掉 error，且未为 Phase 3 预埋累积结构 | 🟡 中 | Phase 1/3 |
| F-7 | 别名转发用 `argv[0]` 位置判断，无法处理全局 flag 在前的情况 | 🟡 中 | Phase 2 |
| F-8 | 插件 entry_points 机制缺乏打包前提（wink-tools 不是可安装分发包） | 🟡 中 | Phase 2 |
| F-9 | 缺 ADR：命令分组法、插件契约、JSON schema、ConsoleService 接口均为跨模块公共契约 | 🟡 中 | 治理 |

---

## 2. 与代码事实不符的硬错误（F-2）

这些是"按文档操作会立即失败"的问题，必须在动工前修正。

### 2.1 入口路径错误

计划验收标准通篇写 `python tools/wink.py ...`，但：

- 真实入口是 `wink-tools/wink.py`（仓库根**没有** `tools/` 目录）；
- `bootstrap()` 通过 `sys.path.insert(0, wink-tools)` 后以 `tools.*` 包名导入。

所有验收命令、文件清单中的相对路径都应改为 `python wink-tools/wink.py ...`（或统一以仓库根为基准的 `wink-tools/tools/...`）。

### 2.2 不存在的 codegen 文件

Phase 1 §2.1 "应用范围"列出三个文件，其中：

| 计划所写 | 实际情况 |
|---|---|
| `tools/codegen/gen_config_h.py` | 实际为 `tools/codegen/config_h.py` |
| `tools/codegen/gen_dal_bindings.py` | **不存在**（全仓无此文件） |
| `tools/codegen/gen_device_tree.py` | 存在，但它是独立的 YAML 旧路径脚本，**不被 CMake 调用**（见 §3.2） |
| （遗漏）`tools/codegen/app_codegen.py` | 这才是 `wink gen` 与 CMake 共同调用的主力写入器，计划完全未列入 |

`app_codegen.py:614-625` 的 `render_all()` 遍历 `OUTPUT_FILES`（定义于 `app_codegen.py:61`）逐个 `write_text`，是真正需要增量 skip 的地方。

### 2.3 插件 API 误用

Phase 2 §2.3：

```python
for ep in eps:
    CommandRegistry.register(ep.name, ep.value.__doc__ or "", ep.load)
```

`importlib.metadata.EntryPoint.value` 是**字符串**（形如 `"mypkg.mod:Cls"`），字符串的 `__doc__` 不是插件文档；且这里把 `ep.load`（方法对象）当 factory 传入，却没有调用它来取得帮助文本。正确做法是 `obj = ep.load()` 后从 `obj` 取 `help`/`__doc__`，并用 `lambda ep=ep: ep.load()` 包裹以保持惰性。

### 2.4 AppContext 加字段会炸测试夹具

`AppContext` 是 `@dataclass(frozen=True)` 且无默认值（`context.py:9-18`）。计划要加 `console: ConsoleService` 必填字段，但以下两处直接构造 `AppContext(...)`：

- `wink-tools/tools/tests/test_new_dal.py:29`
- `wink-tools/tools/tests/test_peripheral_commands.py:58`

加字段后这两个测试立即 `TypeError`。计划的文件变动清单未列这两个测试。建议要么给字段默认值，要么（更优，见 §6.2）不把 console 放进 AppContext。

### 2.5 打包配置不存在

Phase 2 依赖 `importlib.metadata.entry_points(group="wink_tools.plugins")`，但：

- `wink-tools/` 下**没有** `pyproject.toml` / `setup.py` / `setup.cfg`；
- 仓库根的 `pyproject.toml` 仅含 `[tool.pyrefly]` 配置，不是打包清单；
- wink-tools 当前以"裸脚本 + sys.path"方式运行，并非 pip 安装的 distribution。

这意味着第三方 entry_points 能从 site-packages 被发现，但 wink-tools **自身**无法用同一机制注册内部命令（没有 `.dist-info`）。需要先决定打包策略（见 §6.4）。

### 2.6 Shell 补全扫描路径错误

Phase 3 §2.2 称遍历 `wink-micro-app/` **及 `samples/`**。实际仓库根只有 `wink-micro-app/` 与 `examples/`，**没有 `samples/`**。注意：`gen.py:14` 的 `resolve_app_dir` 会回退到 `ctx.sdk_root / "samples"`（即 `wink-micro-os/samples`），但该目录当前也不存在。补全逻辑应与 `resolve_app_dir` 的真实搜索路径对齐，而不是另写一套。

### 2.7 命令分组树遗漏命令

Phase 2 §2.1 的分组树列了 13 个命令，但 `registry.py` 实际注册了 **14** 个，**`frontend-app-device-tree` 未被归类**。需明确它归属哪个 group（或保留顶层）。

---

## 3. Phase 1 专项评审：增量 Codegen 与 ConsoleService

### 3.1 🔴 最关键问题：Phase 1 的痛点归因与真实构建图不符（F-1）

计划主纲 §1 与 Phase 1 §1.1 断言：

> `wink gen` 每次重构均全量覆盖头文件……导致下游 CMake C 编译器频繁触发不必要的全量编译。
>
> 验收标准 2：未修改配置时二次运行 `wink build host --app oled_dashboard`，CMake 报告 `Ninja: no work to do.`

追踪真实构建图后，这一因果链**不成立**：

1. **`wink gen` 的输出目录与 C 构建无关。**
   `gen.py:53` 将输出写到 `ctx.workspace_root / "build" / "generated"`（如 `build/generated/`）。
   但 C 构建并不消费这个目录。

2. **C 构建自己调用 codegen，写到另一个目录。**
   以 `wink-micro-app/oled_dashboard/CMakeLists.txt:23-33` 为例：
   ```cmake
   add_custom_command(
       OUTPUT ${GEN_DEVICE_TREE_H} ${GEN_DEVICE_TREE_C} ${GEN_APP_OPTIONS}
       COMMAND ${Python3_EXECUTABLE} ${WINK_CODEGEN_TOOL} --config ... --out-dir ${GEN_DIR}
       DEPENDS ${WINK_APP_JSON} ${WINK_CODEGEN_TOOL} ${WINK_CODEGEN_TEMPLATES} ${WINK_CODEGEN_DRIVERS}
   )
   ```
   其中 `GEN_DIR = ${CMAKE_CURRENT_BINARY_DIR}/generated`（如 `build/host/oled_dashboard/.../generated/`），**不是** `wink gen` 的 `build/generated/`。`wink_config.h` 同理，由 `wink-micro-os/CMakeLists.txt:100-110` 的 custom command 生成到 `${CMAKE_BINARY_DIR}/generated/`。

3. **因此第二次 `wink build host` 本来就是 no-op。**
   CMake/Ninja 通过 `DEPENDS`（`wink-app.json`、`config_h.py`、模板、drivers）决定是否重跑 codegen。依赖未变时，codegen 不会执行，ninja 直接报 "no work to do"——这与是否做内容 hash skip **无关**。验收标准 2 即使一行代码不改也能通过，无法证明优化生效。

4. **内容 skip 真正有价值的场景更窄、但真实存在**：当 `DEPENDS` 中某个文件 mtime 变化但渲染结果不变时（典型：`git checkout` 触碰了模板/driver `.py` 的 mtime 但内容未变；或切换分支后切回），CMake 会重跑 codegen。此时若无 skip，identical 的 `device_tree.h` 被重写、mtime 更新 → 触发 `device_tree.c` 及所有 include 它的 TU 重编译；有 skip 则 mtime 保持 → 跳过重编译。这是真实收益，但：
   - 它作用于 **CMake 调用的 `app_codegen.py` / `config_h.py`**，不是 `wink gen` 独立产物；
   - 收益取决于工作流中"DEPENDS mtime 抖动"的频率，不宜宣称"二次构建提速 80%"。

**建议修订**：

- 重写 Phase 1 §1 问题陈述：把"避免 `wink gen` 导致全量重编译"改为"在 codegen 被 CMake 因 mtime 抖动而重跑时，保持 identical 输出的 mtime 稳定，避免下游级联重编译"。
- 把应用范围从虚构文件改为真实的 CMake 消费路径：`app_codegen.py:render_all`（主力）、`config_h.py`（`wink-micro-os/CMakeLists.txt:102` 与 `targets/esp32/CMakeLists.txt:97` 调用）、`pt_state.py`（若被构建调用需核实）。
- 删除/重写验收标准 2，改为能真正区分"有无 skip"的对照实验：人为 `touch` 一个 DEPENDS 文件（如某模板）但不改内容，对比有/无 skip 时 ninja 的重编译 TU 数量。
- 明确 `wink gen`（独立命令，产物到 `build/generated/`）的定位：它是否给前端/IDE 消费？若仅为人工检视，增量 skip 对它的价值是"省 IO + 不污染 git status"，而非"加速 C 构建"。

### 3.2 `gen_device_tree.py` 的定位需澄清

`gen_device_tree.py` 是基于 YAML 的旧设备树脚本（其 docstring 示例为 `python gen_device_tree.py ../device-trees/avoidance-car.yaml ...`）。全仓 grep 显示**没有任何 CMake/构建脚本调用它**（只有自引用）。在投入改造前，应确认它是仍在使用的工具，还是可归档的遗留代码。若已废弃，不应列入增量改造范围。

### 3.3 `write_file_if_changed` 的两个实现缺陷

Phase 1 §2.1 给出的实现：

```python
if hashlib.sha256(existing_bytes).digest() == hashlib.sha256(new_bytes).digest():
    return False
target_path.parent.mkdir(parents=True, exist_ok=True)
target_path.write_bytes(new_bytes)
```

问题一：**不该用 hash**。生成文件是小头文件/胶水代码，`existing_bytes == new_bytes` 走 C 级 memcmp 且可短路，比双 sha256 更快、更简单、零分配。hash 仅在文件大到不宜整体读入时才有意义，此处不成立。

问题二：**名为"原子"实则不原子**。`target.write_bytes()` 直接覆盖；若写到一半进程被杀/磁盘满，会留下半截头文件，下次构建读到残缺内容。真正原子写应是：写同目录临时文件 → `flush` + `fsync` → `os.replace(tmp, target)`。计划标题与正文多处称"原子级"，要么正名为 `write_file_if_changed`（去掉 atomic 措辞），要么补齐临时文件+rename。

建议实现骨架：

```python
import os
import tempfile

def write_file_if_changed(target: Path, content: str, encoding: str = "utf-8",
                          newline: str = "\n") -> bool:
    """Write content only if it differs; atomic via tmp+os.replace. Returns True if changed."""
    data = content.encode(encoding)
    if target.exists() and target.read_bytes() == data:
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=str(target.parent), prefix=f".{target.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, target)
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise
    return True
```

注意 `newline="\n"`：现有 `app_codegen.py:623` 显式用 `newline="\n"` 规范行尾，封装时必须保留该参数，否则在 Windows 上会改变输出（进而让 skip 判断永远 miss）。

### 3.4 应用范围与汇总输出

`render_all` 当前逐个 `write_text` 并返回 `List[Path]`。接入 skip 后建议改为返回 `List[tuple[Path, bool]]`（path, changed），由 CLI 层汇总打印一次 `N written, M skipped`，而不是每个文件各打一行——这也契合 §3.5 的 ConsoleService 收拢目标。

### 3.5 ConsoleService 设计问题（F-6）

Phase 1 §2.2 的 `ConsoleService` 有三处问题：

1. **`--json` 下 error 被吞**：
   ```python
   def error(self, msg):
       if not self.json_mode:
           print(..., file=sys.stderr)
   ```
   CI/IDE 在 `--json` 模式下出错时，stderr 空空如也，用户无法调试。正确契约应是：**stderr 始终输出人类可读诊断（不受 `--json` 影响）；stdout 在 `--json` 时只输出最终 JSON envelope**。即 json 模式只抑制 stdout 的 info/debug 噪声，绝不抑制 error/warn。

2. **未为 Phase 3 预埋累积结构**。Phase 3 要求退出时输出含 `errors[]/warnings[]/artifacts[]/duration_ms` 的 JSON，但 Phase 1 的类没有任何 records/artifacts 缓冲。若 Phase 1 不预埋，Phase 3 必然改写 ConsoleService。建议 Phase 1 就内置：
   - `self.records: list[LogRecord]`（level/message/时间戳）
   - `self.artifacts: list[Path]`（由命令通过 `console.add_artifact()` 登记）
   - `self.warnings/errors` 便捷计数器

3. **未复用既有颜色探测**。`bootstrap.py:15-53` 已有 `_color_supported()`（含 Windows conhost VT 处理、`NO_COLOR`/`FORCE_COLOR`/`TERM=dumb` 约定）。ConsoleService 不应另起炉灶，应在构造时接收 color 开关并复用该逻辑；前缀风格也应与项目 PAL 日志的 `LOG_E/W/I/D` 约定协调，避免出现第二套 `[wink]`/`[wink:debug]` 风格。

### 3.6 全局 flag 的解析位置自相矛盾

计划称"在 bootstrap 解析 `--verbose/--quiet/--json` 并注入 AppContext"，但 `bootstrap()` 在 argparse **之前**运行（它目前只手工预扫 `--app`，见 `bootstrap.py:56-67`）。两种可行路径需二选一并写明：

- **方案 A（推荐）**：这三个全局 flag 加入 `dispatcher.py` 的 `global_parent`；ConsoleService 在 `dispatch()` 内构造，通过方法参数传给 command.run()，**不放入 AppContext**。优点：不破坏 frozen AppContext、不炸测试夹具、与现有 `--skip-toolchain-check` 模式一致。
- **方案 B**：在 bootstrap 里像预扫 `--app` 一样手工预扫这三个 flag。缺点：重复解析逻辑、易漏 `--flag=value` 形式、与 argparse 帮助脱节。

建议采 A。

---

## 4. Phase 2 专项评审：命令分组与插件化

### 4.1 命令分组是 dispatcher 两级路由重构，不是"加个类"（F-3）

当前架构是**单层** subparser（`dispatcher.py:88-95`）：

```python
sub = p.add_subparsers(dest="command", required=True)
for name in CommandRegistry.names():
    sub_p = sub.add_parser(name, ...)
    cmd_inst.register_args(sub_p)   # 每个命令直接往自己的 parser 挂参数
```

`registry.py` 是扁平的 `Dict[str, factory]`。要支持 `wink peripheral build`，必须改动的远不止新增 `CommandGroup`：

1. **registry 支持两级命名**：`group → subcommand → factory/help`，或把 group 建模为实现了 `register_args(subparser_group)` 的特殊 `CommandBase`（其内部再 `add_subparsers`）。
2. **dispatcher 路由改为两级**：`args.command` 是 group 时，还要从 `args.<group_action>`（或嵌套 dest）取二级动作并实例化对应子命令。
3. **toolchain gate 重写**：`dispatcher.py:12-27` 的 `_resolve_gate_command` 当前用扁平白名单 `command in ("build-peripheral", ...)`；分组后所有 `peripheral *` 子命令都要映射到 `"peripheral"` profile，`_apply_toolchain_gate` 的 `profile_map` 也要相应调整。
4. **`--skip-toolchain-check` 穿透**：该全局 flag 可能出现在 group 前后（`wink --skip... peripheral build` 与 `wink peripheral build --skip...`），现有 `skip_from_prepass = "--skip-toolchain-check" in argv`（`dispatcher.py:98`）的简易写法在两级结构下要验证仍成立。

这是 dispatcher 核心重构，计划应单列一节给出两级路由的具体设计与回归用例矩阵（顶层命令、group 命令、全局 flag 前/后置、help 文本、未知子命令报错）。

### 4.2 别名转发对 flag 位置不健壮（F-7）

Phase 2 §2.2：

```python
if argv and argv[0] in DEPRECATED_ALIASES:
```

但现有 CLI 允许 `wink --skip-toolchain-check build-peripheral`（global_parent flag 在命令前，见 `dispatcher.py:75-87`）。此时 `argv[0]` 是全局 flag，别名检测失效。

更稳的做法：不要用 argv 位置猜，而是在 argparse 层把旧命令名注册为**隐藏 parser**（`add_parser(old_name, help=argparse.SUPPRESS)`），其 handler 执行"打印废弃警告 + 委托给新命令"的逻辑；这样无论全局 flag 在哪都能正确路由。若坚持在 argv 层归一化，则必须在剥离/识别全局 flag 之后再做。

### 4.3 别名 warning 与 ConsoleService 生命周期

`normalize_deprecated_args` 计划接收 `console` 并 `console.warn(...)`。但别名归一化发生在 parse 早期（在 ConsoleService 构造之前，见 §3.6 方案 A）。需明确：此时若 ConsoleService 尚未构造，废弃警告要么直接写 stderr（bootstrap 阶段已有直接 print 先例，如 `bootstrap.py:109`），要么把归一化推迟到 dispatch 内。文档需写清顺序。

### 4.4 插件发现的健壮性与性能

```python
def discover_plugin_commands():
    try:
        from importlib.metadata import entry_points
        eps = entry_points(group="wink_tools.plugins")
        for ep in eps:
            CommandRegistry.register(ep.name, ep.value.__doc__ or "", ep.load)
    except Exception:
        pass
```

三个问题：

1. **静默吞异常**：第三方插件加载失败时无任何线索，开发者会反复重装却看不到 `ImportError`。至少 `console.debug(f"plugin '{ep.name}' failed to load: {e!r}")`，并在 `wink doctor` 中列出"已发现/加载失败"的插件清单。
2. **`ep.value.__doc__` 错误**：见 §2.3。
3. **冷启动性能威胁 30ms 预算**：`importlib.metadata.entry_points()` 在 Windows 冷启动 + 多个 site-packages 时可能耗时 20–50ms；目录 glob 扫描 `commands/*.py` 也有开销。主纲承诺 `--help` < 30ms。建议：
   - 内部命令仍可用文件扫描，但需基准验证（保留 lazy factory，snippet 中 `_register_module_lazy` 未给实现，需补全）；
   - 第三方 entry_points 扫描考虑磁盘缓存，或仅在 `wink doctor` / 显式 `--reload-plugins` 时全量扫描，`--help` 走缓存。

### 4.5 打包前提未建立（F-8）

见 §2.5。引入 entry_points 前必须先决策：wink-tools 是否要成为可 `pip install -e` 的分发包（新增 `[project]` + `[project.scripts]`，如 `wink = "tools.cli.__main__:main"`）？

- 若维持"裸跑脚本"形态：内部命令走文件扫描、外部插件走 entry_points，是两条不对称路径，文档必须明确边界，社区贡献者会困惑"为何我的本地包不能像内建命令一样被发现"。
- 若改为可安装包：`bootstrap.py` 中 `sys.path.insert`、`repo_tools_root()`、`micro_os_root()` 等基于脚本位置的路径解析都要重新验证（editable install 后 `__file__` 位置变化）。

这是一个需要 ADR 的决策点（见 §6.1）。

### 4.6 旧命令模块的迁移策略未定义

把 `build_peripheral.py` 的逻辑搬进 `commands/peripheral.py` 后，旧模块是删除还是保留 thin shim？零破坏承诺下建议：保留旧模块为 thin shim，内部 `warnings.warn(DeprecationWarning)` 后委托新实现；并约定一个明确的移除窗口（如"两个 minor 版本后删除"，与项目 ADR-0032 的废弃命名惯例一致）。计划只在 argv 层做别名，未涉及代码层模块去向，会造成"命令名兼容但代码重复"。

---

## 5. Phase 3 专项评审：JSON 输出与 Shell 补全

### 5.1 🔴 最大空洞：命令如何回传结构化数据（F-4）

计划给了 JSON 样例：

```json
{ "status": "success", "artifacts": [...], "duration_ms": 1245, "errors": [], "warnings": [] }
```

但没有定义这些字段从哪来：

- `CommandBase.run()` 签名是 `-> Optional[int]`（`base.py:27`），**只能返回退出码**，没有携带 artifacts/结构化结果的通道；
- ConsoleService（Phase 1 版）没有 `add_artifact()` / 累积器（见 §3.5）；
- 没有说明谁在退出时组装 envelope（dispatcher 的 try/finally？）、未捕获异常如何转成 `status:"error"`、`duration_ms` 从哪取。

这是 Phase 3 的核心，必须先二选一：

- **方案 A（推荐，侵入小）**：命令通过 `console.add_artifact(path)`、`console.warning(...)` 等累积；`dispatcher.dispatch()` 用 `time.monotonic()` 包裹 `cmd_obj.run()`，在 finally 里调用 `console.finalize(exit_code, command_name, target?)` 输出唯一 JSON 对象到 stdout。`run()` 签名保持不变。
- **方案 B（破坏式）**：让 `run()` 返回 `CommandResult`（含 exit_code/artifacts/data）。需要改所有 14 个命令，且与第三方插件契约强绑定，迁移成本高。

建议采 A，并在 Phase 1 就把累积器埋进 ConsoleService，避免返工。

### 5.2 stdout/stderr 分流必须写成硬契约

"拦截所有非 JSON 输出"（Phase 3 §2.1）这句话很危险，会诱导实现者把 stderr 也吞掉。应明确：

- **stdout**：`--json` 时**只**输出最终那个 JSON envelope（恰好一个 JSON 对象，无前后缀、无多行日志）；
- **stderr**：任何模式下都允许人类可读的进度/警告/错误（保证 CI 日志可调试）；
- 现有 126 处 `print()` 需逐个甄别：属"结果数据"的（如 `doctor` 的探针结果、`gen` 的产物路径清单）改为进入 JSON envelope（`console.add_result()` / `add_artifact()`）；属"日志"的改为 `console.info()`。这是替换之外的额外分类工作，计划未提。

### 5.3 异常 → JSON 的映射

未捕获异常、`sys.exit(n)`、`KeyboardInterrupt` 如何映射成 `status:"error"` + 非零退出码 + `errors[]`，需明确。建议 dispatcher 统一包裹：

```python
try:
    rc = cmd_obj.run(ctx, args)
except SystemExit as e:
    rc = e.code
except Exception as e:
    console.error(f"{type(e).__name__}: {e}")
    rc = 1
    console.record_error(...)
finally:
    console.finalize(exit_code=rc, command=args.command, ...)
```

`wink doctor --json` 是重中之重：IDE 依赖它做环境诊断，schema 必须版本化（加 `"schema_version": 1`），否则一旦字段变动会静默破坏所有下游。

### 5.4 Shell 补全

1. **平台优先级错位**：团队主力在 Windows（CLAUDE.md 与 memory 均显示 PowerShell 为主、Git Bash 为辅，且 ESP-IDF 构建必须走 PowerShell）。计划只给了 bash 模板，zsh/powershell 仅在标题提及。v1 至少应交付 **bash + powershell**；PowerShell 的 `Register-ArgumentCompleter -Native -CommandName wink` 模型与 bash 完全不同，需单独实现。
2. **app 列表生成时固化**：`%(apps)s` 在 `wink completion bash` 执行时展开，之后新增 app 不会补全，直到用户重新 source。要么文档写明"新增 app 后需重跑 `wink completion ...`"，要么生成调用 `wink __complete --apps` 的动态补全（牺牲补全速度，需权衡）。
3. **bash 模板依赖外部 `bash-completion`**：`_init_completion` 在 macOS 自带 bash 3.2、精简 Git Bash 环境可能不存在。需注明依赖，或提供不依赖 `bash-completion` 的 fallback（`compgen -W` 直接可用）。
4. **覆盖范围要诚实声明**：模板只补了顶层命令与 `--app`，未补 `--target host/wasm`、各子命令的二级动作。v1 可接受，但文档应声明覆盖边界，不要承诺"智能补全"。
5. **app 扫描逻辑要复用 `resolve_app_dir`**：不要另写一套只扫 `wink-micro-app/` 的逻辑；应与 `gen.py:14-33` 的搜索路径（path / `wink-micro-app/<name>` / `sdk_root/samples/<name>`）一致，否则补全出的 app 与实际能 build 的不一致。

---

## 6. 跨阶段与工程治理问题

### 6.1 缺 ADR（F-9）

以下决策是跨模块、对外（IDE/CI/第三方插件）的公共契约，一旦定型难以回退。按 `CLAUDE.md` 与 `.claude/rules/docs-adr.md`，应**先写 ADR、Accepted 后回写设计规范**，再拆实施计划。四份计划目前未关联任何 ADR：

1. **命令分组法与命名规范**：group/subcommand 的层级、命名风格（kebab-case 已有 `new-dal` 等先例）、顶层命令准入标准、废弃与移除窗口。
2. **插件 entry_points 契约**：group 名（`wink_tools.plugins`）、entry point 指向的对象协议（是 factory 函数？CommandBase 子类？）、加载失败策略、安全/沙箱边界（第三方代码在开发者机器上以用户权限执行，需明确信任模型）。
3. **`--json` telemetry schema**：字段、版本化策略、stdout/stderr 分流契约、各命令必须/可选提供的字段。
4. **ConsoleService 核心接口**：作为所有命令依赖的基础服务，其方法签名、level 语义、json/quiet 行为需稳定。

### 6.2 性能门禁需可测量

主纲承诺 `wink --help` < 30ms，但没有测量脚本。建议在 CI 增加一个轻量基准（冷/热两次，取 P95），否则口头约束在加入文件扫描 + entry_points 后会悄悄退化。Windows 冷启动是重点关注对象（与 memory 中"ESP-IDF/host 工具链"经验一致，Windows 上 import 开销显著）。

### 6.3 测试发现缺口（F-5）

`wink test`（`cli/commands/test.py:60-63`）**只**发现 `tools/codegen/tests/`：

```python
tests_dir = ctx.tools_pkg / "codegen" / "tests"
subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", str(tests_dir), ...])
```

而计划新增的 `tools/tests/test_cli_deprecated_aliases.py`、`test_cli_plugins.py`、`test_cli_completion.py`、`test_cli_json_mode.py` 都在 `tools/tests/`（该目录现有 **39 个** test 文件，包括 `test_cli_registry.py`、`test_cli_lazy_import.py` 等）。全仓搜索未发现任何 CI/脚本引用 `tools/tests`（`.github/workflows/` 下只有 `clang-tidy.yml`）。

这意味着：
- 计划宣称的"运行 `wink test` 全量通过"**不会执行**这些新测试；
- 现有 39 个 `tools/tests/` 测试本身似乎也不在自动化回归网内（需确认团队如何运行它们）。

建议在 Phase 1（或作为前置任务）就把 `tools/tests/` 纳入 `wink test` 的发现范围（第二个 `unittest discover` 调用），否则后续三阶段的测试都是"写了但不守门"。这也符合项目 memory 中"smoke 测试必须显式 PASS/FAIL 且进入回归"的一贯原则。

### 6.4 打包与发布策略需前置决策

见 §4.5。这直接影响 Phase 2 的插件机制能否成立，也影响 Phase 3 的 `wink completion` 安装路径（`/etc/bash_completion.d/` vs 用户目录 vs `python -m`）。建议作为 Phase 2 的 ADR 子项先行。

### 6.5 与既有 ADR/规范的一致性

- 项目已有 ADR-0043（`wink lint` 分层门禁）、ADR-0032（BAL/Role 命名 A/B/C 类）等强命名约定。命令分组与重命名应在 ADR 中显式声明是否沿用这些约定，避免再造一套。
- ConsoleService 的日志分级（info/warn/error/debug）应与 PAL 侧已落地的 `LOG_E/W/I/D`（见 memory `pal-log-hardening-2026-07-05`）在语义上对齐，即便 CLI 与固件是两套实现，开发者心智模型应一致。

---

## 7. 修订建议与优先级

### 7.1 必须在动工前修正（阻断项）

1. **重写 Phase 1 问题陈述与验收标准**（§3.1）：纠正"`wink gen` 导致 C 全量重编译"的误判；把改造对象改为 CMake 实际消费的 `app_codegen.render_all` + `config_h.py`；用"touch DEPENDS 但不改内容"的对照实验验证收益。
2. **修正所有路径/文件名/API 错误**（§2）：入口改为 `wink-tools/wink.py`；删除虚构的 `gen_dal_bindings.py`；修正 `ep.value.__doc__`；补列受 AppContext 字段变更影响的两个测试；修正 completion 扫描目录；补归 `frontend-app-device-tree`。
3. **`write_file_if_changed` 改为字节直比 + 临时文件原子替换**（§3.3），保留 `newline="\n"`。
4. **ConsoleService 修正 error 不被吞、预埋累积器、复用颜色探测**（§3.5、§5.1），并采用"global_parent + dispatch 内构造、不入 AppContext"方案（§3.6）。
5. **把 `tools/tests/` 纳入 `wink test` 回归**（§6.3）。

### 7.2 建议补设计后再实施

6. **Phase 2 补 dispatcher 两级路由详细设计 + 回归矩阵**（§4.1）；别名改用 argparse 隐藏 parser 而非 argv 位置判断（§4.2）。
7. **Phase 3 先定义命令回传结构化数据的通道**（推荐 ConsoleService 累积器 + dispatcher finally 组装，§5.1），并把 stdout/stderr 分流写成硬契约（§5.2）。
8. **先补 4 份 ADR**（§6.1），至少在 Phase 2/3 动工前 Accepted 并回写 `06-build-toolchain/` 设计规范。

### 7.3 可选增强

9. PowerShell completion 提至与 bash 同级（§5.4）。
10. 插件加载失败在 `wink doctor` 可见（§4.4）。
11. 明确 `gen_device_tree.py` 去留（§3.2）。
12. 旧命令模块保留 thin shim + `DeprecationWarning` + 移除窗口（§4.6）。
13. CI 增加 `--help` 冷/热启动基准（§6.2）。

---

## 8. 结论

计划的**方向与分期值得肯定**，增量 codegen、统一 Console、命令分组、结构化输出也都是 `wink-tools` 走向开源与生态化的正确步骤。但当前版本存在一处动摇 Phase 1 立项根基的架构误判（`wink gen` 输出与 C 构建无关）、多处会立即导致失败的硬错误，以及 Phase 2/3 被低估的核心设计空洞。

建议**退回修订**：先按 §7.1 修正阻断项，按 §7.2 补齐 Phase 2/3 设计与 4 份 ADR，再进入实施。若修订后聚焦于"CMake 消费路径的 mtime 稳定化 + ConsoleService 一次到位 + dispatcher 两级路由 + JSON 累积器"，这套演进完全可以在不破坏现有 14 个命令与 CI 的前提下落地，并真正兑现"二次构建提速、日志统一、可扩展、可被 IDE 集成"的目标。

---

*评审人：Claude Code（架构师 / CLI 工具链视角）*
*评审依据代码版本：master @ df77ce9（2026-08-06）*
