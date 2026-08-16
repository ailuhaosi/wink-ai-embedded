# 新增外设流程优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> Domain skill: `embedded-best-practice`（DAL C 骨架须遵守；本计划以 Python/CMake/文档为主）。

**Goal:** 按 [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md) 与 [tech-design](../../tech-designs/tools/2026-07-27-peripheral-onboarding-optimization-design.md)，把驱动全集收敛到 `drivers/` registry，提供 `new-dal` 与操作指南，使标准外设新增不再手改 CMake/options 列表。

**Architecture:** `DriverBase` 自描述 → `list_drivers.py` 生成**数据型** CMake（`--mode=source|defs`）→ 三入口各自 `foreach`；`wink.py new-dal` 脚手架；`wink lint --pack drivers` 一致性门禁。

**Tech Stack:** Python 3、CMake、Jinja2、既有 `wink` CLI / lint、Host/ESP32/Binary SDK 构建。

## Global Constraints

- SSOT：`tools/codegen/drivers/*.py`；生成物禁止调用 `_wink_dal_enable*`。
- `extra_cmake_defs` / `extra_cmake_sources` 分流；Binary 仅 `--mode=defs`。
- ADR-0039 双模裁剪行为不变；迁移 golden = **行为等价**，非跨文件字节相同。
- `new-dal` 不生成 BAL / unisim / `extra_cmake_*`；`--category` 仅 `DriverCategory`。
- Commit message 英文、原子化；**用户未要求则不 commit / 不 push**。
- 遵守 ADR-0001/0002/0004/0034/0043/0046。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260727-PERIPH-ONBOARD` |
| **创建日期** | 2026-07-27 |
| **计划状态** | ✅ 已完成（2026-07-27） |
| **关联 ADR** | [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)（Proposed） |
| **关联设计** | [tech-designs/2026-07-27-peripheral-onboarding-optimization-design.md](../../tech-designs/tools/2026-07-27-peripheral-onboarding-optimization-design.md) |

---

## 2. 文件清单（先锁定）

| 文件 | 动作 | 阶段 |
|------|------|------|
| `docs/decisions/core/0046-dal-driver-registry-ssot.md` | 已建 Proposed | P0 |
| `tools/codegen/drivers/base.py` | 加 `DriverCategory`、`category`、`extra_cmake_*`、校验 | P0 |
| `tools/codegen/drivers/{led,button,...}.py` | 补 `category`；ssd1306 填 extras | P0 |
| `tools/codegen/list_drivers.py` | 新建 | P0 |
| `tools/codegen/tests/test_list_drivers.py` | 新建：cmake/json/check + 行为断言 | P0 |
| `dal/CMakeLists.txt` | 数据 include + foreach | P0 |
| `cmake/wink_dal_drivers.cmake` | 同上；删手写表 | P0 |
| `tools/binary_sdk_cmake/CMakeLists.txt` | `--mode=defs` | P0 |
| `tools/codegen/app_codegen.py` | 动态 options | P0 |
| `tools/cli/commands/new_dal.py` + templates | 新建 | P1 |
| `tools/cli/registry.py` | 注册 `new-dal` | P1 |
| `tools/tests/test_new_dal.py` | 生成树快照 | P1 |
| `tools/lint/packs/drivers.py` + runner 挂载 | `--pack drivers` | P1 |
| `wink-micro-os/docs/adding-peripheral-guide.md` | 新建 | P2 |
| 活规范 DAL / codegen | 回写；ADR Accepted | P2 |

---

### Task 0: Pre-flight

- [ ] 记录当前九驱动与 Host/共享/Binary 三入口现状（已在设计 §1.1 核实）。
- [ ] 跑 codegen 相关测试基线：`python -m pytest wink-micro-os/tools/codegen/tests -q`（记下 PASS 数）。

---

### Task 1 (P0): `DriverBase` 元数据 + 九插件补齐

**Files:** `drivers/base.py`；九个 `drivers/*.py`（除 `advanced.py`）。

**Produces:**
- `DriverCategory` enum
- `category: DriverCategory | str`（必填）
- `source_stem: str = ""`
- `extra_cmake_defs: str = ""` / `extra_cmake_sources: str = ""`
- `__init_subclass__`：`type` 非空时校验 `category` 属枚举，否则 `raise TypeError`

- [ ] 实现 base 字段与校验。
- [ ] 九插件设 `category=DriverCategory....`（led→OUTPUT，button→INPUT，servo/motor→ACTUATOR，ssd1306→DISPLAY，ultrasonic/encoder→SENSOR，gps→COMMUNICATION，eeprom→STORAGE）。
- [ ] `ssd1306.py`：按设计 §3.2.1 填入 `extra_cmake_defs` / `extra_cmake_sources` 字符串（使用 `${WINK_DAL_TARGET}` / `${WINK_MICRO_OS_ROOT}`）。
- [ ] 验证：`python -c "from tools.codegen.drivers import known_types; print(known_types())"` 仍打印九 type。

---

### Task 2 (P0): `list_drivers.py` + 单元测试

**Files:**
- Create: `wink-micro-os/tools/codegen/list_drivers.py`
- Create: `wink-micro-os/tools/codegen/tests/test_list_drivers.py`

**CLI:**
```text
list_drivers.py --cmake --mode=source|defs   # stdout cmake
list_drivers.py --json
list_drivers.py --check                      # exit 0/1
```

**CMake 数据区必须包含：**
- `set(WINK_KNOWN_DRIVERS ...)`（大写 TYPE 名，空格分隔）
- 每驱动 `WINK_DAL_<TYPE>_CATEGORY` / `_STEM` / `_REL_SRC`
- 每驱动 `option(WINK_USE_<TYPE> ... ON)`
- 按 mode 包裹的 `extra_cmake_*`（见设计）

**Check 规则：** registry 每项存在 `dal/include|src/<cat>/dal_<stem>.{h,c}`；`dal/src/**/dal_*.c` 无对应插件则失败（可允许 font 等非主 stem 文件：仅检查 `dal_<stem>.c` 主文件，或排除 `*_font_*` / `*_internal*`）。

- [ ] 实现 generator + check。
- [ ] 测试：九驱动出现在 cmake/json；`mode=defs` 不含 font `target_sources`；`mode=source` 含；`--check` 对当前树 exit 0。
- [ ] 跑通 `pytest .../test_list_drivers.py -q`。

---

### Task 3 (P0): CMake 三入口迁移 + `ALL_WINK_USE_OPTIONS` 动态化

**Files:** `dal/CMakeLists.txt`；`cmake/wink_dal_drivers.cmake`；`tools/binary_sdk_cmake/CMakeLists.txt`；`app_codegen.py`。

**Host `dal/CMakeLists.txt`：**
- configure 期 `execute_process(list_drivers.py --cmake --mode=source → generated_drivers.cmake)`
- `set(WINK_DAL_TARGET dal)` 后 `include`
- 删除手写 `option`/`_wink_dal_enable` 块与 SSD1306 手写分支
- `foreach(WINK_KNOWN_DRIVERS)` 调既有 `_wink_dal_enable(WINK_USE_${d} WINK_USE_${d} ${WINK_DAL_${d}_CATEGORY} ${WINK_DAL_${d}_STEM})`
- 保留 `target_include_directories` 七类路径写死列表

**`wink_dal_drivers.cmake`：**
- 同样 generate+include（或要求调用方已 include）；无 JSON 全开改为 `foreach(WINK_KNOWN_DRIVERS)`
- `wink_dal_add_enabled_sources`：`foreach` + `_wink_dal_enable_one`；删除手写 SSD1306 字体块（改由 extra 注入）
- 调用前 `set(WINK_DAL_TARGET ${target})`（在 add_enabled_sources 内对传入 target set）

**Binary SDK：**
- `list_drivers.py --cmake --mode=defs`；`foreach` 打 defs；删除内联九名列表与手写字体 defs（由 extra_defs 提供）
- `set(WINK_DAL_TARGET ...)` 为 macro 作用的 target

**`app_codegen.py`：**
```python
def all_wink_use_options() -> list[str]:
    from tools.codegen.drivers import all_drivers  # or known_types
    ...
