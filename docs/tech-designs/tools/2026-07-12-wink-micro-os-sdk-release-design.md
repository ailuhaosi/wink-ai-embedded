# wink-micro-os Dual-Mode SDK 发布物 — 技术设计规格

| 项 | 内容 |
|----|------|
| 状态 | **Accepted** |
| 创建日期 | 2026-07-12 |
| 范围层级 | ② 技术设计规格（`docs/tech-designs/`） |
| 关联设计规范 | [`../02-wink-micro-os/03-directory-architecture.md`](../../design/02-wink-micro-os/03-directory-architecture.md)、[`../06-build-toolchain/01-toolchain-deployment.md`](../../design/06-build-toolchain/01-toolchain-deployment.md)、[`../01-system-overall/04-integration-with-wink-ai.md`](../../design/01-system-overall/04-integration-with-wink-ai.md) |
| 关联 ADR | [`ADR-0002`](../../decisions/unisim/0002-dual-target-compilation.md)（双 target）。**Phase 1 不新增 ADR**；**Phase 2 BINARY 实施前必须新增**工具链/ABI/库边界 ADR |
| 关联实施计划 | [Phase 1](../../implementation-plans/tools/2026-07-12-wink-micro-os-sdk-phase1-plan.md)；[Phase 2 (2a Host / 2b Wasm)](../../implementation-plans/tools/2026-07-12-wink-micro-os-sdk-phase2-plan.md) |
| 负责人 | TBD |

---

## 0. TL;DR

把 `wink-micro-os` 打成**版本化 Dual-Mode SDK**：`SOURCE`（交付实现源码）与 `BINARY`（商业分发**不交付**实现源码，仅公共头 + 预编译库）。消费者统一通过 `WINK_SDK_PATH` + `wink.py` 接入。

| 阶段 | 做什么 | 明确不做 |
|------|--------|----------|
| **Phase 1** | 路径解耦 + **原样子集**源码包 + M2 SOURCE 冒烟 | 预编译 `.a`、目录重排、`WINK_SDK_MODE` CMake、目标合并 |
| **Phase 2** | Host/Wasm BINARY：`include/` 汇聚 + `.a` + 模式切换 + **强制 ABI ADR** | ESP32 BINARY、`find_package` |
| **Phase 3** | ESP32 BINARY（IDF 预编译接入）+ 外部仓文档；可选 `find_package` | — |

> 「不交付实现源码」是**商业分发边界**，不是密码学级保密；公共头与 `.a` 仍可能被逆向。

---

## 1. 背景与问题

### 1.1 现状

| 事实 | 含义 |
|------|------|
| OS CMake 通过 `WINK_APP_DIR` `add_subdirectory` 注入 App | 依赖方向是 **OS → App** |
| `wink.py` / `wink-workspace.json` / `WINK_SDK_PATH` 已存在 | 已有「SDK 路径」雏形，但无独立发布边界 |
| `esp32_firmware` 已用 `WINK_SDK_PATH` | 真机路径接近 M2 |
| `wink_config.h` 生成写死 `../wink-app.json` | SDK 解压到任意位置时会断 |
| App CMake / `sample_common.cmake` 依赖 `${wink-micro-os_SOURCE_DIR}` | 需由 SDK 导出，不能假设相对布局 |
| `wink_app.h` / `wink_runtime.h` `#include "wink_config.h"`，runtime 编译依赖 `WINK_CONFIG_DIR` | BINARY 前必须厘清：**App config 不得冻进 `.a`**（见 §4.9） |
| 外部商业分发需隐藏 OS 实现源码 | 需要 BINARY 变体（Phase 2/3） |

### 1.2 目标

1. 产出可独立分发的 SDK，解压后即可作 `WINK_SDK_PATH`
2. 分期提供 `SOURCE` / `BINARY`；对 App 侧链接面尽量透明
3. App 只依赖公共 API 面 + 稳定路径契约
4. monorepo M1（OS-as-root + ctest）不回归
5. 云端钉版本、外部仓复用同一消费契约

### 1.3 非目标（Phase 1）

