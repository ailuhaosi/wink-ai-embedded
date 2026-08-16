# 用户稳定面绝缘机制 — 技术设计

| 项 | 内容 |
|----|------|
| 创建日期 | 2026-07-28 |
| 状态 | **Wave 1 已交付** — Phase 1 出口验收通过（2026-07-29）；Wave 2/3 仍按 §5 排期 |
| 关联 ADR | [ADR-0004](../../decisions/core/0004-static-dispatch-vs-runtime-ops.md)（静态分发）；[ADR-0043](../../decisions/tools/0043-yaml-driven-layer-lint.md)（lint）；[ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)（`type` SSOT）；[ADR-0048](../../decisions/core/0048-actuator-control-semantic-naming.md)；[ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)（registry 描述可外置 YAML）；拟后续 ADR：user_surface / role 契约版本（Wave 3） |
| 关联实施计划 | [2026-07-28-user-surface-phase1-plan.md](../../implementation-plans/frontend/2026-07-28-user-surface-phase1-plan.md)（Phase 1 / Wave 1） |
| 关联设计规范 | [01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md) § Role；[01-dal-device-abstraction.md](../../design/02-wink-micro-os/01-dal-device-abstraction.md)；[03-ai-dsl-and-codegen-pipeline.md](../../design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md) |
| 关联手册 | [`role-interface-codegen.md`](../../../wink-micro-os/docs/dal-development-guide/role-interface-codegen.md)；[`dal-best-practices.md`](../../../wink-micro-os/docs/dal-development-guide/dal-best-practices.md) |
| 关联评审 | [2026-07-28-dal-control-semantic-completeness-review.md](../../reviews/core/2026-07-28-dal-control-semantic-completeness-review.md)（驱动面完备性；本设计护用户面） |
| 关联演进 | [2026-07-28-wink-app-role-intent-evolution-plan.md](../../implementation-plans/core/2026-07-28-wink-app-role-intent-evolution-plan.md)（⏸️；本设计 Wave 2 为其门禁前置） |
| 范围 | 用户稳定面定义、分波交付、Role 补齐、JSON 字段分级（文档/元数据）、lint pack、契约测试、与 Escape Hatch / BAL 边界 |
| 非范围 | 运行时 Role/vtable；用 Role 替代 BAL 闭环；删除或模板锁定 `type`/引脚；**板卡/器件模板合并机制（暂缓）**；完整意图平面产品语义 |

---

## 1. 背景与目标

### 1.1 问题

DAL / BAL / codegen 会持续演进。若 App 与低代码用户直接依赖 `dal_*` 符号或把接线细节当业务配置，下层改动会变成对用户的破坏性变更。

现网已有 **Role Interface**（`{name}_{verb}`），但：

- 部分 `type` 无 `default_role`（如 `dc_motor`、`encoder`）
- 缺少「用户稳定面 vs 驱动面」的强制门禁
- JSON 未区分 stable / advanced 字段
- 语义变化（单位、解码倍率）无法靠包装消除，也缺少契约测试纪律
- stub（`gps` / `eeprom`）已进 registry，易被当成可用稳定面

### 1.2 目标

在**尽量不影响顶层用户代码与简单配置**的前提下，建立可执行绝缘机制：

1. **App C 默认只依赖 Role 动词**；DAL 符号/签名变化由 codegen 重生成消化。  
2. **JSON 区分用户面与驱动面（文档 + 元数据分级）**；`type`/引脚等仍由**各 App 的 `wink-app.json` 按需填写**，保持接线灵活，**不**用板卡模板锁死引脚。  
3. **护不住的路径用 `wink lint` 提示**（warn → 逐步升 error）。  
4. **近程以 Wave 1 为主**；版本化门禁为后续 Wave。原「板卡模板隐藏引脚 / 简单模式不写绑定」**暂缓**（见 §2.2 Owner 裁决）。

### 1.3 成功标准（按波）

