# Working-tree 未提交改动分析

> 任务：dal-lint TDD plan (commits 645193d..71b0d44，已 push 80 commits)
> 范围外：13 个文件 / 243+ 行未提交改动 + 3 个 gitlink 改动
> 本文档逐个评估保留 vs 丢弃风险

## 总体判定：建议**全部丢弃**

**理由**：本任务（dal-lint TDD）完全未触及这些文件。改动属于
- 2026-07-14 button event drive 重构 (CMake/doc)
- 2026-07-28 user-surface phase 1 (doc/manifest)
- 3 个实验性 gitlink worktree

这些工作需要原作者凭领域知识解决冲突。本 agent 无 user-surface / button-event 计划上下文。

**`git restore .` 一行解决**：丢弃 working tree 所有改动，恢复到 HEAD（已含 80 个 push 出去的 dal-lint commits）。

如确需**逐个**决定，详见下表。

---

## 文件 1：`docs/design/03-app-codegen/01-app-business-logic.md`

- **改动**：+67 / -6，7 对 conflict marker
- **冲突内容**：
  - L1 样板关联字段（upstream 链 2026-07-28 user-surface 评审；stash 改写为"金样板 + QA + L2 分级"）
  - 服务自动启动说明（upstream 用 `wink_button_enable_events`；stash 改为 `{name}_enable_events`）
  - JSON 示例的 `boot_button` 字段（upstream `auto_poll_ms`；stash 加 `event_drive` + `debounce_ms`）
  - 超声波设备名（upstream `smoke_ultrasonic`；stash `smoke_sonar`）
- **保留风险**：高 — 7 处冲突，每处都涉及**模板语义**（样板分级、API 命名约定、设备 ID 命名），没有 ADR 引用可仲裁
- **原作者**：user-surface phase 1 author + button-event-drive author
- **建议**：**丢弃**

## 文件 2：`docs/design/03-app-codegen/02-project-manifest-schema.md`

- **改动**：+15 / -0，纯新增内容（无 marker）
- **新增内容**：文件末尾「附录 A：`wink-app.json` 设备树（固件 App）与 button 事件字段」表
  - 引用 ADR-0031 / 0032
  - 字段表：`event_drive / auto_poll_ms / debounce_ms / wake_from_sleep`
  - BAL 命名：正 `wink_button_enable_events`，过渡 `events_start` deprecated
- **保留风险**：低 — 纯新增，无冲突。但需要确认 0031/0032 在 master 状态（之前已通过 commits `05f3cd6`/`bb16dd3` 等引用）
- **原作者**：button-event-drive author
- **建议**：可保留，但**必须由原作者 commit**，本 agent 跳过

## 文件 3：`docs/decisions/core/0022-event-queue-mbox-async-primitives.md`

- **改动**：+1 / -0，纯新增一行
- **新增**：2026-07-14 备注行，引用 ADR-0031/0032，说明本 ADR 与 button event 决策的关系
- **保留风险**：低 — 1 行说明性引用
- **原作者**：button-event-drive author
- **建议**：**可保留**（低风险），但应让作者 commit

## 文件 4：`docs/implementation-plans/core/2026-07-14-button-event-drive-backends-plan.md`

- **改动**：+20 / -28，文档微调（无 marker）
- **改写**：Goal/Architecture/Constraints/Steps 各 1-2 行，澄清：
  - BAL 命名从 `wink_button_events_start` 改为 `wink_button_enable_events`/`disable_events`（ADR-0032）
  - `events_start` 标为 deprecated alias
- **保留风险**：低-中 — 文档级微调，但与文件 5 (tech-design) 须保持一致
- **原作者**：button-event-drive author
- **建议**：**可保留**，但需配套提交文件 5

## 文件 5：`docs/tech-designs/core/2026-07-14-button-event-drive-backends.md`

- **改动**：+20 / -19，文档微调（无 marker）
- **改写**：版本 v1.1 → v1.2、状态/关联 ADR 字段、字段表 `debounce_ms` 说明（"0 = 保留 DAL 默认防抖窗口" 而非 "0 = 关闭防抖"）
- **保留风险**：低-中 — 与文件 4 配套
- **原作者**：button-event-drive author
- **建议**：**可保留**，但需配套提交文件 4

## 文件 6：`wink-micro-app/devkitc_smoke/CMakeLists.txt`

- **改动**：+8 / -2，1 对 conflict marker
- **冲突内容**：
  - upstream：手写 `add_custom_command`（~40 行）+ `${GEN_DEVICE_TREE_C}` 变量
  - stash：调 `wink_app_prepare_codegen(COMMENT_PREFIX "devkitc_smoke")` helper + `WINK_APP_GEN_DEVICE_TREE_C` 变量
- **保留风险**：高 — 这是**两个架构**的选择：自管 codegen vs 共享 helper。stash 依赖 `sample_common.cmake` 末尾新增的 `wink_app_prepare_codegen()` 函数（见文件 10）
- **关键依赖**：必须**配套提交**文件 10 (sample_common.cmake) 否则 stash 侧 CMake 立即 break
- **原作者**：button-event-drive author + devkitc_smoke 维护者
- **建议**：**丢弃**（本任务无 app 构建上下文）