- 预编译静态库（`libwink_micro_os.a` 等）打包与分发 → Phase 2/3
- Pack-time `include/` + `src/` 目录重排 → Phase 2（与 BINARY 同步）
- `WINK_SDK_MODE` / 统一 `wink_micro_os` IMPORTED target → Phase 2
- `find_package(WinkMicroOS)` → Phase 3 可选
- 立刻拆 OS/App 双仓；Conan / vcpkg / npm
- 改变静态分发、公共 API 面、`WINK_APP_SOURCES` wasm 注入模型

---

## 2. 方案选型

| 方案 | 描述 | 结论 |
|------|------|------|
| **A'. Dual-Mode SDK（分期）** | P1 原样 SOURCE 包 + 路径解耦；P2 Host/Wasm BINARY；P3 ESP32 BINARY | **采纳** |
| B. CMake Package | `find_package(WinkMicroOS)` | Phase 3 可选 |
| C. Git submodule 钉 tag | App 仓 submodule OS | 不满足独立发布物 / 不交付源码 |

---

## 3. 发布物边界与目录布局

### 3.1 产物变体

| 变体 | 产物名 | 何时交付 |
|------|--------|----------|
| Source SDK | `wink-micro-os-sdk-source-vX.Y.Z.tar.gz` | **Phase 1** |
| Binary SDK | `wink-micro-os-sdk-binary-vX.Y.Z.tar.gz` | **Phase 2**（host/wasm）；**Phase 3** 含 esp32 |

- **渠道：** Git tag `vX.Y.Z` + Release / 内部包管理器
- **元数据（两种包均含）：** `VERSION`（含 `ABI=`）、`SDK_MANIFEST.txt`（mode、清单、工具链、content hash）、`LICENSE` / `NOTICE`（及必要的 `THIRD_PARTY`）

### 3.2 Phase 1：Source SDK = 原样子集（不做重排）

**仓内布局永不因本规格搬迁。** Phase 1 打包脚本从 monorepo 的 `wink-micro-os/` **近乎原样**导出，仅裁剪：

| 纳入 | 排除 |
|------|------|
| `pal/` `dal/` `bal/` `runtime/` `trace/` | `test/`（**例外**：保留 `test/stubs/`，host PAL 依赖） |
| `targets/{wasm,esp32,host,common}/` | `build-*` / 本地缓存 |
| `tools/`、顶层 `CMakeLists.txt`、`core_sources.cmake` 等构建入口 | monorepo 兄弟目录（app / frontend / esp32_firmware） |

```text
wink-micro-os-sdk-source/          # 解压后 = WINK_SDK_PATH
  ├── VERSION
  ├── SDK_MANIFEST.txt             # mode=source
  ├── LICENSE / NOTICE
  ├── pal/  dal/  bal/  runtime/  trace/
  ├── targets/
  ├── tools/
  └── CMakeLists.txt  …
```

> Phase 1 **不**引入顶层 `include/`、`src/`、`libs/`。消费端 CMake 与今日 monorepo 同源路径语义一致，只把根换成 `WINK_SDK_PATH`。

### 3.3 Phase 2+：Pack-time 重排（仅服务 BINARY / 稳定公共面）

自 Phase 2 起，**仅在打包时**生成稳定对外布局；仓内仍保持 `pal/`/`dal/`/… 平铺。

```text
[Monorepo 物理结构]              ──(pack)──>   [Binary SDK / 可选重排 Source]
dal/include/...  ──白名单──>  include/…（保持相对子目录，不拍平）
*.c 实现         ──SOURCE──>  src/…     或 ──BINARY──> 剔除，改放 libs/<target>/
```

#### Binary SDK 布局（Phase 2/3）

```text
wink-micro-os-sdk-binary/
  ├── VERSION                      # 含 SemVer + ABI=N
  ├── SDK_MANIFEST.txt             # mode=binary; targets=…; toolchain=…; hash=…
  ├── LICENSE / NOTICE
  ├── include/                     # 仅公共头白名单（§3.5）
  ├── libs/
  │     ├── host/
  │     │     ├── release/libwink_micro_os.a
  │     │     └── debug/libwink_micro_os.a      # 可选，便于外部排障
  │     ├── wasm/ …
  │     └── esp32/ …               # Phase 3
  ├── targets/                     # CMake + 非源码桥接（见 §4.7）
  └── tools/
```

