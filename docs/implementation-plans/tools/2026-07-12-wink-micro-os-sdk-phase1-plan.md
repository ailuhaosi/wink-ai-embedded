# Dual-Mode SDK Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可解压的 **Source SDK 原样子集包**，修正 `wink_config.h` / 路径契约，使 M2（解压 SDK + 分目录 App）能 `wink.py build host` 成功，且 M1 ctest 不回归。

**Architecture:** 仓内目录不动。打包脚本从 `wink-micro-os/` 导出子集并写入 `VERSION` / `SDK_MANIFEST.txt` / `NOTICE`。CMake 在生成 `wink_config.h` **之前**解析 `WINK_APP_DIR`，输入改为 `${WINK_APP_DIR}/wink-app.json`。消费仍由 `cmake -S $WINK_SDK_PATH -DWINK_APP_DIR=<app>`（`wink.py` 已具备）。

**Tech Stack:** CMake ≥ 3.15、Python 3、`wink.py`、host GCC/MinGW；本阶段无 Emscripten/ESP-IDF 硬门禁。

**Spec:** [`../../tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md`](../../tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md)（Phase 1 only）

## Global Constraints

- **不做**预编译 `.a`、`include/`+`src/` 重排、`WINK_SDK_MODE`、统一 `wink_micro_os` IMPORTED target。
- **不做**仓内搬迁 `pal/`/`dal/` 等目录。
- Source 包 = 近乎原样的 `wink-micro-os/` 子集；**排除** `test/`、`build-*`、兄弟仓目录。
- `wink_config.h` 仅从 `${WINK_APP_DIR}/wink-app.json` 生成；`config_h.py` 对缺失字段已有默认值。
- Commit message 英文、原子化；一次 commit 一个逻辑模块（用户未要求则先不 commit，等用户指示）。
- 本计划**不改**静态分发 / 公共 API 面 / `WINK_APP_SOURCES` wasm 注入模型。

---

## 文件结构（本阶段）

| 路径 | 职责 |
|------|------|
| `wink-micro-os/CMakeLists.txt` | 提前解析 `WINK_APP_DIR`；config 输入改 App JSON |
| `wink-micro-os/targets/esp32/CMakeLists.txt` | 同上（`WINK_APP_DIR/wink-app.json`） |
| `wink-micro-os/tools/pack_sdk_source.py` | **新建**：打 Source tarball + manifest |
| `wink-micro-os/VERSION` | **新建**：`0.1.0` + `ABI=0`（P1 占位） |
| `wink-micro-os/NOTICE` | **新建**：商业分发说明（无 LICENSE 文件时的最小 NOTICE） |
| `wink-micro-os/SDK_MANIFEST.in.txt` | **新建**：清单模板（mode=source、排除规则） |
| `wink-micro-os/tools/wink.py` | M2：`--app` 绝对路径时 build 目录可落在 cwd；文档字符串 |
| `docs/design/02-wink-micro-os/03-directory-architecture.md` | §6.1 补 M2 / Source SDK 一句 |
| `docs/tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md` | 状态 → Accepted；挂本计划 |

---

### Task 1: `wink_config.h` 改为 App 目录 JSON

**Files:**
- Modify: `wink-micro-os/CMakeLists.txt`（config 段 + 提前 `WINK_APP_DIR`）
- Modify: `wink-micro-os/targets/esp32/CMakeLists.txt`（codegen input）

**Interfaces:**
- Consumes: `-DWINK_APP_DIR=`（cache/path）；App 内 `wink-app.json`
- Produces: `WINK_APP_JSON` 绝对/规范路径；`generate_config` 依赖该文件

- [ ] **Step 1: 在顶层 CMake 于 config 生成之前解析 `WINK_APP_DIR`**

将下列逻辑放在 `find_package(Python3…)` **之前**（替换稍后重复的 default 块，host/wasm 分支只 `message` + `add_subdirectory`，不再重新 `set` 默认值）：

