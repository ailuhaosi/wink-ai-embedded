# 新增外设流程优化 — 技术设计

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-27 |
| 状态 | **已实施（2026-07-27）** |
| 关联 ADR | [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)（Accepted；延伸 ADR-0039）；须遵守 ADR-0001 / 0002 / 0004 / 0034 / 0043 |
| 关联实施计划 | [implementation-plans/2026-07-27-peripheral-onboarding-optimization-plan.md](../../implementation-plans/tools/2026-07-27-peripheral-onboarding-optimization-plan.md) |
| 关联设计规范 | [01-dal-device-abstraction.md](../../design/02-wink-micro-os/01-dal-device-abstraction.md)；[03-ai-dsl-and-codegen-pipeline.md](../../design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md) |
| 关联前序设计 | [2026-07-18-dal-dual-mode-auto-pruning.md](../core/2026-07-18-dal-dual-mode-auto-pruning.md) |
| 跨仓契约 | 仿真侧 [ADDING_PERIPHERAL.md](file:///d:/workspaces/ai-coding/wink-ai/wink-ai/packages/unisim/docs/ADDING_PERIPHERAL.md)（文档级对齐，本设计不改 unisim 代码） |
| 范围 | 嵌入式仓流程标准化 + 驱动列表 SSOT 收敛 + `wink.py new-dal`；unisim 仅文档交叉步骤 |

---

## 1. 背景与问题

### 1.1 现状（已核实）

新增一个 DAL 外设类型，今天通常要同步改 **5–7 处**：

| # | 位置 | 内容 |
|---|------|------|
| 1 | `dal/include/<cat>/dal_<name>.h` | API + `WINK_UNAVAILABLE_MSG` stub |
| 2 | `dal/src/<cat>/dal_<name>.c` | 驱动实现 |
| 3 | `dal/CMakeLists.txt` | `option()` + `_wink_dal_enable()`（SSD1306 等另有手写分支） |
| 4 | `cmake/wink_dal_drivers.cmake` | 无 JSON 全开列表 + `wink_dal_add_enabled_sources` |
| 5 | `tools/binary_sdk_cmake/CMakeLists.txt` | Binary SDK **独立**内联驱动名列表 |
| 6 | `tools/codegen/app_codegen.py` | 硬编码 `ALL_WINK_USE_OPTIONS` |
| 7 | `tools/codegen/drivers/<name>.py` | CodeGen 插件 |

其中 Python 侧 `drivers/__init__.py` **已自动扫描**插件；CMake / options 仍手写。这与 ADR-0039「一处驱动表、多入口消费」的长期目标仍有偏差：表实际散落在 CMake 与 codegen，漏改会导致「某 target 能编、另一 target 链接失败」。

另：嵌入式侧缺少与 unisim `ADDING_PERIPHERAL.md` 对等的**标准化操作指南**；新人/AI 只能从分散 ADR 与示例驱动反推流程。

补充现状差异（迁移时必须尊重，不能假装三入口同构）：

- Host `dal/CMakeLists.txt`：`_wink_dal_enable` 向 `dal` 挂 `.c` **与** `.h`（IDE 索引）；SSD1306 另挂 `font_internal.h`。
- 共享 `wink_dal_drivers.cmake`：`_wink_dal_enable_one` **只**挂 `.c`。
- Binary SDK：预编译 `.a` 已含源码；消费者侧 **只** `target_compile_definitions`（含字体宏），**绝不**再 `target_sources` 字体 `.c`。

### 1.2 目标

1. **降门槛**：标准单 TU 外设新增时，不手改任何驱动列表 CMake / `ALL_WINK_USE_OPTIONS`。
2. **标准化**：固定步骤、脚手架、验收清单、与 unisim 的文档级对齐流程。
3. **SSOT 收敛**：驱动全集唯一事实来源 = `tools/codegen/drivers/*.py` registry。

### 1.3 非目标

- 不修改 unisim 仓代码；不做跨仓自动 `type` 集合 CI（可后续单独立项；本地可选校验见 §5.1.1）。
- 不强制每个外设带 Role / smoke sample app。
- 不引入独立 JSON driver manifest（与插件重复）。
- 不用 CMake `file(GLOB)` 直接扫 `.c` 作为驱动发现机制。
- 不把多 TU / 子选项（如 SSD1306 字体）塞进默认 happy path（走 `extra_cmake_*` 字段）。
- **不在本流程内处理 BAL 联调**：若新外设需要 BAL stub/算法绑定（如今日 motor/encoder 与 ADR-0037），走 BAL / 对应 ADR 流程；`new-dal` 只覆盖 DAL + codegen 插件。
- **不覆盖仿真观测面 / 新 Wasm import**：属仿真保真与桥接专题，不在本文主线。

### 1.4 方案比选（已采纳）

| 方案 | 结论 |
|------|------|
| A. 仅文档 + checklist，四处仍手改 | ❌ 漏改风险仍在 |
| **B. `drivers/` SSOT + `new-dal` + 标准流程 + unisim 文档对齐** | ✅ **采纳** |
| C. 独立 `dal_drivers.json` 为 SSOT | ❌ 与插件双写 |

脚手架命令名：**`wink.py new-dal`**（不用 `new-driver`，避免与 Linux/HAL「驱动」语义混淆；产物主路径是 DAL 整包）。

---

## 2. 目标态开发流程

### 2.1 成功标准

新人/AI 添加一个**标准外设**（单 TU、无特殊 CMake）时：

1. 不手改驱动列表 CMake / `ALL_WINK_USE_OPTIONS`。
2. 走完固定步骤即可 Host 编译 + codegen 冒烟。
3. 与 unisim 对接步骤文档清晰；`devices[].type` 两侧**字节级一致**。

### 2.2 嵌入式仓标准步骤

```text
0. 前置：定 type 名、category（必须已是 DriverCategory）、引脚语义、是否执行器、是否需 Role
1. wink.py new-dal <type> --category <cat> [--actuator] [--role ...]
      → 生成 dal/include|src + drivers/<type>.py（含 stub 骨架）
2. 填 DAL 实现（POD + named API；ADR-0001/0002/0004）
3. 填 codegen 插件（required_fields / render_* / 可选 role / 必要时 extra_cmake_*）
4. （可选）最小 wink-app.json 样例验证 codegen
5. 门禁：wink lint --pack drivers --pack layering --pack api
6. 构建：host 有 JSON 裁剪路径 +（至少一次）无 JSON 全开路径；多 TU 时再验 Binary SDK defs 路径
7. 文档：在 adding-peripheral-guide 验收清单打勾
```

### 2.3 仿真侧对应步骤（文档级，本仓不改代码）

```text
8. 在 unisim 按 ADDING_PERIPHERAL.md 加 Manifest/模型
9. 确认 devices[].type 与嵌入式 type 字节级一致
10. 联调：同源 wink-app.json 两侧都能识别该 type
11. （可选）list_drivers.py --json 与 unisim 已知 type 集交叉校验（§5.1.1）
```

### 2.4 数据流（目标态）

```text
wink.py new-dal
    │
    ├─► dal/include|src/<cat>/dal_<type>.{h,c}     # 手填实现
    └─► tools/codegen/drivers/<type>.py            # 手填插件 + 元数据
                │
                ▼
         DriverBase registry（自动扫描；无 type 的 helper 模块不注册）
                │
        ┌───────┴────────────────────────┐
        ▼                                ▼
 list_drivers.py                    app_codegen.py
   --cmake --mode=source|defs       known_types()/cmake_options()
        │                                │
        ▼                                ▼
 generated_drivers.cmake              app_options.cmake
   （仅数据 + 按 mode 的 extra 片段）
        │
        ├─ Host dal/：set(WINK_DAL_TARGET dal) 后迭代数据，自调 _wink_dal_enable
        ├─ wink_dal_drivers.cmake：迭代数据，自调 _wink_dal_enable_one（--mode=source）
        └─ binary_sdk_cmake：迭代 WINK_KNOWN_DRIVERS 只打 defs（--mode=defs）
```

---

## 3. SSOT 与 CMake 生成

### 3.1 单一事实来源

**SSOT = `wink-tools/tools/codegen/drivers/*.py`**（既有 `__init_subclass__` → `_REGISTRY`）。

下列位置**禁止再手写驱动全集枚举**（迁移完成后）：

- `dal/CMakeLists.txt` 中的 `option()` / `_wink_dal_enable()` 块
- `cmake/wink_dal_drivers.cmake` 中的驱动表注释、全开 `foreach`、逐驱动 `_wink_dal_enable_one`
- `tools/binary_sdk_cmake/CMakeLists.txt` 中的内联驱动名列表
- `app_codegen.py` 中的 `ALL_WINK_USE_OPTIONS` 字面量列表

**Helper 模块**：`drivers/advanced.py` 等**不**子类化 `DriverBase`（无 `type`）的模块可被 import，但**不进入** `_REGISTRY`；`--check` / `--json` / `--cmake` 均忽略它们。扫描排除表维持现状：`base.py`、`__init__.py`（其余无 `type` 的模块安全 no-op）。

### 3.2 `DriverBase` 元数据扩展

```python
class DriverCategory(str, Enum):
    OUTPUT = "output"
    INPUT = "input"
    ACTUATOR = "actuator"
    SENSOR = "sensor"
    DISPLAY = "display"
    COMMUNICATION = "communication"
    STORAGE = "storage"


class DriverBase:
    type: str = ""
    category: DriverCategory | str = ""   # → dal/src/<cat>/；见 DriverCategory
    source_stem: str = ""    # 默认 == type；源文件 dal_<stem>.c
    # 多 TU / 子选项：拆成 sources 与 defs，供不同 CMake 消费者分流（§3.2.1）
    extra_cmake_sources: str = ""  # 仅 --mode=source：target_sources 等
    extra_cmake_defs: str = ""     # --mode=source 与 --mode=defs 均注入：CACHE / compile defs
    # 既有：is_actuator, required_fields, cmake_options(), Role hooks, ...
```

**约束**

- `category` 对已注册插件**必填**，且必须落在 `DriverCategory` 枚举集合内（迁移时补齐九个现有插件）。
- `source_stem` 为空则等于 `type`。
- 路径约定：`dal/src/<category>/dal_<stem>.c` 与 `dal/include/<category>/dal_<stem>.h`。
- `extra_cmake_*` 仅来自仓内插件字符串；configure 期按 mode 注入（不接受外部用户输入）。见 §3.2.1。
- **`new-dal` 不得发明枚举外 category / 目录**（`--category` 只能是 `DriverCategory` 成员）。

**扩展 `DriverCategory`（非 happy path）**

今日 Host `dal/CMakeLists.txt` 将 `target_include_directories` **按 category 写死**（`include/input` … `include/storage`）。若将来向枚举**新增**一类：

1. 增加 `DriverCategory` 成员；
2. 同步更新 Host（及任何写死 include 路径的入口）的 `target_include_directories`；
3. 创建对应 `dal/include|<src>/<new_cat>/` 目录约定；
4. 回写活规范与操作指南。

仅用 `new-dal` **不能**完成枚举扩展。

**校验时机（fail-fast 分层）**

| 时机 | 校验项 | 手段 |
|------|--------|------|
| 插件定义期（import） | `type` 非空、`category` 属 `DriverCategory` 枚举 | `DriverBase.__init_subclass__` 直接 `raise`（最早失败，误填即报） |
| `list_drivers.py --check` | 插件 ↔ `.c/.h` 落盘一致、无孤立源、`source_stem` 路径存在 | `wink lint --pack drivers`（见 §5.1） |

> 现状 `__init_subclass__` 仅做 `_REGISTRY[cls.type] = cls()` 注册（`drivers/__init__.py`），本设计在其中**增加**枚举校验；因迁移期九插件先补齐 `category`，故不会破坏既有注册。

#### 3.2.1 `extra_cmake_sources` / `extra_cmake_defs` 注入契约

**为何拆分**：Binary SDK 消费者路径只需要 compile definitions（字体宏等）；若把 `target_sources(字体.c)` 写进统一片段并让 Binary 入口执行，会错误地尝试向 App target 再编一份已在 `.a` 内的源，或产生无效/危险行为。Host / ESP32 / Wasm **源码构建**才需要 `target_sources`。

| 字段 | `--mode=source`（Host / `wink_dal_drivers`） | `--mode=defs`（Binary SDK） |
|------|-----------------------------------------------|------------------------------|
| `extra_cmake_defs` | 注入 | 注入 |
| `extra_cmake_sources` | 注入 | **不注入** |

生成器对非空字段按下述模板包裹（defs / sources 各自一段）：

```cmake
if(WINK_USE_<TYPE>)
  # ── extra_cmake_defs from drivers/<type>.py (自动生成，勿手改) ──
  <extra_cmake_defs 原样内容>
endif()

# 仅 --mode=source 时再输出：
if(WINK_USE_<TYPE>)
  # ── extra_cmake_sources from drivers/<type>.py (自动生成，勿手改) ──
  <extra_cmake_sources 原样内容>
endif()
```

以 SSD1306 迁移为参照（现状散落在 `dal/CMakeLists.txt:99-118` 与 `cmake/wink_dal_drivers.cmake:91-108`，且 Binary SDK 另有 defs-only 分支），迁入后字段拆分为：

**`extra_cmake_defs`（三入口都要）：**

```cmake
set(WINK_SSD1306_FONT "ascii_upper" CACHE STRING
    "SSD1306 5x7 font: minimal | ascii_upper")
if(WINK_SSD1306_FONT STREQUAL "minimal")
  target_compile_definitions(${WINK_DAL_TARGET} PUBLIC WINK_SSD1306_FONT_MINIMAL=1)
elseif(WINK_SSD1306_FONT STREQUAL "ascii_upper")
  target_compile_definitions(${WINK_DAL_TARGET} PUBLIC WINK_SSD1306_FONT_ASCII_UPPER=1)
else()
  message(FATAL_ERROR "WINK_SSD1306_FONT must be 'minimal' or 'ascii_upper'")
endif()
```

**`extra_cmake_sources`（仅源码构建）：**

```cmake
if(WINK_SSD1306_FONT STREQUAL "minimal")
  target_sources(${WINK_DAL_TARGET} PRIVATE
      ${WINK_MICRO_OS_ROOT}/dal/src/display/dal_ssd1306_font_5x7_minimal.c)
elseif(WINK_SSD1306_FONT STREQUAL "ascii_upper")
  target_sources(${WINK_DAL_TARGET} PRIVATE
      ${WINK_MICRO_OS_ROOT}/dal/src/display/dal_ssd1306_font_5x7_ascii_upper.c)
endif()
```

> Binary SDK 入口在 `--mode=defs` 下仍须 `set(WINK_DAL_TARGET <app_or_interface_target>)`（或等价），以便 `extra_cmake_defs` 内的 `target_compile_definitions(${WINK_DAL_TARGET} ...)` 落到正确 target；**不得**在 defs 模式执行 `target_sources`。

**约束**

- 片段内引用目标统一用 `${WINK_DAL_TARGET}`（各入口 `include` 前先 `set`）。
- 片段不得含驱动全集枚举或 `option(WINK_USE_*)`（那些由生成器统一发出到**数据区**）。
- `new-dal` **不生成** `extra_cmake_*`（§4.5）；高级多 TU 外设由作者手写这两个字段。
- Host 若仍需为 IDE 挂 `font_internal.h` 等非编译单元，可留在 Host 入口的固定少量特例，或写入 `extra_cmake_sources`；**不以跨文件字节相同**作为 golden 标准（见 §3.5）。

### 3.3 `list_drivers.py`：数据驱动生成（禁止替入口调用 enable）

| 模式 | 产出 | 消费者 |
|------|------|--------|
| `--cmake --mode=source` | `generated_drivers.cmake`：数据表 + defs + sources extras | Host `dal/`、`wink_dal_drivers.cmake`（ESP32/Wasm 源码构建） |
| `--cmake --mode=defs` | 同结构但**省略** `extra_cmake_sources` 段 | Binary SDK |
| `--json` | 结构化驱动清单（stdout） | CI、IDE、unisim 本地交叉校验（§5.1.1） |
| `--check` | 一致性门禁（见 §5） | `wink lint --pack drivers` |
| 运行时 API | `known_types()` / 聚合 `cmake_options()` | `app_codegen.py` 动态读取，删除硬编码列表 |

**生成文件形态（硬性约定）——只产出数据 + extra 片段，不调用入口专用 helper：**

```cmake
# 自动生成 — 勿手改；改动请编辑 tools/codegen/drivers/<name>.py
set(WINK_KNOWN_DRIVERS LED BUTTON SERVO SSD1306 ULTRASONIC GPS EEPROM MOTOR ENCODER)

# 每驱动元数据（名称示例；实施期可定为 list/dict 风格，但语义如下）
set(WINK_DAL_LED_CATEGORY output)
set(WINK_DAL_LED_STEM led)
set(WINK_DAL_LED_REL_SRC dal/src/output/dal_led.c)
# … 每个 type 一组 …

option(WINK_USE_LED "Enable DAL LED driver" ON)
# … 每个 type 一个 option …

# 然后按 mode 注入各驱动的 if(WINK_USE_*) extra_* 块
```

**各入口自行迭代**（生成器**不**发出 `_wink_dal_enable` / `_wink_dal_enable_one` 调用）：

| 入口 | 行为 |
|------|------|
| Host `dal/CMakeLists.txt` | `foreach` `WINK_KNOWN_DRIVERS` → 调本地 `_wink_dal_enable`（继续挂 `.h`+.c，保留 IDE 体验） |
| `wink_dal_drivers.cmake` | `foreach` → `_wink_dal_enable_one(${target} … ${WINK_DAL_<T>_REL_SRC})`；无 JSON 全开循环也迭代同一列表 |
| Binary SDK | `foreach` → 仅 `target_compile_definitions`；再 `include` defs 模式生成的 extra_defs |

这样一份 SSOT 适配两套既有 enable API，且 Binary 不会误执行 `target_sources`。

`--json` 输出形态（供机器消费，避免解析生成的 CMake）：

```json
[
  {"type": "servo", "category": "actuator", "source_stem": "servo",
   "is_actuator": true, "has_extra_cmake_sources": false, "has_extra_cmake_defs": false},
  {"type": "ssd1306", "category": "display", "source_stem": "ssd1306",
   "is_actuator": false, "has_extra_cmake_sources": true, "has_extra_cmake_defs": true}
]
```

生成文件头部必须标明「自动生成 — 勿手改；改动请编辑 `tools/codegen/drivers/<name>.py`」。

### 3.4 CMake 接入时机

在 **configure** 阶段（非 build）。源码构建入口示例：

```cmake
execute_process(
  COMMAND ${Python3_EXECUTABLE}
    ${WINK_MICRO_OS_ROOT}/tools/codegen/list_drivers.py
    --cmake --mode=source
  OUTPUT_FILE ${CMAKE_BINARY_DIR}/generated_drivers.cmake
  RESULT_VARIABLE _rc)
if(NOT _rc EQUAL 0)
  message(FATAL_ERROR "list_drivers.py failed (rc=${_rc})")
endif()
set(WINK_DAL_TARGET <this_entry_target>)  # Host: dal；共享模块: 调用方传入的 target 名
include(${CMAKE_BINARY_DIR}/generated_drivers.cmake)
# 随后 foreach(WINK_KNOWN_DRIVERS) 调用本入口 helper …

file(GLOB _driver_plugins CONFIGURE_DEPENDS
     ${WINK_MICRO_OS_ROOT}/tools/codegen/drivers/*.py)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_driver_plugins})
```

Binary SDK 将 `--mode=source` 换为 `--mode=defs`，`WINK_DAL_TARGET` 设为需要吃到 `WINK_USE_*` / 字体宏的 App（或 INTERFACE）target。

与现有 `app_codegen` configure 期调用一致，可接受对 Python3 的依赖。

### 3.5 迁移策略

1. **Golden（行为等价，非跨文件字节相同）**：对每个入口分别断言迁移后与迁移前的**可观察行为**一致——哪些 `WINK_USE_*` 存在、哪些 `.c` 进入对应 library、Binary 侧有哪些 compile definitions、无 JSON 时全开 + WARNING。不要求 Host 与共享模块生成/手写片段字节级一致（Host 多挂 `.h` / 偶发 `font_internal.h` 是既有差异）。
2. **替换**：各入口改为 `include` 生成数据文件 + 本地 `foreach`；删除过时 ASCII 驱动表注释与手写 SSD1306 双份分支。
3. **ADR**：延伸 ADR-0039 — 驱动全集 SSOT 从「CMake 表 + ADR 冻结九名枚举」改为「`drivers/` registry」；增删驱动**不再**改 ADR 正文枚举列表，改为改契约描述并回写活规范。
4. **现有九插件**：补齐 `category`；SSD1306 字体逻辑拆入 `extra_cmake_defs` + `extra_cmake_sources`。

### 3.6 被否决的替代方案

- ❌ CMake `file(GLOB)` 扫 `.c`：丢 category/option 元数据；难表达子选项。
- ❌ 独立 JSON manifest：与 `drivers/*.py` 重复。
- ❌ Build 期再发现驱动：configure 前必须已知全集。
- ❌ 单一 `extra_cmake` 无 mode 分流：Binary SDK 会误执行 `target_sources`。
- ❌ 生成器直接调用 `_wink_dal_enable*`：无法同时服务 Host / 共享两套 API，且绑定入口实现细节。

---

## 4. `wink.py new-dal` 脚手架契约

### 4.1 CLI 形态

```text
python wink-tools/wink.py new-dal <type> \
  --category <input|output|actuator|sensor|display|communication|storage> \
  [--actuator] \
  [--role <role_name>] \
  [--pin-field <name>]... \
  [--force]
```

| 参数 | 规则 |
|------|------|
| `<type>` | 小写蛇形；与 JSON `devices[].type`、插件 `type`、unisim Manifest **同一字符串** |
| `--category` | 必填；必须是既有 `DriverCategory` 成员；决定 `dal/include\|src/<cat>/`；**禁止**枚举外新目录 |
| `--actuator` | 插件 `is_actuator=True`；头文件预留 `off` / `safe_off` 声明骨架 |
| `--role` | 可选；生成 `default_role` + 空 `render_role_wrapper` 桩 |
| `--pin-field` | 可重复；未指定时骨架默认 `gpio_pin`（实现期可按类别给更贴切默认，文档须说明可改） |
| `--force` | 覆盖已存在文件；默认冲突则非零退出 |

### 4.2 一次命令生成的文件

| 文件 | 内容要点 |
|------|----------|
| `dal/include/<cat>/dal_<type>.h` | `config_t` / `*_t` POD、`init`/`deinit`、底部裁剪 stub + `WINK_UNAVAILABLE_MSG` |
| `dal/src/<cat>/dal_<type>.c` | `init` 骨架：`pal_resource_claim` + `goto err_release` 注释锚点；`WINK_TRY` 风格 |
| `tools/codegen/drivers/<type>.py` | `DriverBase` 子类：`type`/`category`/`required_fields`；`render_*` 待填桩函数 |

**不生成**：CMake 列表、`ALL_WINK_USE_OPTIONS`、`extra_cmake_*`、unisim 文件、完整业务逻辑、sample app、BAL 代码。

### 4.3 成功/失败行为

**成功**：stdout 打印下一步 checklist（填实现 → `lint --pack drivers` → host build → unisim 对齐），并提示 re-configure 后新驱动自动进入 `WINK_KNOWN_DRIVERS`。

**失败**：

- `type` 非法或已与 registry / 路径冲突（无 `--force`）
- `category` 不在 `DriverCategory` 允许集合
- 目标路径已存在且无 `--force`

### 4.4 实现落点

- 子命令名：`new-dal`（与现有 `gen` / `lint` / `build` 并列注册；`tools/cli/registry.py` 处新增 `_new_dal_factory`）
- 实现：`tools/cli/commands/new_dal.py`（参考 `gen.py` 的 `CommandBase` 子类模式）
- 模板：`tools/cli/templates/dal/`（或等价目录）
- 模板引擎：**复用 Jinja2**（与 `app_codegen.py` 的 `OUTPUT_FILES` 模板栈一致，避免维护两套字符串生成机制）
- **单测（P1）**：对脚手架做 dry-run / 临时目录生成树快照测试（路径、插件字段、stub 块存在性），防止模板回归。

### 4.5 脚手架非目标

- 不提供交互式向导（可后续增强）。
- 不自动创建 sample app、不自动跑构建。
- 不生成 `extra_cmake_*` 多 TU 逻辑（高级外设由作者手写插件字段）。
- 不生成 / 不修改 BAL 层（见 §1.3）。
- 不扩展 `DriverCategory` 枚举或 Host include 路径列表。

---

## 5. 门禁与验收

### 5.1 自动化门禁（嵌入式仓）

| 门禁 | 作用 |
|------|------|
| `wink lint --pack drivers`（即 `list_drivers.py --check`） | 每个 registry 插件 ↔ 存在对应 `dal_<stem>.c/.h`；无孤立 `.c`（无插件）；`category` 非空且属枚举；忽略无 `type` 的 helper 模块 |
| `wink lint --pack layering --pack api` | App/BAL/DAL/PAL 边界与 API 形态（ADR-0043） |
| Codegen / 单元测试 | 既有插件与 golden 不回归；迁移期按入口做**行为等价**断言（§3.5）；P1 含 `new-dal` 生成树快照测 |
| 三 target 冒烟 | Host / ESP32 configure+build（`--mode=source`）；Binary SDK configure（`--mode=defs`）能正确吃到 defs / 字体宏 |
| 跨仓 type 一致性**本地校验（可选）** | `list_drivers.py --json` 与 unisim 已知 type 集合交叉（见 §5.1.1）；**不**进强制 CI |

#### 5.1.1 跨仓 type 一致性本地校验（可选增强；P1 后追加）

虽不强制跨仓自动 CI，但提供本地单步校验：

```text
list_drivers.py --json | python -c "
import json, sys
drivers = json.load(sys.stdin)
# 读取 unisim 侧已知 type 集（来源：ADDING_PERIPHERAL.md 列表或 manifests/ JSON）
# 报告嵌入式有、仿真无的 type → 联调前发现
"
```

- 嵌入式侧：`list_drivers.py --json` 输出所有已注册 `type`。
- 仿真侧依赖：unisim 仓 `ADDING_PERIPHERAL.md` 维护一个已知 type 清单（或 `manifests/` 目录文件）。本设计不要求 unisim 改代码，仅在操作指南 `adding-peripheral-guide.md` 中描述此交叉校验步骤，并建议实施期 PowerShell / bash 脚本化。
- 不纳入 CI 强制门禁（与 §1.3「不修改 unisim 仓代码」一致）。

### 5.2 人工验收清单（写入操作指南）

- [ ] `new-dal` 产物路径与命名正确
- [ ] 有 JSON：仅声明驱动 `WINK_USE_*=ON`；无 JSON：全开 + ADR-0039 WARNING
- [ ] 执行器：safe-off thunk 已注册（若 `--actuator`）
- [ ] `type` 与 unisim Manifest 一致（§2.3 步骤 8–10）
- [ ] 多 TU 外设：`extra_cmake_defs` / `extra_cmake_sources` 已填；源码构建能编入附加 `.c`；Binary SDK **仅** defs 正确、无错误 `target_sources`
- [ ] （若适用）未误入 BAL；BAL 需求已单独立项

### 5.3 风险与缓解

| 风险 | 缓解 |
|------|------|
| configure 依赖 Python | 与现有 `app_codegen` 一致；失败则 `FATAL_ERROR` |
| `extra_cmake_*` 注入 | 仅信任仓内插件；`--mode` 分流防止 Binary 误加源 |
| 生成器绑定入口 helper | **禁止**；只发数据，入口自迭代（§3.3） |
| 文档与实现漂移 | 指南以「目标态」为主；迁移完成前用现状/目标对照表标注；指南必含章节见 §6.1 |
| 漏迁 Binary SDK | 验收强制三入口；`--mode=defs` 冒烟 + `--check` |
| 扩展 category 漏改 include | §3.2 扩展清单；`new-dal` 拒绝枚举外值 |

---

## 6. 文档产物与分期

### 6.1 文档落点

| 文档 | 层级 | 说明 |
|------|------|------|
| **本文** `tech-designs/2026-07-27-peripheral-onboarding-optimization-design.md` | ② | 目标流程 + SSOT + `new-dal` + 门禁 |
| **后续 ADR**（实施前 Proposed → Accepted） | ⑤ | 延伸 ADR-0039：驱动全集 SSOT = `drivers/`；Accepted 后回写 DAL / codegen 活规范 |
| **操作指南** `wink-micro-os/docs/adding-peripheral-guide.md` | 开发者手册 | 见下方**必含章节**；链到 unisim `ADDING_PERIPHERAL.md` |
| **实施计划**（本文批准后） | ③ | P0/P1/P2 可执行任务拆分 |

**操作指南必含章节（P2 验收用；本设计不展开细节）：**

1. 架构与 SSOT 数据流（链到本文）
2. `wink.py new-dal` 用法与参数
3. DAL 实现约定：`*_pin` 命名、`pal_resource_claim` / `goto err_release`、非阻塞（`WINK_ASSERT_NONBLOCKING`）、POD + named API
4. Codegen 插件：`required_fields`、`render_*`、Role、执行器 `get_safe_off_fn` / safe-off
5. `advanced.*` 渐进式披露（ADR-0034）；禁止 top-level alias 双写
6. I2C / 引脚冲突 / `board` / `$board.` / `use_onboard` 联动注意点
7. 多 TU：`extra_cmake_defs` vs `extra_cmake_sources` 与 `--mode`
8. 门禁命令与人工验收清单
9. unisim 对齐步骤 8–11 + 可选 `--json` 交叉校验
10. **显式边界**：BAL 联调、扩展 `DriverCategory`、仿真观测 / Wasm import 不在本指南 happy path

### 6.2 实施分期（设计约定；非本文执行）

| 阶段 | 内容 |
|------|------|
| **P0** | ADR + `list_drivers.py`（含 `--mode`）+ 数据驱动 CMake/Binary SDK/`ALL_WINK_USE_OPTIONS` 迁移（**行为等价** golden） |
| **P1** | `wink.py new-dal`（含生成树单测）+ `wink lint --pack drivers` |
| **P2** | `adding-peripheral-guide.md`（含 §6.1 必含章节）+ 活规范回写 + unisim 文档交叉链接 |

建议执行顺序：**P0 → P1 → P2**。若需更快降认知成本，可在 P0 并行起草指南中的「现状对照表」，但指南验收以目标态为准。

### 6.3 遵守的既有决策（实施时）

- ADR-0001：负数错误码 / `wink_status_t`
- ADR-0002：双 target 同源编译
- ADR-0004：编译期静态分发（POD + named API）
- ADR-0034：`advanced.*` 渐进式披露
- ADR-0037 / ADR-0038：BAL 边界（本流程不替代）
- ADR-0039：DAL 双模自动裁剪（本设计延伸其 SSOT 形态）
- ADR-0043：`wink lint` 分层门禁

---

## 7. 目标态 vs 现状对照（迁移期）

| 维度 | 现状 | 目标态 |
|------|------|--------|
| 驱动全集 SSOT | 4 处手写列表 | `drivers/*.py` registry |
| 新增标准外设编辑点 | 5–7 处 | DAL `.h/.c` + 插件（CMake/options 自动） |
| 脚手架 | 无 | `wink.py new-dal`（Jinja2 模板 + 生成树单测） |
| CMake 生成物 | 手写 enable 调用散落三入口 | **仅数据表** + 入口自迭代；`--mode=source\|defs` |
| 多 TU / 字体 | SSD1306 逻辑双写于 Host 与共享 CMake；Binary 另写 defs | `extra_cmake_defs` + `extra_cmake_sources` 单源；Binary 只吃 defs |
| CLI 驱动查询 | 无 | `list_drivers.py --json` 供 CI/IDE / 本地跨仓校验 |
| 嵌入式操作指南 | 无对等文档 | `adding-peripheral-guide.md`（§6.1 必含章节） |
| unisim 对齐 | 口头/分散 | 指南步骤 8–11 + 可选 `--json` 交叉校验（非强制 CI） |
| BAL / 观测面 | 与 DAL 流程纠缠不清 | 明确划出非目标与指南边界章节 |

---

## 8. 开放项（实施计划阶段关闭）

1. ~~`list_drivers --check` 是独立命令还是并入某个 lint pack~~ → **已关闭**：直接注册为 `wink lint --pack drivers`（见 §5.1）。
2. 生成文件落盘路径：仅 `${CMAKE_BINARY_DIR}/` 或额外提交一份 source-tree 镜像供无 Python 场景（默认：**仅 build 目录**，与「configure 必有 Python」一致）。
3. ADR 编号在 Proposed 时分配（当前最新已用到 ADR-0045 一带，实施前按 `list_adrs.py` 取下一号）。
4. ~~`${WINK_DAL_TARGET}` 与 Binary 能否共用同一 `extra_cmake`~~ → **已关闭（设计层）**：拆分为 `extra_cmake_defs` / `extra_cmake_sources`，并用 `--mode=source|defs` 分流；实施计划只需落实三入口 `set(WINK_DAL_TARGET …)` 与两次 `execute_process` 的具体变量名。
5. ~~生成器是否直接调用 `_wink_dal_enable*`~~ → **已关闭**：只产出数据，入口自迭代（§3.3）。
6. 元数据 CMake 变量命名细节（`WINK_DAL_<TYPE>_CATEGORY` vs list-of-structs 风格）——实施计划选定一种，golden 锁定。

---

*本设计经方案比选、分章确认与完整度补强（流程标准化 + SSOT 收敛 + 数据驱动 CMake + source/defs 分流 + `new-dal` + unisim 文档对齐）。批准后进入 ADR + 实施计划。*