重排后的 Source 变体（若 Phase 2 需要与 Binary 同构）可另产；**不阻塞 Phase 1**。

### 3.4 纳入 / 排除（按阶段）

| 路径 | P1 Source | P2+ Binary | 说明 |
|------|:---------:|:----------:|------|
| 原样 `pal/`…`trace/` | ✅ | ❌ | Binary 不交付实现 |
| `include/`（汇聚公共头） | ❌ | ✅ | Pack-time 白名单 |
| `libs/<target>/` | ❌ | ✅ | 预编译合并库 |
| `targets/`（完整） | ✅ | 裁剪 | Binary 只留 CMake + 桥接/非源文件 |
| `tools/` | ✅ | ✅ | codegen/lint/wink.py |
| `test/` | ❌（保留 `test/stubs/`） | ❌ | e2e/单测留 monorepo；`stubs/` 为 host PAL 编译依赖 |
| `build-*` | ❌ | ❌ | — |

### 3.5 公共头白名单与 Include 结构

Pack（Phase 2）必须维护**显式白名单**，对齐 [目录架构 §6](../../design/02-wink-micro-os/03-directory-architecture.md)：

| 允许汇入 `include/` | 禁止汇入 |
|---------------------|----------|
| `dal/include/**`（含 `input/` `output/` 等子目录） | `pal_hal.h` / `pal_osal.h` 及硬件契约头 |
| `runtime/include/wink_app.h`、`wink_runtime.h` 等公共 runtime 头 | `*_priv.h`、仅实现用头 |
| `trace/include/wink_trace.h` | `src/` 下任意实现文件旁头 |
| `pal/include/wink_status.h`（基础类型例外） | |

**结构约束：** 保持 App 现有 `#include "dal_servo.h"` 等解析方式所需的**相对子目录**，禁止拍平导致 include 漂移。

### 3.6 版本、ABI 与 SemVer

- 包版本：SemVer `vX.Y.Z`
- `VERSION` 另含 **`ABI=<整数>`**（公开头 + 公开 POD 布局契约代数）
- **规则（写入 Phase 2 ADR）：**
  - 公开 API 签名变更、或公开 `dal_*_t` 等 **POD 布局**变更 → **MAJOR**（并 `ABI++`）
  - 仅 `.c` 行为修复且头/POD 不变 → PATCH
  - 新加可裁剪能力、旧客户端可忽略 → MINOR

静态分发下 POD 在头文件中，**公开结构体即 ABI**。

---

## 4. App 消费契约

### 4.1 路径解析

1. `WINK_SDK_PATH` 环境变量  
2. `wink-workspace.json` → `sdk_dir`  
3. monorepo / `wink.py` 默认（脚本位于 SDK 内时自定位）

### 4.2 模式探测（全阶段统一语义）

| 信号 | 默认模式 |
|------|----------|
| 存在 `libs/<target>/`（或 `SDK_MANIFEST` 含 `mode=binary`） | **BINARY** |
| 否则（P1 原样树 / Source 包） | **SOURCE** |

- 显式：`WINK_SDK_MODE` 或 `--sdk-mode source|binary` → 转为 `-DWINK_SDK_MODE=…`
- **校验：** Binary 包（无实现源码）上指定 `SOURCE` → **`FATAL_ERROR`**
- **校验：** Source 包上指定 `BINARY` 但缺少对应 `libs/<target>/` → **`FATAL_ERROR`**

> 不以「有无 `src/`」作为 Phase 1 判据（P1 根本没有 `src/` 顶层目录）。

### 4.3 构建入口

```text
python $WINK_SDK_PATH/tools/wink.py build host|wasm --app <app-dir> [--sdk-mode source|binary]
python $WINK_SDK_PATH/tools/wink.py esp32 --app <app-dir> build [--sdk-mode source|binary]
```

Phase 1：可省略 `--sdk-mode`（恒为 SOURCE）。`--sdk-mode` / CMake 双模式实现属 Phase 2。

