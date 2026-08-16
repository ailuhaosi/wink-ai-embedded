# Dual-Mode SDK Phase 2 — Implementation Plan (2a Host / 2b Wasm)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收口 **Host BINARY SDK**（Phase 2a）门禁与文档，再交付 **Wasm BINARY**（Phase 2b），使 Dual-Mode SDK Phase 2 按规格可验收。

**Architecture:** 仓内仍平铺 `pal/`/`dal/`/…；仅打包时产出 `include/` + `libs/<target>/`。Host 已有原型（`pack_sdk_binary.py` + `wink_binary_import.cmake`）；2a 修门禁并钉 ABI；2b 对 wasm 做平行配方（合并库 + JS 桥接 + 导出清单），消费端统一 `WINK_SDK_MODE`。

**Tech Stack:** CMake ≥ 3.15、Python 3、MinGW-w64/MSVC（host）、Emscripten（wasm）、`wink.py`、`ar`/`emar`

**Spec:** [`../../tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md`](../../tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md) §3.3–3.6、§4.2–4.9、§6  
**ADR:** [`../../decisions/core/0028-host-binary-abi-toolchain-contract.md`](../../decisions/core/0028-host-binary-abi-toolchain-contract.md)（2a）；2b 可扩展同一 ADR 增 Wasm 工具链矩阵，**不**新开 ADR，除非矩阵与 Host 决策冲突

## Global Constraints

- **不做** ESP32 BINARY（Phase 3）、`find_package(WinkMicroOS)`、仓内目录搬迁。
- Binary 包**不**交付实现 `.c`（允许根目录 `smoke_test.c`、`test/stubs/`）。
- App `wink_config.h` 仍仅从 `${WINK_APP_DIR}/wink-app.json` 生成；`.a` 内数组上限 = ADR 钉死的 pack 默认，消费者 **≤** 该上限。
- 公开 POD / 公共头变更 → MAJOR + `ABI++`（本阶段默认 `ABI=1`）。
- Commit 英文、原子化；用户未要求则不自动 commit。
- 不改静态分发 / 公共 API 面语义；仅加 BINARY 消费路径。

---

## 分期与验收总表

| 切片 | 交付 | 验收 |
|------|------|------|
| **2a Host** | 修 pack 缺陷；pack 钉 config 上限 + `-ffunction-sections`；manifest 钉工具链/hash；`ABI=1`；设计规范回写；M2 BINARY 冒烟可重复 | 解压 Binary → `wink.py build host --sdk-mode binary --app avoidance_car` 配置成功 + `binary_sdk_smoke` PASS；包内无实现源码泄漏 |
| **2b Wasm** | `libs/wasm/` + 桥接文件 + 导出 json；BINARY wasm CMake 路径；M2 wasm 冒烟 | 解压包含 `targets/wasm/wink_sim_js.js` 与导出清单；`wink.py build wasm --sdk-mode binary` 能产出 `wink_simulator.{js,wasm}` |

---

## 文件结构（本阶段）

| 路径 | 职责 |
|------|------|
| `wink-micro-os/tools/pack_sdk_binary.py` | Host(+Wasm) 打包、合并、manifest、负向检查 |
| `wink-micro-os/targets/host/wink_binary_import.cmake` | Host IMPORTED + 别名；挂 `--gc-sections` / `/OPT:REF` |
| `wink-micro-os/targets/wasm/wink_binary_import.cmake` | **新建** Wasm BINARY import |
| `wink-micro-os/targets/wasm/exported_runtime_functions.json` | **新建** 从顶层 CMake 抽出的 EXPORTED_* SSOT |
| `wink-micro-os/tools/binary_sdk_cmake/CMakeLists.txt` | 消费端入口（host 冒烟；2b 扩 wasm） |
| `wink-micro-os/CMakeLists.txt` | `WINK_SDK_MODE`；wasm BINARY 分支；引用导出 json |
| `wink-micro-os/VERSION` | `ABI=1` |
| `docs/decisions/core/0028-host-binary-abi-toolchain-contract.md` | 必要时补 Wasm 矩阵 / 修正默认值表述 |
| `docs/design/02-wink-micro-os/03-directory-architecture.md` | §6.1 Binary / M2 |
| `docs/design/06-build-toolchain/01-toolchain-deployment.md` | Source/Binary 钉版本 + manifest |
| `wink-micro-os/tools/README.md` | `pack_sdk_binary` + M2 BINARY 命令 |

---

## Phase 2a — Host 门禁收口

### Task 1: 修复 `pack_sdk_binary.py` 正确性缺陷