| Wave | 通过标准 |
|------|----------|
| **1（当前主交付）** | 可上线 `type` 均有 `default_role`；官方 sample App C 零 `dal_` 调用（或仅 allowlist）；`wink lint --pack user_surface` 可跑；文档写清稳定面/驱动面/Escape Hatch；字段分级仅作文档与元数据 |
| **2（可选 / 暂缓）** | 仅当产品明确需要「画布折叠 advanced」时再开；**不**默认上板卡模板锁引脚 |
| **3（后续）** | role/JSON schema 显式版本；破坏性变更 = major + lint 迁移提示；CI golden 锁 Role 行为 |

### 1.4 非目标

- 运行时 Role / vtable（违反 ADR-0004）
- 用 Role 替代 BAL 闭环 / 底盘编排
- 保证任意 DAL 内部重构对**行为**零感知（单位/解码等语义破只能靠测试+版本说明）
- 从 schema **删除** `type` / 引脚，或用板卡模板**强制**统一引脚（牺牲每 App 接线灵活）
- **板卡/器件模板合并机制**（Owner 2026-07-28：暂不需要）
- 一次发布即宣布「用户 API 1.0 永不变更」

---

## 2. 架构总览

### 2.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│  用户稳定面（SemVer / golden / lint 守护）                      │
│  • App C:  {name}_{verb}  only（推荐路径）                      │
│  • JSON:   name + role + stable knobs（业务语义相关）            │
│  • 接线:   type + 引脚等仍写在本 App 的 wink-app.json（灵活）    │
└──────────────────────────▲──────────────────────────────────┘
                           │ codegen 生成 inline 门面