### 4.4 Phase 1 CMake 最少必要修正

| # | 修正 | 原因 |
|---|------|------|
| 1 | `WINK_APP_DIR` / `--app` → 任意含 `wink-app.json` 的目录 | SDK 与 App 可分目录 |
| 2 | `wink_config.h` 输入 = `${WINK_APP_DIR}/wink-app.json` | 去掉 `../wink-app.json` |
| 3 | App / `sample_common.cmake` 经 `WINK_SDK_PATH`（或 SDK `project()` 导出的 `wink-micro-os_SOURCE_DIR`）解析 | 去掉「必须与 OS 同级」 |
| 4 | 保留 `WINK_APP_SOURCES` + `PARENT_SCOPE` wasm 注入 | 双 target 沙箱模型不变 |

Phase 1 **不要求** App 改写为只 link `wink_micro_os`；维持现有 `dal` / `wink_runtime` / … 链接方式即可。

### 4.5 外部 App 最小树（Phase 3）

```text
my_app/
  wink-app.json
  wink-workspace.json    # { "sdk_dir": "<extracted-sdk>" }
  device_tree.c
  app_callbacks.c
  CMakeLists.txt
```

### 4.6 预编译库合并（Phase 2）— 分 target 配方

今日离散 target：`pal`（INTERFACE）、`pal_common` / `pal_host` / wasm·esp32 PAL 对象、`dal`、`wink_runtime`、`wink_trace`、`wink_bal`。

打包时对**每个** `TARGET_PLATFORM` 使用**独立 MRI（或等价）清单**合并为 `libs/<target>/…/libwink_micro_os.a`，例如：

```text
# host 示意 — 实表以 CI 生成的清单为准
CREATE libwink_micro_os.a
ADDLIB libdal.a
ADDLIB libwink_runtime.a
ADDLIB libwink_trace.a
ADDLIB libwink_bal.a
ADDMOD pal_common*.o
ADDMOD pal_host*.o          # host 专用，勿打进 wasm/esp32 包
SAVE
END
```

- `wasm` 配方替换为 wasm PAL 对象，**不含** `pal_host`
- `esp32` 配方（Phase 3）纳入 esp32 PAL / 组件编译产物中应进归档的对象
- `pal` INTERFACE 不产生 `.a`；只通过合并后的对象 + 头文件体现

**别名（Phase 2 BINARY CMake）：**

```cmake
add_library(wink_micro_os STATIC IMPORTED GLOBAL)
# … IMPORTED_LOCATION + INTERFACE_INCLUDE_DIRECTORIES …

foreach(lib dal wink_runtime wink_trace wink_bal)
    if(NOT TARGET ${lib})
        add_library(${lib} INTERFACE IMPORTED GLOBAL)
        target_link_libraries(${lib} INTERFACE wink_micro_os)
    endif()
endforeach()
```

### 4.7 体积与调试变体（Phase 2 ADR）

- BINARY 编译默认：`-ffunction-sections -fdata-sections`；消费者链接启用 `--gc-sections`（或目标链等价项），避免单库把未用 DAL 全拉进固件
- 建议同时产出 `libs/<target>/release/`（strip）与 `debug/`（保留符号），便于外部在无源码条件下排障
- CI 尽量可复现：钉编译器/IDF/emcc 版本；`SDK_MANIFEST` 记录 flags 与 content hash；条件允许时使用 `SOURCE_DATE_EPOCH`

### 4.8 Wasm 链接期非源文件（Phase 2）

Binary Wasm 包除 `.a` 外必须保留：

1. `targets/wasm/wink_sim_js.js`
2. 从**现有**顶层 CMake link options **抽出**的导出列表文件（例如 `targets/wasm/exported_runtime_functions.json`）——**今日尚不存在，Phase 2 创建，不假装已有 SSOT**
3. 经 `INTERFACE_LINK_OPTIONS`（或包装 CMake）传递 ASYNCIFY / `--js-library` / `EXPORTED_*` 等与现网一致的选项

### 4.9 `wink_config.h` 与 BINARY 硬约束（Phase 2 门禁）