```cmake
# App injection root — must resolve before wink_config.h codegen.
if(NOT DEFINED WINK_APP_DIR OR WINK_APP_DIR STREQUAL "")
    set(WINK_APP_DIR
        "${CMAKE_CURRENT_SOURCE_DIR}/../wink-micro-app/avoidance_car"
        CACHE PATH "Path to App directory containing wink-app.json")
endif()
if(NOT IS_ABSOLUTE "${WINK_APP_DIR}")
    get_filename_component(WINK_APP_DIR "${WINK_APP_DIR}" ABSOLUTE
        BASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
endif()
set(WINK_APP_JSON "${WINK_APP_DIR}/wink-app.json")
if(NOT EXISTS "${WINK_APP_JSON}")
    message(FATAL_ERROR
        "WINK_APP_JSON not found: ${WINK_APP_JSON}\n"
        "Set -DWINK_APP_DIR= to a directory that contains wink-app.json.")
endif()
message(STATUS "WINK_APP_DIR = ${WINK_APP_DIR}")
message(STATUS "WINK_APP_JSON = ${WINK_APP_JSON}")
```

- [ ] **Step 2: 改 `add_custom_command` 的 `--input` / `DEPENDS`**

```cmake
add_custom_command(
    OUTPUT ${WINK_CONFIG_H}
    COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/tools/codegen/config_h.py
            --input ${WINK_APP_JSON}
            --output ${WINK_CONFIG_H}
            --target ${TARGET_PLATFORM}
    DEPENDS ${WINK_APP_JSON}
            ${CMAKE_CURRENT_SOURCE_DIR}/tools/codegen/config_h.py
    COMMENT "Generating wink_config.h from ${WINK_APP_JSON}"
    VERBATIM
)
```

删除所有 `--input …/../wink-app.json` 硬编码。

- [ ] **Step 3: 同步 ESP32 组件**

在 `targets/esp32/CMakeLists.txt` 的 codegen 处：

```cmake
if(NOT DEFINED WINK_APP_DIR OR WINK_APP_DIR STREQUAL "")
    if(DEFINED ENV{WINK_APP_DIR} AND NOT "$ENV{WINK_APP_DIR}" STREQUAL "")
        set(WINK_APP_DIR "$ENV{WINK_APP_DIR}")
    else()
        message(FATAL_ERROR "WINK_APP_DIR must be set for esp32 wink_config.h codegen")
    endif()
endif()
set(WINK_APP_JSON "${WINK_APP_DIR}/wink-app.json")
# --input ${WINK_APP_JSON}  and DEPENDS ${WINK_APP_JSON}
```

（`esp32_firmware` / `wink.py esp32` 已传 `WINK_APP_DIR`。）

- [ ] **Step 4: 验证 monorepo host configure**

Run（在仓库根，按本机生成器调整）：

```powershell
cmake -S wink-micro-os -B build-host-sdk-p1 -DTARGET_PLATFORM=host -DWINK_APP_DIR=wink-micro-app/avoidance_car -G "MinGW Makefiles"
```

Expected: configure 成功；日志含 `WINK_APP_JSON = …/avoidance_car/wink-app.json`；**无** `../wink-app.json` 依赖。

- [ ] **Step 5: 负向 — 错误 App 路径应 FATAL**

```powershell
cmake -S wink-micro-os -B build-host-sdk-p1-bad -DTARGET_PLATFORM=host -DWINK_APP_DIR=wink-micro-app/no_such_app -G "MinGW Makefiles"
```

Expected: configure **失败**，信息含 `WINK_APP_JSON not found`。

---

### Task 2: Source SDK 打包脚本 + 元数据

**Files:**
- Create: `wink-micro-os/tools/pack_sdk_source.py`
- Create: `wink-micro-os/VERSION`
- Create: `wink-micro-os/NOTICE`
- Create: `wink-micro-os/SDK_MANIFEST.in.txt`

**Interfaces:**
- Consumes: SDK 根 = `pack_sdk_source.py` 的 `../`；可选 `--version` / `--out-dir`
- Produces: `wink-micro-os-sdk-source-vX.Y.Z.tar.gz` + 解压目录同名；内含 `SDK_MANIFEST.txt`