# 替换 ALL_WINK_USE_OPTIONS 字面量为运行时列表（保持排序稳定：按 type 名）
```

- [ ] 迁移三入口。
- [ ] 跑 codegen golden：`pytest wink-micro-os/tools/codegen/tests/test_golden.py -q`
- [ ] Host 冒烟：对某 sample configure/build（或项目惯用 `wink.py build host --app ...`）。
- [ ] 行为核对：有 JSON 裁剪 / 无 JSON 全开 WARNING 仍在。

---

### Task 4 (P1): `wink.py new-dal` + 单测

**Files:** `tools/cli/commands/new_dal.py`；`tools/cli/templates/dal/*`；`tools/cli/registry.py`；`tools/tests/test_new_dal.py`。

- [ ] 实现 CLI（设计 §4）。
- [ ] Jinja2 模板生成 `.h/.c/.py`。
- [ ] 注册子命令 `new-dal`。
- [ ] 临时目录快照测试。

---

### Task 5 (P1): `wink lint --pack drivers`

**Files:** `tools/lint/packs/drivers.py`；`tools/lint/engine/runner.py`（挂 pack）；可选薄 YAML。

- [ ] pack 内部调用 `list_drivers.check()` 或等价，产出 Finding。
- [ ] `wink.py lint --pack drivers` 对当前树绿。

---

### Task 6 (P2): 操作指南 + 活规范回写 + ADR Accepted

- [ ] 写 `wink-micro-os/docs/adding-peripheral-guide.md`（设计 §6.1 十章）。
- [ ] 回写 DAL / codegen 活规范；ADR-0046 → Accepted；勾选 ADR 回写清单。
- [ ] 更新 tech-design 状态为「已实施」。

---

## 3. 验收总表

| 项 | 标准 |
|----|------|
| 标准新增路径 | 只改 DAL `.h/.c` + 插件；CMake/options 零手改 |
| `--mode=defs` | 无 font `target_sources` |
| `--check` / `--pack drivers` | 当前九驱动绿 |
| ADR-0039 | 双模行为保持 |
| `new-dal` | 生成三文件 + 单测绿 |
| 指南 | 含必含章节 |

---

*执行顺序：Task 0 → 1 → 2 → 3 → 4 → 5 → 6。本会话从 Task 0/P0 开始。*