现状：公共头与 runtime 编译依赖 `wink_config.h`（由 App 的 `wink-app.json` 生成）。

**硬规则：**

1. 消费端始终从 **`${WINK_APP_DIR}/wink-app.json`** 生成 `wink_config.h`（Phase 1 已要求）
2. 打进 `libwink_micro_os.a` 的翻译单元**不得**把某次 App 的 config 常量冻成不可覆盖的目标码，导致外部换 JSON 无效或 ABI 错乱
3. Phase 2 ADR 实施前必须完成审计：哪些 `.c` 依赖 config；必要时将 config 敏感逻辑上移到仅 App 编译的薄层，或保证 `.a` 仅依赖 ABI 中立默认且布局不随 config 变

### 4.10 ESP32 BINARY（Phase 3）— 示意，API 以 IDF 文档为准

ESP-IDF 以组件源码树为主。预编译接入**优先**使用当前 IDF 版本文档推荐方式（常见为 `add_prebuilt_library()` 再挂到 component），**不**写死未核实的 `idf_component_register(LIBRARIES …)` 为唯一真值。

实施时在 `targets/esp32/CMakeLists.txt` 按 `WINK_SDK_MODE` 分支：

- **SOURCE：** 维持现有 `idf_component_register(SRCS …)`  
- **BINARY：** 预编译库 + `INCLUDE_DIRS` 指向 SDK `include/` + 正确的 `REQUIRES`（`driver` / `esp_driver_*` 等按 IDF 版本矩阵，与今日组件一致）

具体 CMake 以 Phase 3 实施计划 + 当时 IDF 版本验证通过的片段为准。

### 4.11 工具链不匹配时的退路

| 客户持有的包 | ABI/工具链不匹配时 |
|--------------|-------------------|
| Binary SDK | 更换**匹配工具链矩阵**的 Binary 包，或走内部支持获取 **Source SDK**；**不能**对 Binary 包指望 `--sdk-mode source` |
| Source SDK（内部） | 可本地重编；云端对内 Job 可用 SOURCE |

---

## 5. Monorepo 双模式（M1 / M2）

| 模式 | 描述 | 用途 |
|------|------|------|
| **M1** | OS CMake root → `add_subdirectory(WINK_APP_DIR)` | 现状；host ctest；内部主门禁 |
| **M2** | 解压 SDK → `WINK_SDK_PATH` → `wink.py --app` | 发布物验证；云端 / 外部仓 |

规则：

1. Phase 1 **保留 M1**
2. M2 冒烟：pack Source → 解压 → `WINK_SDK_PATH` 指向解压根 → App 目录为 `wink-micro-app/avoidance_car`（**与 SDK 分目录**）→ `wink.py build host` 成功
3. App 文件 M1/M2 共用；路径只认 SDK 根
4. `test/` 仅 M1；发布物不含 e2e
5. 拆仓在 M2 + 云端钉版本稳定后考虑

```text
[ monorepo CI ]
    ├─ M1: cmake host + ctest
    └─ M2: pack source SDK → wink.py build host --app <avoidance_car>

[ 云端 · Phase 2+ ]
    ├─ 对内 Job: SOURCE 包（可调试）
    └─ 对外 Job: BINARY 包（不交付实现）；manifest 钉版本 + content hash

[ 外部 App 仓 · Phase 3 ]
    └─ wink-workspace.json.sdk_dir → 同 M2
```

---

## 6. 分期

| 阶段 | 交付 | 验证 |
|------|------|------|
| **Phase 1** | 路径解耦；原样 Source tarball；`SDK_MANIFEST`；M2 SOURCE 冒烟 | M1 ctest 不回归；负向：包内无完整 `test/`（仅允许 `test/stubs/`）、无兄弟仓目录 |
| **Phase 2** | Host/Wasm BINARY；公共头白名单；分 target 合并；`WINK_SDK_MODE`；**ABI/工具链 ADR**；config 不冻进 `.a` 审计。**执行拆分：** [2a Host 门禁收口 → 2b Wasm](../../implementation-plans/tools/2026-07-12-wink-micro-os-sdk-phase2-plan.md) | 对外默认 BINARY；对内 SOURCE；Wasm 桥接文件齐全；2a/2b 各自门禁见实施计划 |
| **Phase 3** | ESP32 BINARY（核实 IDF 预编译 API）；外部仓文档；可选 `find_package` | 真机链接冒烟；商业包含 LICENSE/NOTICE |