- [ ] **Step 1: 写入 `VERSION`**

```text
0.1.0
ABI=0
```

- [ ] **Step 2: 写入 `NOTICE`**

```text
Wink Micro OS — Source SDK distribution
Commercial Binary SDK (no implementation sources) is a separate artifact (Phase 2+).
This Source package includes implementation sources for internal / licensed use.
```

- [ ] **Step 3: 写入 `SDK_MANIFEST.in.txt`**

```text
mode=source
exclude=test/
exclude=build-*/
exclude=.git/
note=Phase1 faithful tree export of wink-micro-os (no include/src remap)
```

- [ ] **Step 4: 实现 `pack_sdk_source.py`**

行为要求：

1. `SDK_ROOT = Path(__file__).resolve().parent.parent`
2. 读 `VERSION` 首行作为 `ver`（如 `0.1.0`）
3. 输出名：`wink-micro-os-sdk-source-v{ver}`
4. 复制白名单顶层项：`pal`, `dal`, `bal`, `runtime`, `trace`, `targets`, `tools`, `CMakeLists.txt`, `core_sources.cmake`（若存在）, `VERSION`, `NOTICE`, `SDK_MANIFEST.in.txt`, `CHANGELOG.md`（若存在）, `.clang-tidy`（若存在）
5. **跳过**名称为 `test` 的目录；跳过 `build-*`；跳过 `__pycache__`、`.git`
6. 在暂存树根写 `SDK_MANIFEST.txt`：复制 `.in` 内容 + `version=` + `abi=` + 文件列表（相对路径，排序）
7. `tarfile` 打 `.tar.gz`（Windows 可用 stdlib）
8. CLI：`--out-dir` 默认 `SDK_ROOT/dist`

核心排除逻辑示例：

```python
SKIP_DIR_NAMES = {"test", "__pycache__", ".git"}
def should_skip(path: Path, sdk_root: Path) -> bool:
    rel = path.relative_to(sdk_root)
    parts = rel.parts
    if any(p in SKIP_DIR_NAMES for p in parts):
        return True
    if any(p.startswith("build-") for p in parts):
        return True
    return False
```

- [ ] **Step 5: 跑打包并做负向检查**

```powershell
python wink-micro-os/tools/pack_sdk_source.py --out-dir wink-micro-os/dist
```

Expected: 产出 `wink-micro-os/dist/wink-micro-os-sdk-source-v0.1.0.tar.gz`。

解压后检查：

```powershell
# 解压到临时目录后：
# - 存在 pal/ dal/ runtime/ tools/wink.py VERSION SDK_MANIFEST.txt NOTICE
# - 不存在 test/
# - 不存在 wink-micro-app / embedded-frontend
```

---

### Task 3: M2 冒烟（解压 SDK + 分目录 App）

**Files:**
- Modify: `wink-micro-os/tools/wink.py`（仅当 M2 构建目录/cwd 有问题时：`--app` 为绝对路径时 `build_dir` 使用 `Path.cwd() / "build-host-sdk"` 或 `app_dir.parent.parent / "build-host-from-sdk"` — 优先最小改动：文档化用绝对 `--app`，build 仍写在 `SDK_ROOT.parent/build-host` 可接受，只要能编过）

**Interfaces:**
- Consumes: 解压后的 `WINK_SDK_PATH`；monorepo 内 `wink-micro-app/avoidance_car` 绝对路径
- Produces: host 构建成功日志

- [ ] **Step 1: 解压 Source 包到临时目录**

```powershell
$sdkOut = Join-Path $env:TEMP "wink-sdk-p1-smoke"
Remove-Item -Recurse -Force $sdkOut -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $sdkOut | Out-Null
tar -xzf wink-micro-os/dist/wink-micro-os-sdk-source-v0.1.0.tar.gz -C $sdkOut
$sdk = Get-ChildItem $sdkOut -Directory | Select-Object -First 1 -ExpandProperty FullName
```

- [ ] **Step 2: 用解压 SDK 的 `wink.py` + 绝对 App 路径构建 host**