┌──────────────────────────┴──────────────────────────────────┐
│  适配层（可变，重生成即消化）                                    │
│  device_tree.h wrappers → dal_*  和/或  wink_*（BAL helper）   │
└──────────────────────────▲──────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         DAL (type)    BAL (算法/事件)  （模板机制暂缓）
```

定稿句（与活规范一致）：

> **`type`**：控制语义族与 DAL 绑定（驱动平面）。  
> **`role`**：面向 App 的 Role Interface（能力平面）。  
> **`role` 不是 BAL**；事件类动词可 **BAL-backed**，仍属用户稳定面，但行为变更须单独说明。

### 2.2 引脚 / `type`：保持每 App 灵活（Owner 裁决）

**裁决（2026-07-28）**：近程**不上**板卡/器件模板；**不**追求「用户只写 role、模板锁死引脚」。

理由：教育/原型场景接线常改，模板把引脚定死会牺牲灵活性；绝缘重点应放在 **App C 的 Role 调用面**，而不是隐藏接线。

现行且保留的做法：

| 面 | 写在哪 | 是否灵活 |
|----|--------|----------|
| 业务调用 | App C → `{name}_{verb}` | 换 DAL 实现可重 codegen，少改业务 C |
| 硬件绑定 | **本 App** `wink-app.json` 的 `type` + 引脚/总线等 | **每 App 自定**，改脚只改 JSON 再 codegen |
| 字段分级 | 文档/插件标 stable vs advanced | 仅帮助区分「业务 knob vs 接线」；**不禁止**用户改 advanced |

历史讨论中的「简单模式 / 板卡模板」仅作**远期可选产品能力**归档，**不纳入当前交付**；若未来低代码画布强需求再单开设计，且须保留「可覆盖模板引脚」的进阶出口。

### 2.3 分波交付（Wave 2 模板路径已降级）

| Wave | 名称 | 交付物 |
|------|------|--------|
| **1** | 稳定面加固（**当前主路径**） | 全可上线 type 有 role；stable/advanced **元数据+文档**；`user_surface` lint；sample 禁直调 `dal_*`；experimental 标记 stub |
| **2** | 可选 UI 披露（**暂缓**） | 仅当需要时：画布折叠 advanced 展示；**默认不做**板卡模板合并 |
| **3** | 版本化门禁（后续） | `role_contract_version` / JSON schema 版本；破坏性=major+迁移提示；CI 行为 golden |

两层绝缘（当前诚实边界）：

| 层 | 挡住什么 | 挡不住什么 |
|----|----------|------------|
| Role + codegen | 多数 `dal_*` 符号/签名形态变化 | 控制语义/单位/默认行为变化；JSON 接线字段变更 |
| lint + 契约测试 | 误用下层、静默语义漂移 | 未覆盖的 Escape Hatch / 未测行为 |

---

## 3. 用户稳定面清单

### 3.1 App C：Role 动词（SSOT 基线）

以 [01-app-business-logic.md § Role](../../design/03-app-codegen/01-app-business-logic.md) 为动词表 SSOT。**发布后改签名或删动词 = 破坏性变更。**

| Role | 稳定动词 | 底层典型去向 | 备注 |
|------|----------|--------------|------|
| `binary_indicator` | `activate` / `deactivate` / `toggle` | `dal_led_*` | 已有 |
| `binary_sensor` | `is_active` / `was_active`（+ `_status`） | `dal_button_*` | 已有 |
| `binary_sensor`（事件） | `enable_events` / `disable_events` 等 | **BAL** `wink_button_*` | **BAL-backed**；属稳定面 |
| `distance_sensor` | `request_measurement` / `read_distance` / `read_distance_status` | `dal_ultrasonic_*` | 已有 |
| `distance_sensor`（事件） | `enable/disable_distance_events` | **BAL** | **BAL-backed** |
| `angular_actuator` | `set_angle` | `dal_rc_servo_*` | 已有 |
| `text_display` | `clear` / `draw_text` / `flush` | `dal_ssd1306_*` | App 不依赖芯片名 |

### 3.2 Wave 1 必须补齐的 Role

| `type` | `default_role` | 初版稳定动词 | 说明 |
|--------|----------------|--------------|------|
| `dc_motor` | `open_loop_actuator` | `set_speed` / `coast` / `brake`（可选包装 `safe_off`） | 开环占空比；**不是**闭环轮速 |
| `encoder` | `pulse_counter` | `get_count` / `reset` | 单位钉死「脉冲」；物理换算在 BAL |
| `gps` / `eeprom` | 暂不提供正式 role | — | 标 **experimental**；lint 阻止当稳定面 |

闭环电机 / 底盘：**不进默认 Role 路径**——App 显式调用 `wink_closed_loop_*` 等 BAL；lint 可标「进阶 API」。

### 3.3 JSON 字段分级

每个驱动在 codegen registry 中声明两档字段（codegen / 文档 / 未来画布共用）。Registry 条目可来自 **OS 扩展根 YAML**（`wink-micro-os/codegen/drivers/*.yaml`，含 `stable_fields` / `advanced_fields` / `default_role` / `role_bindings`）或 **tools 内置 Python 插件**（复杂驱动例外，见 [codegen/README.md](../../../wink-micro-os/codegen/README.md)）：

| 档 | 含义 | 典型字段 |
|----|------|----------|
| **stable** | 用户面；改动影响业务语义，需 changelog | `name`、`role`；少数 knobs：`long_press_ms`、`min_pulse_ms` / `max_pulse_ms`、`auto_poll_ms`… |
| **advanced** | 驱动面；板级/接线 | `type`、GPIO/PWM/I2C/UART 资源、`drive_mode`、`use_rmt`、`active_high`… |

规则：

- 各 App 的 `wink-app.json` **继续写全** `type` 与资源字段（保持接线灵活）。  
- `stable` / `advanced` 仅用于文档、校验提示与未来可选 UI 折叠——**不**引入模板合并，**不**禁止用户改引脚。

### 3.4 明确不算用户稳定面

- 任何直接 `dal_*` 调用或 `&device` 裸操作（**Escape Hatch** → lint warn + allowlist）
- `dal_*_apply_override` / Flash 覆写 blob 布局
- 未被 Role 暴露的 BAL 内部符号
- `experimental` 的 `gps`、`eeprom`

### 3.5 破坏性判定

| 变更 | 对用户 | 处理 |
|------|--------|------|
| 改 `dal_*` 符号/签名，Role 包装消化 | App C 无感（重 codegen） | 允许 |
| 改/删 Role 动词或参数 | **破 App C** | 禁止，或 Wave 3 major + 迁移 |
| 改控制语义（单位、钳位、解码倍率） | **破行为** | major + 契约测试必须更新 |
| 仅改 advanced 接线且模板同步 | 简单模式用户无感 | 允许 |
| 改 advanced 默认值导致观测行为变 | 可能破 | 按语义破处理或显式文档 |

---

## 4. Lint / Codegen / 测试门禁

### 4.1 新 lint pack：`user_surface`

在现有 `wink.py lint --pack layering --pack api` 之外增加（或并入 layering 的明确子组）**`user_surface`**。

| ID | 检查 | 范围 | 级别 | 说明 |
|----|------|------|------|------|
| `APP-NO-DAL-CALL` | 出现 `dal_` 调用/取址 | `wink-micro-app/**/app_*.c` 等 | Wave1 **warn**；官方 sample CI 可 **error** | Escape Hatch：`// wink-lint: allow(APP-NO-DAL-CALL) reason=...` |
| `APP-NO-DAL-INCLUDE` | `#include "dal_*.h"`（经 `device_tree.h` 除外） | 同上 | warn | 减少直连 |
| `DEVICE-REQUIRES-ROLE` | 非 experimental 的 type 无 `default_role` 且 JSON 未写 `role` | 插件元数据 + JSON | **error** | 保证门面存在 |
| `EXPERIMENTAL-TYPE` | 使用 stub type | JSON | **warn**（sample 可 error） | 能选 ≠ 稳定可用 |
| `DEPRECATED-TYPE-ALIAS` | 如 `motor` → `dc_motor` | JSON | warn → 日后 error | 升级现有 DeprecationWarning |
| `STABLE-FIELD-DOC` | 驱动缺少 `stable_fields` / `advanced_fields` 声明 | registry 条目（YAML 或 builtin 插件） | error（Wave1 末可选） | 为 Wave2 铺路 |

