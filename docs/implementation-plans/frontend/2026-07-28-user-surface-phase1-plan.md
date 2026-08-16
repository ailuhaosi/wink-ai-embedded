# 用户稳定面 + DAL 语义冻结 — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` (recommended) or `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.  
> Domain skill: `embedded-best-practice`（静态分发 / 负数错误码 / 双 target）；文档 Task 对照 `.claude/rules/docs-adr.md`。

**Goal:** 完成第一阶段：在破坏窗口内钉死会穿透 Role 的 DAL 语义/ABI（encoder 解码、rc_servo 行程角与脉宽映射、dc_motor 拓扑命名与 enable/safe_off）；补齐 `dc_motor`/`encoder` Role；加上 `user_surface` lint 与 experimental 门禁；用契约测试与 codegen 零 diff 锁兼容——使 Role-only App C 在后续 DAL 形态演进时尽量不受破坏。

**Architecture:** 双轨并行、同一出口闸：**(A) 驱动语义 ABI 补丁**与 **(B) 用户稳定面 Wave 1** 同 Phase 合入；**不上**板卡模板、不删 JSON 引脚。Role 包装消化符号变化；语义变化靠测试 + 默认值兼容。执行序硬约束：**B1（Role）先于 B3 的 error 级 DEVICE-REQUIRES-ROLE**。

**Tech Stack:** C99（host Unity）、CMake、`wink-tools` codegen / lint / `wink.py test`、Markdown 活规范。

## Global Constraints

- SSOT 设计：[user-surface-insulation-design](../../tech-designs/tools/2026-07-28-user-surface-insulation-design.md)  
- SSOT 完备性评审补遗：[completeness-review §10](../../reviews/core/2026-07-28-dal-control-semantic-completeness-review.md)  
- 计划评审（已吸收）：[user-surface-phase1-plan-review](../../reviews/frontend/2026-07-28-user-surface-phase1-plan-review.md)
- **Owner 已裁决**：不上板卡/器件模板锁引脚；接线仍由各 App `wink-app.json` 灵活填写。
- **本 Phase 锁定裁决（v1.1，吸收计划评审）：**
  - `ssd1306` **保留**芯片名 `type`（不改名）；文档说明异芯片/SPI → 新 type 或未来 `panel_variant`。
  - `encoder`：默认 `decode_mode = x1_rising`（锁定今日 ISR）；x2/x4 未实现 → **init** 返 `WINK_ERR_UNSUPPORTED`；`invert=true` = **交换 A/B 方向语义（换相极性）**，非简单 `count = -count`。
  - **x1 协议（钉死）**：A 上升沿采样 B；B 高 → `count++`，B 低 → `count--`；无 `pin_b` → 仅递增。
  - `dc_motor`：默认 `drive_mode = **in_in**`（今日 PWM+IN_A+IN_B，**不是**业界 Phase/Enable）；`enable_pin = -1`；未实现拓扑 → fail-closed `WINK_ERR_UNSUPPORTED`。
  - **`safe_off` 层级（不推翻 ADR-0048）：**
    1. `enable_pin >= 0` → 拉低 enable（硬关断），并在可 brake 时尽量 brake；整体目标停转，返回 `WINK_OK`（细节见 Task A3）  
    2. 无 enable 且 `dir_pin_b >= 0` → **brake**（ADR-0048）  
    3. 无 enable 且单脚 → **`WINK_ERR_UNSUPPORTED`**（保持 ADR-0048；BAL 可回退 coast）  
    - **不**在本 Phase 把单脚改为强制 coast+OK（需另修 ADR）
  - Role：`dc_motor` → `open_loop_actuator`；`encoder` → `pulse_counter`（文档注明命名维度差异；改名为 `rotary_speed_actuator` 非本 Phase 阻塞项）
  - `set_speed` Role wrapper **保留 `wink_status_t`**（不可照搬 `set_angle` 的 `IGNORE_RESULT`）