```powershell
$app = (Resolve-Path wink-micro-app/avoidance_car).Path
$env:WINK_SDK_PATH = $sdk
python "$sdk/tools/wink.py" build host --app $app --clean
```

Expected: configure/build **成功**；`WINK_APP_JSON` 指向 monorepo 的 `avoidance_car/wink-app.json`。

若失败因 `WORKSPACE_ROOT` 解析 frontend：本 Task **只要求 host**，不跑 wasm。

- [ ] **Step 3: 若 `wink.py` 在提取树中因 `resolve_frontend_dir` 在 import 期失败**

`wink.py` 在模块加载时调用 `resolve_frontend_dir()` 并可能 `sys.exit(1)`。检查现状：`os.environ["WINK_FRONTEND_PATH"] = str(resolve_frontend_dir()…)` — **若 sibling 不存在会直接退出**，M2 必炸。

**最小修复（本 Task 必须做）：** 将 frontend/esp32/scripts 的 resolve 改为**惰性**或 **缺失时写入空/警告而不 exit**；仅在 `handle_web` / `handle_esp32` / wasm 路径硬失败。

例如：

```python
def resolve_frontend_dir(required: bool = True) -> Path:
    ...
    if not required:
        return default_path  # may not exist
    print("[wink] Error: ...", file=sys.stderr)
    sys.exit(1)

# at module level:
os.environ["WINK_SDK_PATH"] = str(resolve_sdk_dir().as_posix())
# do NOT call resolve_frontend_dir() at import time unless present
_fe = resolve_frontend_dir(required=False)
if _fe.exists():
    os.environ["WINK_FRONTEND_PATH"] = str(_fe.as_posix())
```

同理 `resolve_esp32_dir` / `resolve_scripts_dir`。

- [ ] **Step 4: 重跑 Step 2，确认通过**

---

### Task 4: M1 回归（host ctest）

**Files:** 无新文件（验证 Task 1–3 未破坏 monorepo）

- [ ] **Step 1: 仓内 host 配置 + 构建 + ctest**

```powershell
python wink-micro-os/tools/wink.py test
```

或等价：

```powershell
cmake -S wink-micro-os -B build-host-test -DTARGET_PLATFORM=host -G "MinGW Makefiles"
cmake --build build-host-test
ctest --test-dir build-host-test --output-on-failure
```

Expected: 既有测试通过（允许跳过无 emcc 的 wasm smoke）。

---

### Task 5: 文档回写 + 规格状态

**Files:**
- Modify: `docs/tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md`（状态 Accepted；关联本计划）
- Modify: `docs/design/02-wink-micro-os/03-directory-architecture.md` §6.1（短段落）
- Modify: `wink-micro-os/tools/README.md`（pack + M2 示例）

- [ ] **Step 1: 规格头更新**

```markdown
| 状态 | **Accepted** |
| 关联实施计划 | [本文件](./2026-07-12-wink-micro-os-sdk-phase1-plan.md) |
```

- [ ] **Step 2: §6.1 追加**

说明：支持 `WINK_SDK_PATH` 指向 Source SDK 解压根；Phase 1 包为原样子集；消费：`python $WINK_SDK_PATH/tools/wink.py build host --app <abs-app-dir>`。

- [ ] **Step 3: tools/README 追加 pack / M2 命令块**

---

## Spec 覆盖自检

| 规格 Phase 1 验收 | Task |
|-------------------|------|
| 可重复 Source tarball | T2 |
| M2 SOURCE 冒烟（分目录） | T3 |
| M1 ctest 不回归 | T4 |
| `wink_config.h` ← App JSON | T1 |
| Manifest + VERSION + NOTICE | T2 |
| 负向：无 `test/`、无兄弟仓 | T2 Step 5 |
| 不做 `.a` / 重排 / MODE | 全局约束 |

---

## 执行说明

完成计划后可选：

1. **Subagent-Driven** — 每 Task 新子代理 + 中间评审  
2. **Inline Execution** — 本会话按 Task 顺序执行  

用户已口头要求「开始实施」时，默认采用 **Inline Execution**。

