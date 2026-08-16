# ADR-0043：YAML 驱动的分层边界 Lint（`wink lint`）

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-20 |
| 触发 | 架构评审：App/BAL/DAL/PAL 分层红线散落在 CMake 正则、独立 Python 脚本与文档中，AI/新人易漏检；需要可配置、可例外、可定位到 file:line 的统一门禁 |
| 影响范围 | `wink-micro-os/tools/lint/`；`wink.py lint` 子命令；`python wink-tools/wink.py test`；`bal/CMakeLists.txt` 中分层 grep 门禁迁出；活规范 `06-bal-layer.md` / `03-directory-architecture.md` / `tools/README.md` |
| 决策者 | 项目 Owner + 架构（wink-arch） |
| 关联 ADR | [ADR-0004](../core/0004-static-dispatch-vs-runtime-ops.md)、[ADR-0023](../core/0023-bal-business-abstraction-layer.md)、[ADR-0035](../core/0035-arduino-compat-polymorphism-sandbox.md)、[ADR-0038](../core/0038-bal-naming-hard-cut-and-layer-ssot.md) |
| 关联技术设计 | [2026-07-20-configurable-layer-lint-design.md](../../tech-designs/tools/2026-07-20-configurable-layer-lint-design.md) |
| 关联计划 | [2026-07-20-configurable-layer-lint-plan.md](../../implementation-plans/tools/2026-07-20-configurable-layer-lint-plan.md) |

---

## 背景（Context）

1. 分层红线已在设计规范与 ADR 中明确（BAL 公共头禁 `pal_*`、DAL 公共头不泄露 HAL、App 产品面不碰 PAL、禁止 ops/vtable、热路径禁 malloc 等）。
2. 执行侧碎片化：
   - `bal/CMakeLists.txt` configure-time `file(STRINGS … REGEX)`；
   - `tools/lint/check_*.py` 硬编码路径与正则；
   - `python wink-tools/wink.py test` 串行调用多脚本。
3. 例外（如 `wink_button_events_irq.c` 读 GPIO、smoke App 直调 PAL）无法以「带 reason/until 的一等公民」表达，易变成改脚本放行。
4. 需要：**规则可 diff、Finding 带 file:line、CI 单入口、与链接面 CMake 检查分工清晰**。

---

## 方案比选（Options）

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 维持分散脚本 + CMake | 继续加脚本 | 零设计成本 | 双源真相；例外难治理 | ❌ |
| B. clang-tidy / IWYU 真 include 图 | 编译图门禁 | 图准 | 工具链重；难表达 `.h` vs `.c` 分层；Windows CI 脆 | ❌ 本期 |
| C. 混合 YAML + 可选 Clang | YAML 为主，Clang 加深 | 长期最全 | v1 范围过大 | ❌ 本期（预留扩展） |
| **D. YAML 规则引擎 + `wink lint`** | 声明 layer/allow·deny/API；文本扫描；Finding=file:line | 与现有 tools 一致；规则可评审；例外可配置 | 不解析宏拼接 include | ✅ **采纳** |

---

## 决策（Decision）

1. **分层与 API 形态门禁的 SSOT** 为 `tools/lint/rules/*.yaml`；由统一引擎解释，经 **`wink lint`** 暴露。
2. **Finding 粒度**：每条违规报告 `path` + `line`（+ 可选 column）+ `rule_id` + `severity` + `message`；默认 text，可选 json/sarif。
3. **例外一等公民**：`allow_paths`（reason + 可选 until）；禁止为放行改引擎。带 `immutable: true` 的 SDK 规则禁止被 workspace `disable_rules` 关掉。
4. **与 CMake 分工**：include/命名/malloc/ops → lint；`INTERFACE_INCLUDE` / 链接目标 → 保留 CMake。迁出后删除 `bal/CMakeLists.txt` 中重复的分层 REGEX 门禁。
5. **v1 非目标**：autofix、完整 C 预处理器、clang 真 include 图。

---

## 后果（Consequences）

- **正**：架构红线可版本控、可 CI、可解释（`--explain RULE_ID`）；AI 生成代码有机械反馈。
- **负**：文本级扫描有假阴/假阳边界；需用 allowlist 与规则调优治理。
- **迁移**：现有 `check_arduino_*` 等先作 legacy pack 适配，再逐步 YAML 化。

---

## 合规（Compliance）

Accepted 后必须回写：

- [x] [`06-bal-layer.md`](../../design/02-wink-micro-os/06-bal-layer.md) — CI 门禁改为 `wink lint`
- [x] [`03-directory-architecture.md`](../../design/02-wink-micro-os/03-directory-architecture.md) — 分层检查入口
- [x] [`wink-micro-os/tools/README.md`](../../implementation-plans/scripts/README.md) — `wink lint` 用法
- [x] [`.claude/rules/c-code.md`](../../.claude/rules/c-code.md) / [`CLAUDE.md`](../../CLAUDE.md) — AI 自查提示

**Backlog：** Task 10b（`dal_motor.h` / `dal_encoder.h` 去除 `pal_hal.h`）因 `pal_gpio_mode_t` 抽取面较大而暂缓；`DAL-HDR-NO-HAL` 已升为 error，上述两头以 `allow_paths` + `until: 2026-12-31` 暂挂。

---

### 9.2 新增 `dal` pack（v3.4.x 扩展）

`wink-micro-os` 引入 `dal` pack 专门覆盖 [DAL API 一致性规范 §17.3](../../wink-micro-os/docs/dal-development-guide/dal-api-consistency-spec.md#173-规则-id-与-lint-集成) 的 80+ 条规则：
- 命名空间前缀 `dal.<snake_case>`；
- 8 个子模块（struct/quantity/yaml_parity/contract_doc/api_shape/lifecycle/concurrency/blocking）独立可测；
- pack 默认不进入 CI 阻断，需显式 `--pack dal` 启用；Owner sign-off 后可提升为默认 pack 阻断门禁。