## 文件 7：`wink-micro-app/devkitc_smoke/docs/device_tree_api.md`

- **改动**：+10 / -0，2 对 conflict marker
- **冲突内容**：
  - 设备 `smoke_ultrasonic` (upstream) vs `smoke_sonar` (stash)
  - 宏 `SMOKE_ULTRASONIC_USE_RMT / AUTO_POLL_MS` (upstream) vs `SMOKE_SONAR_USE_RMT` + `BOOT_BUTTON_DEBOUNCE_MS` (stash)
- **保留风险**：高 — 设备 ID 命名 + 派生宏名都是**契约**级改动
- **原作者**：button-event-drive author
- **建议**：**丢弃**

## 文件 8：`wink-micro-app/oled_dashboard/CMakeLists.txt`

- **改动**：+18 / -18，2 对 conflict marker
- **冲突内容**：同文件 6（自管 vs helper 架构选择）
- **保留风险**：高 — 与文件 6 同样需要 `sample_common.cmake` 配套
- **原作者**：button-event-drive author
- **建议**：**丢弃**

## 文件 9：`wink-micro-app/oled_dashboard/docs/device_tree_api.md`

- **改动**：+6 / -0，1 对 conflict marker
- **冲突内容**：OLED 设备类型 `mono_oled` (upstream) vs `ssd1306` (stash)
- **保留风险**：高 — 设备类型 ID 是**架构级**改动（涉及 codegen driver）
- **原作者**：button-event-drive author
- **建议**：**丢弃**

## 文件 10：`wink-micro-app/sample_common.cmake`

- **改动**：+78 / -0，纯新增（无 marker）
- **新增内容**：`wink_app_prepare_codegen()` 函数（约 78 行），封装 codegen 自定义命令 + Emscripten 早期执行
- **保留风险**：低 — 纯新增函数；但与文件 6/8 配套使用，**单独提交会破坏 oled_dashboard / devkitc_smoke 构建**
- **原作者**：button-event-drive author
- **建议**：**可单独保留**（如果作者选择只重构 helper，不立刻迁移到 app），但**风险**：未来用户使用 helper 时会遇到冲突 marker，必须先解决 6/8

## 文件 11-13：`.claude/worktrees/agent-*`（3 个 gitlink）

- **改动**：每个文件 +1 / -1（gitlink 指针变化）
- **状态**：
  - 当前主仓库 master HEAD 记录：`0e10cd2728de519cca52583dbc7a9fde11befa2b` (示例)
  - working tree 指向不同 commit
  - `git submodule status`: "fatal: no submodule mapping found in .gitmodules" — **孤儿 gitlink**
- **保留风险**：高 — 这是 Claude Code agent worktree 的实验性 commit，**未注册为 submodule**，commit 对其他用户无意义
- **原作者**：本机 Claude Code 实验
- **建议**：**丢弃**

---

## 三档建议

### 档 A：全部丢弃（一键解决）
```bash
git restore .
```
working tree 恢复 HEAD（80 个 dal-lint commits 全部在 HEAD），零冲突标记。**最安全**。

### 档 B：保留纯新增无 marker 文件（5 个） + 丢弃冲突（5 个）+ 丢弃 gitlink（3 个）
```bash
git restore \
  docs/design/03-app-codegen/01-app-business-logic.md \
  wink-micro-app/devkitc_smoke/CMakeLists.txt \
  wink-micro-app/devkitc_smoke/docs/device_tree_api.md \
  wink-micro-app/oled_dashboard/CMakeLists.txt \
  wink-micro-app/oled_dashboard/docs/device_tree_api.md \
  .claude/worktrees/agent-a530d095067dfbd16 \
  .claude/worktrees/agent-a728afde5171a5eaa \
  .claude/worktrees/agent-a9ff6ada9442e4b31
```
保留：02-project-manifest-schema / 0022-decision / 2026-07-14-plan / 2026-07-14-tech-design / sample_common.cmake（共 5 个 +78 ~ +95 行纯新增）。

**风险**：sample_common.cmake 单独提交会让未来尝试使用 `wink_app_prepare_codegen()` 的 PR 与文件 6/8 冲突 — 但本任务不解决这些。

### 档 C：什么都不做
保留 working tree 原状，用户后续手动处理。**风险**：用户可能在未察觉 conflict marker 的情况下 `git add -A` 把脏文件 commit 进 master。

---

## 推荐

**档 A**。一行 `git restore .` 立刻让 working tree 与 HEAD 一致，所有 risk 归零。13 个文件的内容由原作者在他们自己的 worktree 里重新 commit。

本任务（dal-lint TDD）已经 100% 完成，80 个 commits 全部 push 到 origin。剩余 working tree 改动是跨任务的**他人工作**残留。
