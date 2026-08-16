# ADR-0051：Codegen 扩展根外置 — 闭源引擎扫描开源描述（演进 ADR-0046）

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-07-28 |
| 触发 | 产品意图：`wink-tools` 可闭源分发；用户/开源仓须能**自行新增 DAL + Role + type↔role 映射与 codegen 描述**，且**不修改 tools 源码**；当前 ADR-0046 将驱动 SSOT 钉在 `wink-tools/.../drivers/*.py`，与该意图冲突 |
| 影响范围 | `wink-tools` codegen / `list_drivers` / `app_codegen` / `new-dal`；拟新增 `wink-micro-os/codegen/`（及可选 App 级扩展根）；文档：`dal-development-guide/*`、ADR-0046 交叉引用、活规范 01-dal / 03-codegen |
| 决策者 | 项目 Owner |
| 关联 ADR | [ADR-0046](../core/0046-dal-driver-registry-ssot.md)（**本 ADR Accepted 后部分更新其 SSOT 路径**；registry/扫描机制保留）；[ADR-0039](../core/0039-dal-dual-mode-auto-pruning.md)；ADR-0004；ADR-0043 |
| 关联设计 | [tech-designs/2026-07-28-scannable-codegen-extension-roots-design.md](../../tech-designs/tools/2026-07-28-scannable-codegen-extension-roots-design.md)（**定稿**） |
| 关联评审 | [reviews/2026-07-29-scannable-codegen-extension-roots-design-review.md](../../reviews/tools/2026-07-29-scannable-codegen-extension-roots-design-review.md) |
| 关联手册 | [`role-interface-codegen.md`](../../wink-micro-os/docs/dal-development-guide/role-interface-codegen.md)；[`adding-peripheral.md`](../../wink-micro-os/docs/dal-development-guide/adding-peripheral.md) |
| 关联活规范（SSOT） | [01-dal-device-abstraction.md](../../design/02-wink-micro-os/01-dal-device-abstraction.md)；[03-ai-dsl-and-codegen-pipeline.md](../../design/03-app-codegen/03-ai-dsl-and-codegen-pipeline.md) |

---

## 背景（Context）

1. **闭源边界**：计划将 `wink-tools`（CLI / codegen 引擎 / lint 引擎）作为闭源或受限分发产物；`wink-micro-os`（DAL/PAL/runtime）与用户 App 保持可改。
2. **扩展诉求**：用户新增外设时希望只提交：
   - `dal_*.{h,c}`（运行时）
   - codegen **描述**（驱动字段、Role、映射、渲染模板）
   - 而不 PR / 不重编 wink-tools。
3. **现状张力**：ADR-0046 正确解决了「多处手改 CMake」问题，但把 **驱动全集 SSOT** 放在 **tools 树内** `drivers/*.py`。在 tools 闭源后，该路径对用户不可写 ⇒ 无法满足「零改 tools」。
4. **Role 同理**：Role Interface 是 codegen 门面（非 BAL、非固件链接库）；描述应与驱动描述同属**可扫描扩展根**，而非塞进 `dal/` 运行时目录冒充同级库。

## 方案比选（Options）

| 方案 | 做法 | 结论 |
|------|------|------|
| A. 维持 ADR-0046：SSOT 在 `wink-tools/drivers/` | 用户改闭源仓或厂商代改 | ❌ 与闭源+自助扩展冲突 |
| B. 整份 Python 插件挪到 `wink-micro-os`，tools 仅扫描 `.py` | 迁移快 | ⚠️ 可接受过渡；用户仍须写 Python；钩子信任模型重 |
| **C. 扩展根外置：`micro-os/codegen/`（+可选 app）= 描述 SSOT；tools = 纯引擎；YAML 为主、可选 hooks** | 扫描加载；schema 版本化 | ✅ **采纳** |
| D. Role/驱动描述改纯 C 宏放 `dal/` 旁 | 无 codegen | ❌ 实例名 `{name}_*` 无法规模化 |
| E. 仅 pip entry_points 第三方包 | 生态后期 | ❌ MVP 过重；可作后续增强 |

## 决策结论（Decision）

1. **分层产品契约**  
   - **`wink-tools`**：闭源/引擎 — 扫描、校验、**沙箱化** Jinja（或等价）渲染、`list_drivers` CMake 发射、`app_codegen`、lint 规则解释。**不**再作为用户外设表的唯一可写 SSOT。  
   - **`wink-micro-os/codegen/`**（开源约定路径）：**驱动与 Role 描述的默认 SSOT**（机读）。  
   - **可选** `wink-micro-app/<app>/codegen/` 与 CMake cache `WINK_CODEGEN_PATHS`：覆盖 / 私有外设 / 板级包。

