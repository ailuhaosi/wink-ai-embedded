# Codegen 扩展根外置与可扫描描述 — 技术设计评审记录

| 项 | 内容 |
|---|---|
| **评审日期** | 2026-07-29 |
| **评审范围** | 技术设计 [2026-07-28-scannable-codegen-extension-roots-design.md](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md)（草案） |
| **关联 ADR** | [ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)（Proposed）；演进 ADR-0046 |
| **评审人** | 资深嵌入式专家（Claude Code 自检） |
| **对照现网** | `wink-tools/tools/codegen/drivers/base.py`、`ultrasonic.py`、`app_codegen.py` |
| **结论** | 方向正确；#1 / #2 须在 P1 前上升为引擎级前置条件（建议写入 ADR-0051 再 Accepted）；#4 覆盖优先级需立即确认 |
| **处置（2026-07-29）** | **已落地**：tech-design 定稿回写 #1–#11；ADR-0051 **Accepted**；扫描顺序改为 `内置 → OS → env → App`；活规范与手册已链目标态 |

---

## 0. 处置对照

| # | 处置 |
|---|------|
| 1 | 升入 ADR-0051 §决策 6 + tech-design §1.4：P1 强制 `SandboxedEnvironment` |
| 2 | 升入 ADR-0051 §决策 6 + tech-design §1.4 / §3.4：`CMAKE_CONFIGURE_DEPENDS`；hash 仅对账 |
| 3 | tech-design §3.4：构建真值 = CMake cache |
| 4 | tech-design §3.2：`内置 → OS → env → App` |
| 5–11 | 已回写 tech-design 对应 Schema / lint / 迁移 / 风险章节 |

---

## 1. 总体评价

- **方向正确**：「引擎 / 描述分离 + 零改 tools 加外设」符合 `wink-tools` 闭源诉求。
- **最扎实处**：§4.1 `DriverBase`→YAML 映射表与分阶段迁移（P0–P4）；对照现网 `base.py` / `ultrasonic.py` 属实、可作 P1 golden 检查清单。
- **主要问题**：安全（Jinja 沙箱）与构建正确性（configure 依赖）两项被降级为「风险表一行」，与其权重不符；覆盖优先级方向存疑。

---

## 2. 关键技术缺口

### #1 Jinja 沙箱是引擎改动，不是配置约束 —— MVP 安全承诺的漏洞（高危）

- 现网 `app_codegen.py:40` 使用普通 `Environment(..., StrictUndefined)`，**非** `SandboxedEnvironment`。普通 Environment 允许属性访问，`{{ ''.__class__.__mro__[1].__subclasses__() }}` 类载荷即可在构建期 RCE。
- §10 裁定「MVP 禁 Python hooks」用于收敛构建期任意代码执行，但**只要扫描外部扩展根 + 用非沙箱 Jinja 渲染其模板，构建期 RCE 面已存在**——禁不禁 hooks 无关紧要。
- §4.4 / §7 把「禁 `|attr`、禁 import」写成 schema 约束，实则**必须落到引擎**：切换 `jinja2.sandbox.SandboxedEnvironment` + 显式 context 白名单。
- **建议**：从风险表提升为 **P1 强制引擎前置条件**；注明 SandboxedEnvironment 亦有历史逃逸 CVE，需固定 jinja2 最低版本。

### #2 「改 YAML 未重跑」应由 CMake configure 依赖解决，而非事后指纹（高）

- §7 缓解为「`device_tree.h` 头注释带 hash」——只能生成**之后**供人排障，不触发重建。
- 正确做法：把解析出的扩展根 YAML 文件列表登记为 configure 依赖（`CMAKE_CONFIGURE_DEPENDS` / `configure_file`），编辑任一 YAML 自动重配。否则改描述后 `make` 静默用旧产物 —— 嵌入式构建典型「跑飞」来源。

### #3 `WINK_CODEGEN_PATHS` 纯环境变量污染构建可复现性（中高）

- CMake 不感知环境变量变化，不重配即用缓存值，多人 / CI 结果漂移。§3.4 已隐约提及。
- **建议**：环境变量仅作 CLI 便捷入口；构建真值走 CMake cache 变量（`-DWINK_CODEGEN_PATHS=...`），写入 `CMakeCache.txt`，天然纳入 reconfigure 触发与可复现记录。

---

## 3. 设计层面建议

### #4 覆盖优先级 App vs env 方向存疑（中）

- §3.2 顺序 `内置 → OS → App → env`，后者覆盖前者 ⇒ **env（板级/第三方包）会覆盖 App 私有描述**。
- 直觉上 App 最具体、最私有，应有最高优先级；当前顺序意味着第三方 board package 能悄悄盖掉应用自带 type。
- **建议**：复核是否应为 `内置 → env → OS → App`（App 最后 = 最高）；至少需在文档给出「为何 env 优先于 App」的理由。

### #5 大段 C 模板内嵌 YAML 的 DX / 可维护性差（中）

