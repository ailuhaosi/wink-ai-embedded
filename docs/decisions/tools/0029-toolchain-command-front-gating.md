# ADR-0029：`wink.py` 工具链前置门（command-front `ensure_for`）

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-13 |
| 触发 | `wink.py` 内硬编码 WinLibs 绝对路径 + 无前置能力检查；cmake/emcc/idf 失败以晦涩底层错误的形式出现在管线深处，见 [Toolchain Bootstrap Design Spec](../../superpowers/specs/2026-07-13-wink-toolchain-bootstrap-design.md) §1、§3 |
| 影响范围 | `wink-micro-os/tools/wink.py`、`wink-micro-os/tools/toolchain/`（新增包）、`wink-micro-os/scripts/build_esp32.ps1`、`python wink-tools/wink.py test`、Source/Binary SDK 打包 |
| 决策者 | Wink Toolchain 维护者、SDK 分发负责人 |

---

## 背景（Context）

当前 `wink.py` 的启动路径存在三个结构性缺陷：

1. **硬编码机器路径**：文件顶部（约 25–28 行）硬编码 `C:\...\WinLibs\...\mingw64\bin` 前置到 `PATH`，`scripts/build_esp32.ps1`（21–43 行）与 `python wink-tools/wink.py test` 也各自硬编码了 IDF/emsdk 的绝对路径。这些路径只对提交人本机成立，不可移植；SDK 消费者拿到 tarball 后完全无法直接构建。
2. **无前置能力检查**：`wink build` / `wink wasm` / `wink esp32` / `wink test` 直接进入 cmake configure，工具缺失表现为 cmake 底层 `Could NOT find CMAKE_C_COMPILER` 或 `emcc: command not found`，用户看到的信息与"到底缺哪一件、应该装什么、放到哪里"完全脱节。
3. **`doctor` 命令是可选路径**：即使增加 `wink doctor`，用户仍必须记得"每次机器换环境后先跑一次"；否则第一次真正遇到工具链损坏时，仍以底层错误炸出。

Design spec §3 已把这个问题定性为**门控风格选择**，需要以 ADR 落定策略，且策略必须在 Phase A 代码合并前生效——否则新增的 `toolchain/` 包会与旧硬编码路径共存，一半事实来自 Provider、一半来自源码常量，报错就会互相打架。

---

## 方案比选（Options）

### 方案 A：Doctor-only（仅在用户显式运行 `wink doctor` 时检查）

- **做法**：`wink doctor` 汇报所有能力状态；`build` / `esp32` / `test` 等命令不做前置检查，直接进入原有流程。
- **优点**：改动小，向后兼容；用户在"知道自己环境齐全"时零开销。
- **缺点**：
  - 每台新机器/每个新 SDK 消费者第一次都会踩到"忘记跑 doctor → 底层报错 → 反查 → 再跑 doctor"的循环。
  - AI 生成的自动化脚本、CI 一次性任务都不会主动跑 doctor，仍会失败在 cmake 层。
  - 与 ADR-0028 "工具链矩阵通过 SDK 分发消费者机制强制执行"的意图相悖：consumer 拿到 Binary SDK 后必须每次显式 doctor，才能享受矩阵校验。
- **判定**：不推荐。把"记得跑 doctor"作为契约，是把可靠性外包给用户纪律。

### 方案 B：Docker-first（把整条工具链塞进容器，宿主只保留 docker daemon）

- **做法**：`wink build` / `wink esp32` 内部封装 `docker run …`，容器内固定 emsdk/IDF/mingw 版本。
- **优点**：机器无关；工具链版本完全对齐 ADR-0028 矩阵。
- **缺点**：
  - 与现有本地 IDF flash/serial 流程（`idf.py flash`、EIM 驱动、USB-Serial 直连）冲突；容器内 USB 透传在 Windows/macOS 上是长期痛点。
  - 与 SDK 消费者的实际预期偏离——消费者希望"在自己已有的 IDE + 本地 toolchain 上直接用 SDK"，不是"再学一套容器工作流"。
  - Design spec §2 已明确列为 non-goal（现在做，可后续再评估）。