BAL 直调（如 `wink_closed_loop_*`）：Wave 1 仅 **info/warn**「进阶 API」，不 ban。

### 4.2 Codegen 适配要求

```text
DAL 改名 / 改签名
  → 只改 driver YAML 的 role_bindings 模板（或 builtin 插件的 render_role_wrapper / init）
  → 重跑 codegen → device_tree.h 更新
  → App 若只调 {name}_{verb} → 源码无 diff
```

硬性要求：

1. 每个可上线 `type`：`default_role` + `role_bindings`（YAML）或 `role_verbs` + `render_role_wrapper`（builtin 插件）齐全。  
2. Wrapper 错误层级与 Role SSOT 一致（Fire-and-forget vs `wink_status_t`）。  
3. 每个 role 至少一个「仅 Role 调用」的 golden / sample 片段。  
4. Escape Hatch 文档保留；lint allowlist 强制写 reason。

### 4.3 契约测试（挡语义破）

| 测试 | 锁定内容 |
|------|----------|
| Role 行为 golden（host） | 如 `set_speed(0)` ≡ coast；DC `safe_off` → brake；距离错误约定 |
| Encoder decode 锁定 | 固定边沿序列 → 期望 `count`（防静默改 x4） |
| JSON 分级 fixture | 缺 required 资源字段 → codegen 失败；stable/advanced 元数据声明齐全 |

语义变更流程：**先改测试 + changelog（+ Wave3 版本 bump）**，禁止只改实现。

### 4.4 Wave 3 门禁（设计预留；Wave 2 模板相关删除）

- **Wave 3**：引入 `role_contract_version` / `json_schema_version`；破坏性动词变更输出 lint 迁移消息。  
- 板卡模板合并校验：**不做**（见 §2.2）。

---

## 5. 落地顺序（实施计划将细化）

### Wave 1（优先）