- ADR-0004：禁止为抽象引入 `*_ops` / vtable。
- 加法字段优先：新 config 字段末尾追加；`0`/`-1`/缺省兼容今日；有 `apply_override` 则 bump wire 或声明字段不进 override；**尚无 override 的驱动**在头文件声明「未来 wire 顺序随 config 成员序」。
- Commit：英文、按 Task 原子提交；不改无关逻辑。
- 验收基线：`python wink-tools/wink.py test`；`python wink-tools/wink.py lint --pack layering --pack api --pack user_surface`；C2 含 sample codegen **零 diff**（未写新可选字段时）。
- **双 target**：host 单测必过；改动后至少确认 host + 一条 wasm/sim 或文档化的编译路径可通过（见各 Task 子步骤）。
- **本 Phase 明确不做**：板卡模板、button BAL 钩子拆头、`ssd1306` type 改名、gps/eeprom 真实现、Wave 3 semver、意图平面、单脚 `safe_off`→coast 改 ADR。

---

## 1. 元数据表

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260728-USER-SURFACE-P1` |
| **创建日期** | 2026-07-28 |
| **目标平台** | `host` 单测必过；改动须双 target 可编（wasm/ESP32） |
| **计划状态** | ✅ 已完成（C2 出口验收 2026-07-29） |
| **优先级** | 🔴 P0 |
| **计划版本** | `v1.1`（吸收 [phase1-plan-review](../../reviews/frontend/2026-07-28-user-surface-phase1-plan-review.md)） |
| **关联技术设计** | [2026-07-28-user-surface-insulation-design.md](../../tech-designs/tools/2026-07-28-user-surface-insulation-design.md) |
| **关联评审** | [completeness §10](../../reviews/core/2026-07-28-dal-control-semantic-completeness-review.md)；[phase1-plan-review](../../reviews/frontend/2026-07-28-user-surface-phase1-plan-review.md) |
| **关联活规范** | [01-app-business-logic.md](../../design/03-app-codegen/01-app-business-logic.md)、[01-dal-device-abstraction.md](../../design/02-wink-micro-os/01-dal-device-abstraction.md)、[`dal-best-practices.md`](../../../../wink-micro-os/docs/dal-development-guide/dal-best-practices.md)、[`role-interface-codegen.md`](../../../../wink-micro-os/docs/dal-development-guide/role-interface-codegen.md)、[`wink-app-json-guide.md`](../../../../wink-micro-os/docs/wink-app-json-guide.md) |
| **关联 ADR** | ADR-0004、ADR-0017、ADR-0043、ADR-0046、ADR-0048（safe_off→brake 保持；enable 路径本 Phase 扩展）、ADR-0050 |
| **前置** | followup T1（`dal_dc_motor`）已完成 |
| **替代/废弃** | 无 |

### 1.1 版本变更（相对 v1.0）

| 项 | 变更 |
|----|------|
| `drive_mode` 默认名 | `phase_enable` → **`in_in`**（纠正拓扑误称） |
| `safe_off` | 增加 enable 硬关路径；单脚仍 UNSUPPORTED（不改 ADR-0048） |
| 执行序 | **B1 先于 B3 error 规则** |
| encoder | 钉死 x1/invert 语义；override 立场注释 |
| rc_servo | 脉宽映射 golden；`max_angle==0` codegen 警告 |
| Role | `set_speed` 返回 status |
| C2 | sample codegen 零 diff |
| 文档 | best-practices 纠正 phase_enable 误用；可选 ADR 回写挂 C1/后续 |

---

## 2. 背景与目标

### 2.1 问题

1. 若干 DAL config **已知必来字段未进 ABI**——上线后再加会破 JSON/结构或静默改行为。  
2. 文档曾把今日 **IN/IN** 拓扑误称为 `phase_enable`——若按误称冻结枚举，后续真 Phase/Enable 会二次破坏。  
3. `dc_motor` / `encoder` **无 Role** → App 易直调 `dal_*`。  
4. 缺 **user_surface lint** / **experimental** / **契约测试**（含脉宽分母、safe_off 电平意图）。  
5. `safe_off` 与未来 `enable_pin` 交互未定义；单脚拓扑下 brake 失败语义需与 ADR-0048 对齐说明。

### 2.2 Phase 1 目标

- ✅ encoder / rc_servo / dc_motor 语义相关 config 落地且默认兼容今日  
- ✅ `drive_mode` 命名与真值表正确（`in_in`）  
- ✅ `safe_off`：有 enable → 硬关；无 enable → 保持 ADR-0048  
- ✅ `open_loop_actuator` / `pulse_counter` Role + SSOT（`set_speed` 返回 status）  
- ✅ `user_surface` lint（B1 完成后再升 DEVICE-REQUIRES-ROLE=error）  
- ✅ gps/eeprom experimental  
- ✅ stable/advanced 元数据；`pulse_counter` 文档预留 CPR（不实现）  
- ✅ host 契约测试 + L1 sample codegen 零 diff  
- ✅ 文档：稳定面 / 驱动面 / Escape Hatch；纠正 best-practices 拓扑名  

### 2.3 成功指标

| 指标 | 通过标准 | 验证 |
|------|----------|------|
| host 单测 | 全绿，含本计划新增用例 | `python wink-tools/wink.py test` |
| lint | layering + api + user_surface 无新增 error | `wink.py lint --pack …` |
| Role | 两 type 有 `default_role`；`set_speed` 为 status 包装 | codegen 单测 |
| 默认兼容 | 旧 JSON（无新字段）行为与今日一致 | 单测 + **C2 codegen 零 diff** |
| 脉宽映射 | 默认 `max_angle` 下 90° → 1.5ms（0.5–2.5 脉宽） | A2 golden |
| 文档 | 稳定面 + `in_in` 真值表；ssd1306 保留芯片名 | 人工审阅 |
| 非目标守住 | 无 board 模板；无单脚 safe_off→coast 改 ADR | 审阅 |

---

## 3. 变更范围

### 3.1 文件清单（预期）

| 路径 | 变更 | Track |
|------|------|-------|
| `dal/include\|src/sensor/dal_encoder.*` | decode_mode / invert；x1 注释；override 立场 | A |
| `test/unit/dal/test_dal_encoder.c` | 边沿 golden + invert | A |
| `dal/include\|src/actuator/dal_rc_servo.*` | max_angle；映射分母；override 不含本字段 | A |
| servo 单测（定位后改） | 钳位 + 1.5ms golden | A |
| `dal/include\|src/actuator/dal_dc_motor.*` | in_in / enable / safe_off 层级；真值表 | A |
| `test/unit/dal/test_dal_dc_motor.c` | mode / enable / safe_off（尽量断言 GPIO） | A |
| `codegen/drivers/{dc_motor,encoder,rc_servo,…}.py` | 字段 + role + stable/advanced | B |
| `codegen/drivers/{gps,eeprom}.py` + `base.py` | experimental | B |
| `lint/rules/user_surface.yaml` + 注册 | 新 pack | B |
| 活规范 / best-practices / guides | 回写 | C |
| L1 samples | Role 优先 / allowlist | B |
| （可选）ADR-0048 补丁或短 ADR | enable 路径与 in_in 命名 | C |

### 3.2 执行顺序（硬约束）

```text
Track A（可并行）                Track B
  A1 encoder ──┐
  A2 rc_servo ─┼──► B1 roles（须先完成）──► B3 lint（DEVICE-REQUIRES-ROLE 此时方可 error）
  A3 dc_motor ─┘         │
                         ├──► B2 experimental（可与 B1 并行）
                         ├──► B4 stable/advanced（可与 B1 后半并行）
                         └──► B5 L1 samples
                                      │
                                      ▼
                         Track C：文档 + ADR 备注 + C2 出口