**Files:**
- Modify: `wink-micro-os/tools/pack_sdk_binary.py`
- Test: 本地 `python tools/pack_sdk_binary.py --out-dir dist`（或 `--skip-build` 若 build 已存在）

**Interfaces:**
- Consumes: 既有 `build_host` / `merge_libraries` / `copy_sdk_bridge`
- Produces: 可完整跑通 `pack()`（含负向检查）的 tarball

- [ ] **Step 1: 修正 `find_component_libs` 运算符优先级**

将匹配条件改为显式括号（当前 `and`/`or` 无括号会误匹配）：

```python
for c in candidates:
    if c.suffix in (".a", ".lib") and ("wink_" in c.name or name in c.name):
        libs[name] = c
        break
```

- [ ] **Step 2: 负向检查允许根目录 `smoke_test.c`**

在 `pack()` 的 `*.c` 泄漏检查中：

```python
ALLOWED_ROOT_C = {"smoke_test.c"}
for c_file in staging.rglob("*.c"):
    rel = c_file.relative_to(staging)
    rel_posix = rel.as_posix()
    if rel_posix in ALLOWED_ROOT_C:
        continue
    if rel_posix.startswith("test/"):
        continue
    raise SystemExit(f"[pack-binary] refused: implementation source leaked: {rel_posix}")
```

（用 `as_posix()`，避免 Windows `\` 导致 `test/` 前缀判断失败。）

- [ ] **Step 3: `--skip-build` 路径复用同一套负向检查**

把负向检查抽成 `assert_staging_clean(staging: Path) -> None`，`pack()` 与 `--skip-build` 分支都调用。

- [ ] **Step 4: 跑一次完整 pack（或 skip-build）确认不再因 smoke_test 失败**

Run:
```powershell
python wink-micro-os/tools/pack_sdk_binary.py --skip-build --build-dir <existing-host-build> --out-dir wink-micro-os/dist
```
Expected: 打印 `[pack-binary] Wrote ...wink-micro-os-sdk-binary-v0.1.0.tar.gz`，exit 0。

- [ ] **Step 5: Commit（仅用户要求时）**

```bash
git add wink-micro-os/tools/pack_sdk_binary.py
git commit -m "fix(sdk): harden binary pack lib discovery and smoke_test allowlist"
```

---

### Task 2: Pack-time ABI 上限 + section 分割 + ABI=1

**Files:**
- Modify: `wink-micro-os/tools/pack_sdk_binary.py`（`build_host` 增加 compile defs / flags）
- Modify: `wink-micro-os/VERSION` → `ABI=1`
- Modify: `wink-micro-os/targets/host/wink_binary_import.cmake`（消费端 gc）
- Modify: `docs/decisions/core/0028-host-binary-abi-toolchain-contract.md`（若表述与实现不一致则对齐；公开头默认仍可保持 16/8，**pack 编译**强制 32/16）

**Interfaces:**
- Consumes: ADR-0028 §5–§6
- Produces: `.a` 以 `WINK_MAX_SOFT_TIMERS=32`、`PAL_PWM_CHANNELS=16` 编译；带 `-ffunction-sections -fdata-sections`（GCC）或 `/Gy`（MSVC）

- [ ] **Step 1: `build_host` 注入 BINARY pack 宏与 flags**

```python
configure_cmd = [
    "cmake", "-S", str(sdk_root), "-B", str(build_dir),
    "-DTARGET_PLATFORM=host",
    f"-DWINK_APP_DIR={sdk_root.parent / 'wink-micro-app' / 'avoidance_car'}",
    "-DCMAKE_C_FLAGS=-DWINK_MAX_SOFT_TIMERS=32 -DPAL_PWM_CHANNELS=16 -ffunction-sections -fdata-sections",
]
# MSVC 路径：改用 -DCMAKE_C_FLAGS=/DWINK_MAX_SOFT_TIMERS=32 /DPAL_PWM_CHANNELS=16 /Gy
# 用 shutil.which / 试探生成器，或文档要求 MinGW 为 2a 主路径。
```

**约束：** 不要依赖某次 App 的 `wink-app.json` 数值冻进 `.a`；显式 `-D` 覆盖 `#ifndef` 默认。

- [ ] **Step 2: 消费端链接 gc**

在 `wink_binary_import.cmake` 的 `wink_micro_os` 上：

```cmake
if(MSVC)
    target_link_options(wink_micro_os INTERFACE /OPT:REF)
else()
    target_link_options(wink_micro_os INTERFACE "LINKER:--gc-sections")
endif()
```

- [ ] **Step 3: `VERSION` 升 `ABI=1`**