- [x] 1. 为 `dc_motor` / `encoder` 增加 `default_role` 与 wrappers；回写 Role SSOT。  
- [x] 2. 官方 sample 去除 `dal_` 直调（或 allowlist + reason）。  
- [x] 3. 实现 `user_surface` lint pack（默认 warn）。  
- [x] 4. `gps` / `eeprom` 标 experimental（插件元数据 + lint）。  
- [x] 5. 驱动插件增加 `stable_fields` / `advanced_fields`（或等价声明）。  
- [x] 6. 文档：`role-interface-codegen.md` / `dal-best-practices.md` / `wink-app-json-guide.md` 增加「稳定面 / 驱动面 / Escape Hatch」；**明确引脚由各 App JSON 自定，无板卡模板**。

### Wave 2（暂缓）

不排期。若未来画布需要「折叠 advanced 展示」，另开小品设计；**默认不引入板卡模板锁引脚**。与 [role/intent 演进计划](../../implementation-plans/core/2026-07-28-wink-app-role-intent-evolution-plan.md) 解耦，互不阻塞。

### Wave 3

1. 契约版本字段与兼容策略 ADR。  
2. CI：Role golden + sample `APP-NO-DAL-CALL` error。  
3. 破坏性变更迁移提示文案模板。

### 与驱动面 P0 的关系

[完备性评审](../../reviews/core/2026-07-28-dal-control-semantic-completeness-review.md) 的 DAL config ABI 补丁（`drive_mode`、`max_angle`、encoder `decode_mode` 等）**另轨并行**：它们保护的是驱动正确性；本设计保护的是用户调用面。建议不要阻塞 Wave 1 lint/role，但 **语义相关 P0 应在对外宣称 Role 1.0 前完成或显式锁定**。

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| Role 动词过早冻结 | 锁死半成品 | Wave 1 仅冻已有 + dc_motor/encoder 最小集；事件类标 BAL-backed |
| lint warn 被忽略 | 仍直调 DAL | 官方 sample CI 升 error；产品可配 severity |
| 语义破无法包装消除 | 「没改代码行为变了」 | 契约测试 + changelog；禁止静默改 decode |
| JSON 接线变更仍会影响「配置用户」 | 改脚要改 JSON（可接受） | 不假装绝缘接线；绝缘重点放在 App C Role |
| 与 DAL P0 抢带宽 | 交付延迟 | Wave 1 聚焦 role+lint；ABI 补丁并行 |

---

## 7. 方案比选记录（决策过程）

| 方案 | 结论 |
|------|------|
| 1. 仅近程加固（Role+lint+字段分级文档） | **当前采纳的主路径（Wave 1）** |
| 2. 分波含板卡模板双平面 | 初稿推荐；**Owner 否决近程模板**（引脚锁死不灵活）→ Wave 2 模板路径暂缓 |
| 3. 单里程碑一次做满含模板+版本化 | 否决 |

用户保护范围：**优先护业务 C（Role）**；JSON 侧以分级文档 + lint 提示为主，**接线保持每 App 灵活**。无法绝缘处允许 **wink-tools lint 提示**。

---

## 8. 后续流转

1. Owner 评审本草案 → 状态改为 Ready / Accepted 意图。  
2. 需要固化的产品裁决（若有）→ 短 ADR（如 `user_surface` lint pack、experimental type 策略）。  
3. 实施计划 ③：[2026-07-28-user-surface-phase1-plan.md](../../implementation-plans/frontend/2026-07-28-user-surface-phase1-plan.md)（含语义 ABI 真 P0 + 绝缘 Wave 1）。  
4. Wave 1 完成后回写活规范 ①：`01-app-business-logic.md`、`dal-best-practices.md`、`wink-app-json-guide.md`。  
5. 板卡模板 / 简单模式隐藏引脚：**不排期**；若产品日后需要，另开 tech-design 且必须保留每 App 覆盖引脚的能力。

---

*本文为技术设计规格（②）。归档实施细节以实施计划为准；交互讨论以本文为 SSOT。*