```

**禁止**：在 B1 完成前把 `DEVICE-REQUIRES-ROLE` 设为 error（可先 warn 落地 yaml，B1 后再升 error）。

---

## 4. Tasks

### Task A1: encoder — 钉死 decode_mode（默认 x1）

**Files:**
- Modify: `wink-micro-os/dal/include/sensor/dal_encoder.h`
- Modify: `wink-micro-os/dal/src/sensor/dal_encoder.c`
- Modify: `wink-tools/tools/codegen/drivers/encoder.py`
- Test: `wink-micro-os/test/unit/dal/test_dal_encoder.c`

**Interfaces / 契约（钉死）：**
```c
typedef enum {
    DAL_ENCODER_DECODE_X1_RISING = 0, /* default */
    DAL_ENCODER_DECODE_X2 = 1,        /* reserved → init UNSUPPORTED */
    DAL_ENCODER_DECODE_X4 = 2,        /* reserved → init UNSUPPORTED */
} dal_encoder_decode_mode_t;
/* config.decode_mode; bool invert; /* false = today's A/B sense */
```
- **x1：** A 上升沿采 B；B 高 ++，B 低 --；无 pin_b → 仅 ++。  
- **invert：** 交换方向判定（换相极性），使未来 x2/x4 可复用；**禁止**仅在 `get_count` 取负冒充。  
- 头文件注释：`/* No apply_override wire yet. Future serialization follows config member order. */`

- [ ] **Step 1:** 单测：固定边沿序列 → 期望 count；缺省 = 显式 x1；invert 翻转方向增量  
- [ ] **Step 2:** 跑测（红/绿）  
- [ ] **Step 3:** 头文件 + 实现；非 x1 init 失败；注释钉死协议  
- [ ] **Step 4:** codegen 可选 `decode_mode` / `invert`（默认不发射 = 0/false）  
- [ ] **Step 5:** 确认 host 测过；快速确认 sim/wasm 相关目标可编（或文档「仅经 PAL GPIO，无新 sim stub」）  
- [ ] **Step 6:** Commit：`fix(dal): lock encoder x1 decode_mode and invert polarity`

---

### Task A2: rc_servo — max_angle + 脉宽映射契约

**Files:**
- Modify: `wink-micro-os/dal/include/actuator/dal_rc_servo.h`
- Modify: `wink-micro-os/dal/src/actuator/dal_rc_servo.c`
- Modify: `wink-tools/tools/codegen/drivers/rc_servo.py`
- Test: 定位 `test_dal_rc_servo` / `test_dal_servo` 后扩展

**Interfaces / 契约：**
- `config.max_angle`：float；**0 或未设 → 有效值 180.0f**（兼容 designated init）  
- 钳位：`angle ∈ [0, effective_max_angle]`  
- **映射（必须改用 effective_max，禁止继续写死 180 常量作分母）：**
  ```text
  pulse_ms = min_pulse + (angle / effective_max_angle) * (max_pulse - min_pulse)
  ```
  默认下与今日数值一致。  
- `apply_override`：**不**把 `max_angle` 写入 wire（本 Phase Non-goal）；头文件注明。  
- codegen：JSON `max_angle: 0` → **警告**（易与哨兵冲突）；建议用户用正数。

- [ ] **Step 1:** 单测：  
  - 默认：200 → 钳到 180  
  - 默认 min=0.5 max=2.5：`set_angle(90)` → 脉宽 **1.5 ms**（golden）  
  - 显式 `max_angle=270`：200 不钳到 180；映射分母为 270  
- [ ] **Step 2:** 实现 config + 钳位 + 映射  
- [ ] **Step 3:** codegen 可选字段 + `max_angle==0` warn  
- [ ] **Step 4:** test 绿；Commit：`feat(dal): rc_servo max_angle with pulse-map contract`

---

### Task A3: dc_motor — in_in + enable_pin + safe_off 层级

**Files:**
- Modify: `wink-micro-os/dal/include/actuator/dal_dc_motor.h`
- Modify: `wink-micro-os/dal/src/actuator/dal_dc_motor.c`
- Modify: `wink-tools/tools/codegen/drivers/dc_motor.py`
- Modify: `dal-best-practices.md`（纠正旧 `phase_enable` 表述——可与 C1 合并，A3 至少改枚举注释）  
- Test: `wink-micro-os/test/unit/dal/test_dal_dc_motor.c`

**Interfaces / 契约：**
```c
typedef enum {
    DAL_DC_MOTOR_MODE_IN_IN = 0,        /* default — today's PWM + IN_A + IN_B */
    DAL_DC_MOTOR_MODE_PHASE_ENABLE = 1, /* reserved — single PHASE + ENABLE/PWM */
    DAL_DC_MOTOR_MODE_PWM_ON_IN = 2,    /* reserved — PWM on input pins */
} dal_dc_motor_drive_mode_t;
/* config.drive_mode; wink_pin_t enable_pin; /* -1 unused */
```
**IN/IN 真值表（头文件注释）：**
```text
dir_a  dir_b | state
  0      0   | coast
  1      0   | forward
  0      1   | reverse
  1      1   | brake (short)