---

## 7. 验收标准（Phase 1）

1. **打包：** 可重复脚本/流水线产出 `wink-micro-os-sdk-source-vX.Y.Z.tar.gz`（原样子集）
2. **M2 冒烟：** 解压 SDK 与 App **分目录**；`wink.py build host --app avoidance_car` 成功（SOURCE）
3. **M1：** 现有 host ctest 不回归
4. **路径：** `wink_config.h` 仅从 `${WINK_APP_DIR}/wink-app.json` 生成；无 `../wink-app.json` 硬编码
5. **清单：** `SDK_MANIFEST.txt` 列 `mode=source` 与文件清单；含 `VERSION` / `LICENSE`（或等价）
6. **负向：** 解压树 **不含** `test/CMakeLists.txt` / e2e 源（允许 `test/stubs/`）、**不含** `wink-micro-app` / `embedded-frontend` / `esp32_firmware`

---

## 8. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 解压后误当 monorepo 根、`add_subdirectory` 找 sibling sample | 文档：消费只走 `wink.py --app`；M1 仅仓内 |
| `sample_common.cmake` 依赖 `wink-micro-os_SOURCE_DIR` | Phase 1：由 SDK `project()` / `WINK_SDK_PATH` 保证；Phase 2 再收拢到统一 target |
| BINARY ABI / 工具链漂移 | Phase 2 **强制 ADR** 钉矩阵；对外只发匹配包（§4.11） |
| 公开 POD 变更破坏已发 Binary | SemVer MAJOR + `ABI++`（§3.6） |
| `wink_config.h` 冻进 `.a` | §4.9 审计门禁；不过不合并 BINARY |
| 单库体积膨胀 | `-ffunction-sections` + 消费者 `--gc-sections`（§4.7） |
| codegen/lint 路径写死 monorepo | `WINK_SDK_PATH` / `WINK_CODEGEN_ROOT` |
| IDF 预编译 API 误用 | Phase 3 按官方 `add_prebuilt_library`（或当时文档）验证，§4.10 仅为示意 |
| 夸大「源码隐藏=安全」 | TL;DR 已界定为商业分发边界 |

---

## 9. 后续文档回写（Accepted 后）

- 更新 [`../02-wink-micro-os/03-directory-architecture.md`](../../design/02-wink-micro-os/03-directory-architecture.md) §6.1：M2 / `WINK_SDK_PATH`；注明 P1 原样包 vs P2 重排
- 更新 [`../06-build-toolchain/01-toolchain-deployment.md`](../../design/06-build-toolchain/01-toolchain-deployment.md)：Source/Binary 钉版本与 manifest hash
- **Phase 2 前强制 ADR：** 工具链矩阵、ABI/`ABI=`、分 target 合并边界、`wink_config.h` 与 `.a` 隔离、gc-sections 契约

---

## 10. 修订记录（相对前稿）

| 变更 | 原因 |
|------|------|
| Phase 1 源码包改为**原样子集**，重排延至 Phase 2 | 消除「P1 不做重排」与 `include/`+`src/` 布局的矛盾 |
| 模式探测改为 `libs/` / manifest，不用 `src/` | 适配 P1 原样树 |
| 补充公共头白名单、POD=ABI、config 不进 `.a`、分 target MRI、gc-sections、debug/release、可复现构建 | 嵌入式 SDK 实操门禁 |
| 修正「外部 Binary 可退 SOURCE」表述 | Binary 无源码，只能换包或走内部 Source |
| ESP32 段改为示意 + 以 IDF 文档为准 | 避免写死未核实的 `LIBRARIES` API |
| Wasm 导出 json 标明 Phase 2 抽取创建 | 避免伪造已有 SSOT |
| 标题改为 Dual-Mode SDK；元数据加 LICENSE/NOTICE | 与产品意图一致 |