```text
0.1.0
ABI=1
```

- [ ] **Step 4: ADR 补一句澄清**

在 ADR-0028 §5 加注：公开头 `#ifndef` 默认可为 16/8（SOURCE 友好）；**Binary pack 编译**强制 32/16，消费者 `wink-app.json` 不得超过 pack 上限。

- [ ] **Step 5: 重新 pack host，确认 `.a` 与 VERSION**

Expected: tarball 内 `VERSION` 含 `ABI=1`；`SDK_MANIFEST.txt` 含 `abi=1`。

---

### Task 3: Manifest 钉工具链 + content hash

**Files:**
- Modify: `wink-micro-os/tools/pack_sdk_binary.py`（`build_manifest`）

**Interfaces:**
- Produces: `SDK_MANIFEST.txt` 含 `toolchain=`、`cflags=`、`content_sha256=`

- [ ] **Step 1: 采集工具链字符串**

```python
def detect_toolchain() -> str:
    # Prefer writing a tiny cmake -P 或读取 build_dir/CMakeCache.txt 的 CMAKE_C_COMPILER
    # 回退: `gcc --version` / `cl` 首行
    ...
```

- [ ] **Step 2: 写 manifest 字段**

```text
mode=binary
targets=host
version=0.1.0
abi=1
toolchain=<cc --version first line>
cflags=-DWINK_MAX_SOFT_TIMERS=32 -DPAL_PWM_CHANNELS=16 -ffunction-sections -fdata-sections
content_sha256=<sha256 of sorted file contents, exclude SDK_MANIFEST.txt itself>
files:
  ...
```

- [ ] **Step 3: 验证解压后 manifest 含上述键**

---

### Task 4: M2 Host BINARY 可重复冒烟 + 文档

**Files:**
- Modify: `wink-micro-os/tools/README.md`
- Modify: `docs/design/02-wink-micro-os/03-directory-architecture.md` §6.1
- Modify: `docs/design/06-build-toolchain/01-toolchain-deployment.md`（新增短节）
- Modify: `docs/tech-designs/tools/2026-07-12-wink-micro-os-sdk-release-design.md`（关联本计划；§6 注明 2a/2b）

**Interfaces:**
- Produces: 文档中可复制的 PowerShell/bash 冒烟步骤

- [ ] **Step 1: README 增加 Binary pack 段**

```powershell
python wink-micro-os/tools/pack_sdk_binary.py --out-dir wink-micro-os/dist
tar -xzf wink-micro-os/dist/wink-micro-os-sdk-binary-v0.1.0.tar.gz -C $env:TEMP/wink-sdk-bin
$sdk = "$env:TEMP/wink-sdk-bin/wink-micro-os-sdk-binary-v0.1.0"
$env:WINK_SDK_PATH = $sdk
cmake -S $sdk -B $sdk/build-smoke -DTARGET_PLATFORM=host `
  -DWINK_APP_DIR=(Resolve-Path wink-micro-app/avoidance_car)