```
- 默认路径 = 今日 `set_speed` / `coast` / `brake` 实现。  
- 非 `IN_IN`：init 或首调 → `WINK_ERR_UNSUPPORTED`。  
- `enable_pin >= 0`：init claim + 输出；正常运行拉高使能（nSLEEP/STBY 高有效假设写进注释；若他日低有效再加 polarity 字段）。  
- **`safe_off`（Global Constraints 层级）** — 单测覆盖 1/2/3。  
- 头文件：`/* No apply_override wire yet. Future serialization follows config member order. */`

- [ ] **Step 1:** 单测：默认 IN_IN 行为；`safe_off`→brake（双脚）；有 enable 时 safe_off 拉低 enable；单脚 safe_off→UNSUPPORTED；未实现 mode→UNSUPPORTED；**若 mock 允许则断言 dir 脚电平（brake 双高）**，否则注释「锁调用链，电平靠 HIL」  
- [ ] **Step 2:** 实现枚举/字段/enable/safe_off  
- [ ] **Step 3:** codegen：`drive_mode` 字符串 `in_in`（默认省略）；`enable_pin` 可选  
- [ ] **Step 4:** host + 编译路径检查（enable 为普通 GPIO）  
- [ ] **Step 5:** Commit：`feat(dal): dc_motor in_in mode, enable_pin, safe_off hierarchy`

---

### Task B1: Role — dc_motor + encoder（**先于 B3 error**）

**Files:**
- Modify: `wink-tools/tools/codegen/drivers/dc_motor.py`
- Modify: `wink-tools/tools/codegen/drivers/encoder.py`
- Modify: `docs/design/03-app-codegen/01-app-business-logic.md`
- Modify: `wink-micro-os/docs/dal-development-guide/role-interface-codegen.md`
- Test: `wink-tools/tools/codegen/tests/`

**Interfaces：**
| type | default_role | verbs | 错误层级 |
|------|--------------|-------|----------|
| `dc_motor` | `open_loop_actuator` | `set_speed`, `coast`, `brake`；可选 `safe_off` | **`set_speed` / `brake` / `safe_off` → `wink_status_t`**；`coast` 可 Fire-and-forget 或 status（推荐 status 一致） |
| `encoder` | `pulse_counter` | `get_count`, `reset` | Normal `wink_status_t` + out；注释：**原始脉冲，无 CPR** |

文档一句：`angular_actuator` 按运动输出命名；`open_loop_actuator` 按开环策略命名（防与闭环混淆）；非 BAL。

- [ ] **Step 1:** codegen 单测：生成 `{name}_set_speed` 返回 status；`{name}_get_count`  
- [ ] **Step 2:** 实现 wrappers（**禁止**对 `set_speed` 无脑 `IGNORE_RESULT`）  
- [ ] **Step 3:** 回写 Role SSOT 表  
- [ ] **Step 4:** Commit：`feat(codegen): open_loop_actuator and pulse_counter roles`

---

### Task B2: experimental — gps / eeprom

**Files:**
- Modify: `wink-tools/tools/codegen/drivers/base.py`（`experimental: bool = False`）  
- Modify: `gps.py`、`eeprom.py`  
- Docs: `wink-app-json-guide.md` 一句

- [ ] **Step 1:** `experimental = True`；codegen stderr 警告  
- [ ] **Step 2:** 与 B3 `EXPERIMENTAL-TYPE` 对齐  
- [ ] **Step 3:** Commit：`chore(codegen): mark gps and eeprom experimental`

---

### Task B3: lint pack `user_surface`

**依赖：** B1 已合入后，才可将 `DEVICE-REQUIRES-ROLE` 设为 **error**。若需提前合入 yaml：先 **warn**，B1 后升 error（同 PR 两 commit 或子步骤）。

**Files:**
- Create: `wink-tools/tools/lint/rules/user_surface.yaml`  
- Modify: lint 注册 / cli  
- Test: fixture 或 testdata

| ID | 级别 | 说明 |
|----|------|------|
| `APP-NO-DAL-CALL` | warn | L1 `app_*.c` 调 `dal_*`；allowlist 豁免 |
| `EXPERIMENTAL-TYPE` | warn | JSON 使用 experimental type |
| `DEVICE-REQUIRES-ROLE` | **error**（仅 B1 后） | 非 experimental 缺 default_role 且 JSON 无 role |
| `DEPRECATED-TYPE-ALIAS` | warn | `motor` 等 |
| `STABLE-FIELD-DOC` | warn（可选） | 上线 type 缺 stable/advanced 声明 |

- [ ] **Step 1:** 落地 pack；`DEVICE-REQUIRES-ROLE` 按依赖设级别  
- [ ] **Step 2:** `avoidance_car` / `oled_dashboard` 无 error；`resource_conflict` 排除或 allowlist  
- [ ] **Step 3:** 文档一句如何跑 pack  
- [ ] **Step 4:** Commit：`feat(lint): add user_surface pack`

---

### Task B4: stable_fields / advanced_fields

**Files:**
- Modify: `base.py` + 各上线 `drivers/*.py`

**约定：**
- `advanced`：资源脚/总线、`drive_mode`、`enable_pin`、`use_rmt`、`decode_mode`…  
- `stable`：`role`、`max_angle`、`long_press_ms`、`auto_poll_ms`…  
- `pulse_counter`：**文档/注释预留 `cpr` 名**（本 Phase 不实现、可不进 JSON）

- [ ] **Step 1–2:** 声明填表  
- [ ] **Step 3:** Commit：`docs(codegen): stable vs advanced field metadata`

---

### Task B5: L1 sample 与 Escape Hatch

- [ ] **Step 1:** `rg "\bdal_" wink-micro-app --glob 'app_*.c'` 分类  
- [ ] **Step 2:** L1 改 Role；专家样例排除/allowlist + reason  
- [ ] **Step 3:** Commit：`chore(apps): prefer Role APIs in L1 samples`

---

### Task C1: 文档回写 + ADR 闭环入口

**Files:**
- `01-app-business-logic.md`、`dal-best-practices.md`（**纠正 phase_enable=今日拓扑的错误**）、`role-interface-codegen.md`、`wink-app-json-guide.md`、`01-dal-device-abstraction.md`  
- 可选：修订 [ADR-0048](../../decisions/core/0048-actuator-control-semantic-naming.md) 附录——`in_in` 命名、`safe_off`+`enable_pin` 层级（不改「无 enable 时仍绑 brake」）

**必须写清：**
- 稳定面 / 驱动面 / 无模板 / Escape Hatch / BAL-backed  
- IN/IN 真值表与 `pwm_on_in` / 真 `phase_enable` 预留  
- encoder x1 / invert；rc_servo 映射公式；pulse_counter 无 CPR  
- ssd1306 保留芯片名  

- [ ] **Step 1–2:** 改文档并交叉链接本计划 + 两份评审  
- [ ] **Step 3:** Commit：`docs: phase1 user-surface and dal semantic contracts`

---

### Task C2: Phase 1 出口验收

- [x] **Step 1:** `python wink-tools/wink.py test`  
- [x] **Step 2:** `python wink-tools/wink.py lint --pack layering --pack api --pack user_surface`  
- [x] **Step 3:** **Codegen 零 diff：** 对 `avoidance_car`、`oled_dashboard`（及同类未使用新可选字段的 sample）对比合入前后生成的 `device_tree.c` / `.h`（或项目等价产物），确认无意外漂移  
- [x] **Step 4:** 确认 Global Constraints「不做」列表仍成立  
- [x] **Step 5:** 本计划状态 → ✅；tech-design Wave 1 勾选  

---

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| 拓扑误称锁进 ABI | v1.1 改为 `in_in`；文档纠错 |
| safe_off 与 ADR-0048 冲突 | 单脚保持 UNSUPPORTED；仅扩展 enable 路径 |
| B3 error 早于 B1 | 执行序硬约束 / 先 warn |
| `max_angle==0` 哨兵歧义 | codegen warn |
| `set_speed` 吞错误 | Role 返回 status |
| config 加法破 init | 字段末尾；0/-1 默认 |
| lint 误伤专家样例 | 路径排除 + allowlist |
| 未实现 mode 误用 | fail-closed UNSUPPORTED |
| 脉宽分母静默漂 | 1.5ms golden |
| override 未来布局 | 头文件立场注释 |

回滚：按 Task 反向 revert；文档与代码同 PR。

---

## 6. 计划评审采纳矩阵

| 评审项 | 采纳 | 落点 |
|--------|------|------|
| 2.1 IN_IN 命名 | ✅ MUST | GC + A3 |
| 2.2 safe_off 全改 coast | ⚠️ 部分：enable 硬关 ✅；单脚 coast ❌（保 ADR-0048） | GC + A3 |
| 3.1 B1 先于 B3 | ✅ | §3.2 + B3 |
| 3.2 sim 适配 | ✅ 弱化：编译/PAL 验证子步骤 | A1/A3 |
| 3.3 override 立场 | ✅ | A1/A3 |
| 4.1 脉宽 golden | ✅ | A2 |
| 4.2/4.3 invert + x1 | ✅ | A1 |
| 4.4 set_speed status | ✅ | B1 |
| 4.5 max_angle=0 warn | ✅ | A2 |
| 4.6 GPIO 断言 | ✅ 尽力 | A3 |
| 5.1 ADR | ✅ 入口在 C1 | C1 |
| 5.2 codegen diff | ✅ | C2 |
| 5.3 CPR 预留 | ✅ 文档 | B1/B4 |
| 5.4 Role 改名 | ⏸️ 非阻塞；文档说明维度 | B1/C1 |

---

## 7. 后续（非本 Phase）

| 项 | 去向 |
|----|------|
| 单脚 safe_off→coast 且必须 OK | 修订 ADR-0048 后另开 |
| 真 `PHASE_ENABLE` / `PWM_ON_IN` 实现 | 拓扑实现计划 |
| button BAL 钩子拆头 | P1 小品 |
| ssd1306 `panel_variant` | 按需 |
| gps/eeprom 真实现 | 独立计划 |
| Role 统一运动输出命名 | 可选 rename 窗口 |
| user_surface CI error 升格 / semver | Wave 3 |
| 板卡模板 | **不排期** |

---

*本计划为文档层 ③（v1.1）。执行时按 Task 勾选；Agent 默认 `subagent-driven-development`。*