- `init_template` / verb 模板作 YAML 块标量：无语法高亮、无 clang-format、缩进转义易错；且 §8 golden「与旧行为等价」需与现 f-string（4 空格缩进）**逐字节**对齐，YAML 块标量缩进语义使之脆弱。
- **建议**：允许扩展根内相对路径的模板文件引用（`init_template_file: templates/ultrasonic_init.c.j2`），C 落 `.c.j2` 可 lint / format，且不违反 §4.4「禁加载根外路径」；明确 golden 空白规范化策略。

### #6 `constraints:` 求值时机未定义（中）

- 现网 `_validate_ultrasonic_spec` 在 `render_config_init`（`ultrasonic.py:98`）**和** `render_role_wrapper`（`:78`）两处调用。声明式 `constraints:` 须规定**何时运行**（spec 解析期一次？每 verb？）以复现同等报错点。
- 示例仅 `on_violation: error`；§4.4 承诺的「必填依赖（cross-field）」无语法示例。**建议**定稿前补 cross-field 与 `warn` 档 schema。

### #7 `error_class` 与 wrapper 签名一致性无强制（中）

- roles/*.yaml 的 `error_class`（fire_and_forget/convenience/normal/fatal）本应决定 wrapper 是否带 `WINK_WARN_UNUSED_RESULT` / 返回 `wink_status_t` 还是 void（对照 `ultrasonic.py`：`read_distance` 返回 float 无检查 vs `request_measurement` 带 WARN_UNUSED）。
- 但模板落在 `role_bindings.<role>.verbs.*.template` 是**自由 C 文本**，引擎不校验其与契约 `error_class` 是否匹配 ⇒ 退化为「契约一套、绑定另一套」。
- **建议**：lint 依 `error_class` 校验 wrapper 首行签名（`normal/fatal` 必须 `WINK_WARN_UNUSED_RESULT` + 返回 `wink_status_t`；`fire_and_forget` 必须返回 void），否则 §4.5 契约仅文档、不具约束力。

### #8 `config_type` 新增字段，映射表漏列（低中）

- §4.3 示例含 `config.config_type: dal_ultrasonic_config_t`，但 §4.1 映射表未列（现网无独立 accessor，config 结构体名硬编码在 f-string 内）。
- **建议**：补入映射表并标注「新增派生字段，取代模板内硬编码」，纳入 golden 等价核对。

### #9 `default_role` 无 `role_bindings` 时的生成路径未定义（低）

- 新模型拆成 `roles/*.yaml`（契约）+ `role_bindings`（实现）。§5.2 说「缺省 default_role」，但未说明：driver 声明 `default_role` 却**未提供** `role_bindings` 时，是 fail-closed 还是跳过 wrapper。
- **建议**：明确（倾向 fail-closed，避免「声明角色却无接口」）。

---

## 4. 流程 / 文档

### #10 §4.1「必填能力」与 MVP 可交付性自相矛盾（低）

- `constraints:` 标「**必填能力**；复杂校验暂留内置库存」。而 `_validate_ultrasonic_spec` 实则只是 int + min，完全可声明化；若仍留 Python 内置，则与 P3 退出标准「ultrasonic 全迁」打架。
- **建议**：将 ultrasonic 明确列为 **P1 声明式可迁样例**（恰落 §4.4 允许集内），用它验证 constraints 语法闭环。

### #11 缺回滚 / 降级路径（低）

- 迁移表 P1–P4 仅前进退出标准。闭源引擎 + 用户扩展根组合下，引擎收紧 schema 致存量 YAML 报错时，除「fail-closed 提示升级」外无降级门。
- **建议**：引擎支持读取并 warn 兼容前一主版本 schema 一个 release 窗口（与 §7 首行 changelog 联动）。

---

## 5. 处置建议（优先级）

| # | 主题 | 严重度 | 建议动作 |
|---|------|--------|---------|
| 1 | Jinja 沙箱（构建期 RCE） | 高危 | 升为 ADR-0051 显式约束 + P1 前置 |
| 2 | CMake configure 依赖 | 高 | P1 前置；替换「事后 hash」为触发式重配 |
| 3 | `WINK_CODEGEN_PATHS` 走 cache 变量 | 中高 | 文档 + 引擎入口调整 |
| 4 | 覆盖优先级 App vs env | 中 | 立即确认方向并回写 §3.2 |
| 5 | 模板外置文件引用 | 中 | schema 增 `*_template_file` |
| 6 | `constraints` 求值时机 / cross-field | 中 | 定稿前补语法 |
| 7 | `error_class` ↔ 签名 lint | 中 | 增 lint 规则 |
| 8–11 | config_type / default_role / 矛盾 / 回滚 | 低~中 | 定稿前补齐 |

> 建议 #1 / #2 写入 ADR-0051 后再进 Accepted；#4 需 Owner 拍板并回写技术设计 §3.2。