- **判定**：不推荐（作为可选补充方向可后续独立评估）。

### 方案 C（推荐）：Command-front `ensure_for(profile)`

- **做法**：`wink.py` 的每个子命令声明自己的 profile（`codegen` / `host` / `wasm` / `test` / `esp32` / `web`）。`main()` 在 `parse_args` 之后、`args.handler(args)` 之前调用 `ensure_for(command)`：
  1. 按 profile DAG 展开必需能力 + 可选能力；
  2. 通过 Provider 逐项 detect（`shutil.which` + `--version` 探测 + 平台特化校验）；
  3. **Collect-all**：不早停，一次运行报出全部缺失/损坏项；
  4. 若必需项失败：渲染分组报告到 stderr，`sys.exit(1)`；
  5. 若必需项全过：把 profile 相关的 `PATH` / `IDF_PATH` / `PYTHONUTF8` 等注入 `os.environ`，再交给 handler。
- **提供逃生舱**：全局 `--skip-toolchain-check` 显式绕过（stderr 醒目告警），仅用于 CI 应急与调试。
- **优点**：
  - 缺失 → 立即停 + 明确指引，杜绝管线深处的晦涩报错。
  - 每个子命令**声明式**绑定 profile，新增命令只需登记 profile，无法漏检。
  - 硬编码 WinLibs / emsdk / IDF 路径全部下岗，SDK consumer 与主仓开发者走同一条门控路径。
  - Collect-all 报告让"一次装完"成为可能，而不是修一个跑一次再遇到下一个。
- **缺点**：
  - 每次调用多 200–500ms 探测开销（in-process 缓存后可忽略）。
  - 每个新子命令必须显式声明 profile 并调用 `ensure_for`——这是**契约成本**，需要在评审规则与代码模板中固化（见"后果与约束"）。
- **判定**：**推荐**。

---

## 决策结论（Decision）

采纳**方案 C：command-front `ensure_for(profile)`**。

规范化的落地约束：

1. `wink.py` 的所有面向用户子命令（当前含 `gen` / `build`（`host` / `wasm`）/ `esp32` / `test` / `web` / `doctor` / `setup`）都要通过一张 profile 表映射到 `toolchain/profiles.py` 定义的 profile 名。新增子命令**必须**在 profile 表登记，否则该子命令必须显式设置 `profile=None`（例如纯本地 `setup`、只读 `doctor`）并在 code review 中说明理由。
2. `ensure_for(profile)` 采用 collect-all 语义：单次运行探测所有相关能力，一次性报出全部失败项；不允许在探测阶段 early-exit（除非能力探测抛出 catastrophic 异常）。
3. 门控失败时输出必须包含：
   - 缺失能力 id、最低版本要求、当前探测到的路径/版本（若部分匹配）；
   - 失败原因摘要；
   - OS 相关的安装指引（Windows 明确到 `winget` / EIM）；
   - 支持自定义位置的 `wink setup --set` 命令示例与相关环境变量；
   - 可复现的验证命令。
4. 成功时 `ensure_for` 负责按 profile 注入环境变量：
   - `codegen` / `host` / `test`：prepend `gcc/cmake/make` bin 到 `PATH`；
   - `wasm`：不修改 emsdk 相关变量（Phase A 强制用户自行激活 shell）；
   - `esp32`：注入 `IDF_PATH` / `IDF_TOOLS_PATH` / `IDF_PYTHON_ENV_PATH` / `ESP_IDF_VERSION` + `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8`，**不**把 host gcc/emsdk 加入 PATH（IDF 自带工具链）；
   - `web`：只在需要时 prepend node bin。
5. 提供 `--skip-toolchain-check` 全局旗标作为逃生舱，触发时必须在 stderr 打印醒目 WARN。
6. `wink.py` 现有硬编码 WinLibs `mingw_bin` 前置代码块（约 25–28 行）删除；`scripts/build_esp32.ps1` 与 `python wink-tools/wink.py test` 中的硬编码 IDF/emsdk/WinLibs 路径块删除，改为消费 `ensure_for` 注入后的环境（见 §12.2、§12.3 spec 与 Task 10/11）。