2. **扫描顺序（后者覆盖前者）**  
   `tools 内置（可选库存）` → `wink-micro-os/codegen` → `env（WINK_CODEGEN_PATHS cache 声明顺序）` → `app/codegen`。  
   **App 最高优先级**（最具体）；板级/第三方包不得静默盖掉 App 私有 type。运维「强制盖一切」不在本决策用普通 env 表达。

3. **描述形态**  
   - **MVP**：`codegen/drivers/*.yaml` + `codegen/roles/*.yaml`（`codegen_schema` 版本化）；**禁止** Python hooks。  
   - **P4 可选**：同 stem hooks；信任边界见 tech-design。  
   - **禁止**把 Role 实现做成 `dal/` 旁需链接的运行时库作为主路径。  
   - 允许扩展根内 `*_template_file` 引用（相对路径），改善大段 C 可维护性。

4. **与 ADR-0046 的关系**  
   - **保留**：单一 registry 思想、`list_drivers` 生成数据型 CMake、`--mode=source|defs`、禁止手改多处驱动表、双模裁剪（ADR-0039）。  
   - **更新**：SSOT **路径**从「tools 内 `drivers/*.py`」演进为「**可扫描扩展根**上的描述集合」；迁移期可双读，退出标准见 tech-design。

5. **新增外设零改 tools**  
   标准路径：写 DAL + 在扩展根添加 driver（及可选 role）描述 → configure/build。`new-dal` 脚手架改为向扩展根写描述，而非向 tools 树写插件。

6. **P1 引擎强制约束（构建安全与正确性）**  
   - 渲染扩展根模板必须使用 **`jinja2.sandbox.SandboxedEnvironment`** + context 白名单；固定 jinja2 最低版本。禁 hooks ≠ 消除模板 RCE 面。  
   - 扩展根 YAML（及引用的模板文件）必须登记为 **`CMAKE_CONFIGURE_DEPENDS`**；描述变更触发 reconfigure。生成物 hash 仅对账。  
   - 构建真值：`WINK_CODEGEN_PATHS` 以 **CMake cache** 为准；环境变量仅 CLI 便捷入口。

7. **明确不做（本 ADR）**  
   - 不在本决策内实现 tools 闭源打包流水线本身。  
   - 不强制跨仓 unisim CI。  
   - 不把 BAL 组件登记进 `devices[].role`。

## 后果与约束（Consequences）

| 正面 | 负面 / 缓解 |
|------|-------------|
| 用户/开源仓可自助扩展；tools 可闭源 | 需稳定 schema；缓解：版本字段 + N−1 warn 窗口 + fail-closed |
| Role/驱动描述可发现、与 DAL 文档分家 | 迁移成本；缓解：分阶段 + ultrasonic 作 P1 YAML 样例 |
| 延续 list_drivers / 双模裁剪 | 双读期需覆盖日志与 STRICT_OVERRIDE |
| 扫描外部描述扩大构建期攻击面 | **P1 强制沙箱**；MVP 禁 hooks；模板仅根内相对路径 |
| 改描述未重建 | **P1 强制 CONFIGURE_DEPENDS** |

## 遵循与后续（Compliance & Follow-up）

Accepted 后必须：

- [x] Owner 确认闭源边界与扩展根路径约定 — 2026-07-29  
- [x] 落地 tech-design 定稿（含评审 #1–#11 回写）— 2026-07-29  
- [x] 回写 `01-dal-device-abstraction.md`、`03-ai-dsl-and-codegen-pipeline.md` — 2026-07-29  
- [x] 回写 `adding-peripheral.md`、`role-interface-codegen.md`（链目标态；迁移期注明双读）— 2026-07-29  
- [x] 在 ADR-0046 底部状态日志注明「SSOT 路径由 ADR-0051 演进」— 2026-07-29  
- [x] 另开 implementation-plan — [2026-07-29-scannable-codegen-extension-roots-plan.md](../../implementation-plans/tools/2026-07-29-scannable-codegen-extension-roots-plan.md)  
- [ ] `wink lint --pack drivers` 改为校验扩展根（实施期，见计划 T3/T11/T12）  

---

*本 ADR 状态变更请在此记录：*
- 2026-07-28：Proposed（配合 scannable codegen extension roots 技术设计；产品意图：tools 闭源 + 用户自助 DAL/Role）
- 2026-07-29：Accepted（定稿 tech-design；采纳评审：沙箱与 CONFIGURE_DEPENDS 为 P1 前置；扫描顺序 App 最高；MVP 禁 hooks；活规范与手册回写）
- 2026-07-29：状态日志 — Schema 1.1 字段收敛落地（单一 `fields:` SSOT、三态 `render_strategy`、`build_variants`、roles 同步 `"1.1"`）；实施见 [PLAN-20260729-CODEGEN-SCHEMA-CONV](../../implementation-plans/tools/2026-07-29-scannable-codegen-schema-convergence-plan.md)；tech-design §4 已回写