cmake --build $sdk/build-smoke
ctest --test-dir $sdk/build-smoke -R binary_sdk_smoke --output-on-failure
```

Expected: `binary_sdk_smoke` PASS；`avoidance_car` 因无完整 `test/` harness 跳过 e2e（已有逻辑）。

- [ ] **Step 2: 目录架构 §6.1 补 Binary 一句**

在 Source SDK 段落后增加：Phase 2 Binary 解压根含 `include/` + `libs/<target>/`；`mode=binary`；消费 `wink.py build host --sdk-mode binary`。

- [ ] **Step 3: toolchain 文档补「SDK 钉版本」短节**

说明对外 Job 用 Binary + manifest `content_sha256`；对内可用 Source；ABI 见 ADR-0028。

- [ ] **Step 4: 技术规格挂本计划并标注 2a/2b**

在规格「关联实施计划」增加 Phase 2 链接；§6 表格拆成 2a Host / 2b Wasm。

- [ ] **Step 5: 按 Step 1 命令实跑一遍，把失败点修到绿**

**2a 完成门禁：** 上表 Host 验收行全部满足。

---

## Phase 2b — Wasm BINARY

### Task 5: 抽出 Wasm 导出清单 SSOT

**Files:**
- Create: `wink-micro-os/targets/wasm/exported_runtime_functions.json`
- Modify: `wink-micro-os/CMakeLists.txt`（wasm link options 读该文件，或保持硬编码并 **注释声明 json 为打包 SSOT 镜像**——优先真正读取以免漂移）

**建议 json 内容（与现网一致）：**

```json
{
  "EXPORTED_FUNCTIONS": ["_main", "_malloc", "_free"],
  "EXPORTED_RUNTIME_METHODS": ["ccall", "cwrap", "HEAPU8", "Asyncify", "callMain"],
  "ASYNCIFY_IMPORTS": ["js_pal_os_sleep_ms", "js_pal_os_busy_wait_us"],
  "ASYNCIFY_STACK_SIZE": 65536
}
```

- [ ] **Step 1: 新增 json 文件（内容如上）**
- [ ] **Step 2: 顶层 wasm `target_link_options` 改为由 json 生成字符串（Python 预生成或 CMake `string(JSON …)`）**
- [ ] **Step 3: SOURCE 模式 `wink.py build wasm` 不回归**

---

### Task 6: Wasm 库合并 + 打包纳入桥接

**Files:**
- Modify: `wink-micro-os/tools/pack_sdk_binary.py`
  - 增加 `--targets host,wasm`（默认 `host`；2b 完成后默认 `host,wasm`）
  - wasm：emcmake 构建 → 合并 `libdal`/`libwink_*` + wasm PAL 对象（**不含** `pal_host`）→ `libs/wasm/release/libwink_micro_os.a`
  - 复制 `targets/wasm/wink_sim_js.js`、`exported_runtime_functions.json`、`wink_binary_import.cmake`（wasm）

**Interfaces:**
- Produces: 单 tarball `targets=host,wasm` 或分 target 字段清晰的一份包

- [ ] **Step 1: 实现 `build_wasm` + `find_wasm_pal_objs` + merge 到 `libs/wasm/release/`**
- [ ] **Step 2: `copy_sdk_bridge` 增加 wasm 桥接白名单**
- [ ] **Step 3: 负向检查：无 `pal_host` 对象进 wasm 库（可用 `nm`/`llvm-nm` 抽查符号，或打包时 assert 对象路径不含 `targets/host`）**
- [ ] **Step 4: manifest `targets=host,wasm`**

---

### Task 7: Wasm BINARY 消费路径

**Files:**
- Create: `wink-micro-os/targets/wasm/wink_binary_import.cmake`
- Modify: `wink-micro-os/CMakeLists.txt`（`WINK_SDK_MODE=binary` + `TARGET_PLATFORM=wasm` 时 include wasm import，跳过源码 PAL/dal 子目录，仍注入 `WINK_APP_SOURCES` + link `wink_micro_os` + js-library）
- Modify: `wink-micro-os/tools/binary_sdk_cmake/CMakeLists.txt`（按 platform 分支）

**Interfaces:**
- Consumes: `libs/wasm/release/libwink_micro_os.a`、`include/`、桥接文件
- Produces: `wink_simulator` 可链接

- [ ] **Step 1: 写 `targets/wasm/wink_binary_import.cmake`（镜像 host：IMPORTED + 别名 + INTERFACE include + link options 从 json）**
- [ ] **Step 2: 顶层 CMake BINARY+wasm 分支接线**
- [ ] **Step 3: M2 冒烟**

```powershell
$env:WINK_SDK_PATH = "<extracted-binary-sdk>"
python "$env:WINK_SDK_PATH/tools/wink.py" build wasm --sdk-mode binary --app (Resolve-Path wink-micro-app/avoidance_car)
```

Expected: 产出 `wink_simulator.js` / `.wasm`；缺桥接文件时应 `FATAL_ERROR`（清晰报错）。

- [ ] **Step 4: 扩展 ADR-0028 或附录：Wasm 工具链 = 钉 Emscripten 主版本；与 Host 包可同 tarball 分 `libs/`**

**2b 完成门禁：** 总表 Wasm 验收行全部满足；2a 不回归。

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| MSVC 与 MinGW `.a` 混用 | 2a 主路径钉 MinGW；manifest 写清 toolchain；MSVC 作次要或后续 |
| emar / emcc 对象合并踩坑 | 用 `emar`/`emcc -r` 文档路径；CI 只在有 emsdk 的 job 跑 2b |
| SOURCE/BINARY 头默认值混淆 | ADR 澄清 + README 写「消费者 max ≤ pack 上限」 |
| 顶层 CMake BINARY 与 consumer CMakeLists 双入口漂移 | Binary 包继续用 `tools/binary_sdk_cmake/CMakeLists.txt` 覆盖根；monorepo 顶层保留双模式自测 |

---

## 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-12 | 初稿：按评审将 Phase 2 拆 2a Host 收口 / 2b Wasm；对齐 ADR-0028 与规格 §4.6–4.9 |