---

## 后果与约束（Consequences & Constraints）

- **契约固化到评审规则**：`wink.py` 新增任意面向用户子命令，代码评审必须核对：
  - 是否在 profile 表登记；
  - 是否显式调用 `ensure_for`（或者 `profile=None` 并附理由）；
  - 是否给对应 profile 的所需能力增加了 Provider（若首次引入新能力）。
- **无绝对机器路径**：`wink.py` / `python wink-tools/wink.py test` / `scripts/build_esp32.ps1` 的业务代码不允许出现硬编码本机 `C:\` / `D:\` / `~/software/...` 类路径。允许保留的少量常量：EIM 已知安装根目录探测模式（`C:\Espressif\tools\Microsoft.v*.PowerShell_profile.ps1`），以及 `winget` 官方包名。
- **SDK 打包必须包含 `toolchain/` 包**：`pack_sdk_source.py` / `pack_sdk_binary.py` 都要把 `wink-micro-os/tools/toolchain/` 打入 tarball；`toolchain/` 保持纯 Python 无二进制依赖，避免打包复杂度。
- **性能**：单次 `wink build` 门控开销预算 ≤ 500ms（10 个能力，每次 ≈ 50ms subprocess），in-process 缓存去重，一次调用同能力只探测一次。若某 Provider 因外部 binary 卡住，探测统一 `timeout=10s`，超时视为 `found=False`，reason 记录 "binary timed out"。
- **AI 代码生成规约**：Codegen 生成的样例/脚本不再假设"跑 `wink.py` 前 PATH 已经有 mingw/emsdk"。生成模板应显式提示"先 `wink doctor` / `wink setup`"，或直接依赖 `wink build` 的门控输出。
- **迁移风险**：既有开发机若长期依赖顶部硬编码 WinLibs 前置，删除后**必须**通过 `~/.wink/tools.json`（`wink setup --set gcc=...`）或 `WINK_GCC_PREFIX` 显式指向本机 mingw。迁移期间的一次性报错是可接受的（收益是彻底摆脱"提交人电脑独占"）。

---

## 遵循与后续（Compliance & Follow-up）

- 本 ADR Accepted 后立即回写至 `docs/design/06-build-toolchain/01-toolchain-deployment.md`，作为 Phase A 门控设计的活文档；`wink.py` 命令矩阵、profile 声明、`--skip-toolchain-check` 逃生舱语义均以 06-build-toolchain 为单一事实来源。
- 关联实施计划：Phase A 首轮实现的多任务拆分（Providers、resolve、report、CLI wiring、build_esp32/run-tests refactor、SDK 打包对齐）见 `docs/implementation-plans/tools/2026-07-13-toolchain-bootstrap-phase-a-plan.md`。
- 关联 ADR：与 [ADR-0028](../core/0028-host-binary-abi-toolchain-contract.md) 协同——ADR-0028 定义"消费者用什么工具链"，本 ADR 定义"如何在每次调用时把它对齐"。
- 关联 ADR：与 [ADR-0030](../core/0030-esp-idf-never-auto-installed.md) 协同——`ensure_for(esp32)` 探测到 IDF 缺失时的报告文案受 ADR-0030 约束（"永不自动安装 IDF"文案必现）。

---

*本 ADR 状态变更请在此记录：*
- 2026-07-13：Proposed（Toolchain Bootstrap Phase A 前置门策略提议）
- 2026-07-13：Phase A 后续落地 — `scripts/build_esp32.ps1` 与 `esp32_firmware/generate_app_sources.ps1` 已迁移至 `tools/esp32/{activate,build,generate_app_sources}.py`；PowerShell 从 esp32 profile 的 required capability 降级（`activate.py` 仅在 Windows 需要采集 EIM profile 时才子进程调用 `powershell.exe`）；`scripts_dir` 从 `WORKSPACE_DEPS["esp32"]` 移除。详见 `docs/design/06-build-toolchain/01-toolchain-deployment.md`。

