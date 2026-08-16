# embedded-frontend 架构重构 Implementation Plan

> **For agentic workers:** Execute phase-by-phase with a checkpoint after each phase. Prefer inline execution in one session for W0–W1; stop for human review between phases. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 [架构评审报告](../../reviews/frontend/embedded-frontend-architecture-review.md) 的修订路线，分阶段消除上帝文件、双写 SSOT、仿真双源、工程基建与魔法值债，且不伤仿真热路径。

**Architecture:** Manifest 为持久 SSOT、画布为派生视图；仿真控制面进 Pinia、数据面 shallowRef；UI 单轨（删除 `VITE_LEGACY_SIM_TAB`）；常量/协议类型化随重构落地。

**Tech Stack:** Vue 3.5 + Vite 8 + TypeScript 6 + Pinia 3 + Vitest 4；ESLint (`@antfu/eslint-config`) + Prettier + simple-git-hooks。

**Spec:** `docs/reviews/frontend/embedded-frontend-architecture-review.md` §7–§9

## Global Constraints

- 不与「大拆分」同 PR 做全量 Prettier 格式化（W0 Lint 可先 warn；格式化可限新改文件）
- 仿真 `oledFb` / `pinStates` / `traces` **禁止** ~60Hz 整包写入 Pinia deep state
- 容器组件可读 store；展示组件用 props；跨域写走 store actions
- 业务魔法数字/跨模块魔法字符串必须具名常量（见评审 §4.9 / §8.8）
- 每阶段结束：`npm test` + `npm run build` 必须通过
- 不提交 `.env`、secrets、`node_modules`、`dist/`
- Commit message 英文；仅在用户要求时 commit

---

## Phase map

| Phase | 主题 | 验收 |
|-------|------|------|
| **W0** | 工程基建 + Worker 协议类型 + 契约测试骨架 | lint/test/build 脚本可用；协议类型存在；mode/manifest 契约测试绿灯 |
| **W1** | SSOT 写路径 + 拆 Workbench + 删 UI Legacy + PowerRail/OLED/Mode 常量 | 无 `VITE_LEGACY_SIM_TAB` 分支；Workbench &lt; ~400 行；SSOT 测试通过 |
| **W2** | 拆 `useCircuitCanvas` + template ref | composable 目录化；无 `querySelector('.circuit-svg')`；拖放相关单测 |
| **W3** | 仿真分层 + 可恢复错误 UI + 仿真常量 | 控制面仅 store；数据面 runtime；错误可重试 |
| **W4** | flag sunset + TS 渐进严格 + i18n 二选一 + token（可选） | legacy routing / 过期 gate 有 sunset 或删除 |

---

## Phase W0 — 工程基建与契约安全网

### Task W0.1: ESLint + Prettier + scripts

**Files:**
- Create: `../../../../wink-ai/packages/embedded-frontend/eslint.config.js`
- Create: `../../../../wink-ai/packages/embedded-frontend/.prettierrc`
- Create: `../../../../wink-ai/packages/embedded-frontend/.prettierignore`
- Modify: `../../../../wink-ai/packages/embedded-frontend/package.json`

- [x] **Step 1:** 安装依赖
- [x] **Step 2:** 写入 `eslint.config.js`
- [x] **Step 3:** 写入 `.prettierrc` / `.prettierignore`；scripts + hooks
- [x] **Step 4:** `npx simple-git-hooks`；lint 配置可加载

### Task W0.2: CI workflow

- [x] **Step 1:** `.github/workflows/embedded-frontend-ci.yml`
- [x] **Step 2:** 本地 `typecheck` + `test` + `build` 通过

### Task W0.3: Worker 协议类型模块

- [x] **Step 1:** `src/types/sim-worker-protocol.ts`
- [x] **Step 2:** golden tests
- [x] **Step 3:** client/worker 对齐类型

### Task W0.4: 契约测试 — mode + manifest↔canvas

- [x] **Step 1:** confirmPendingSwitch → stopAndClear
- [x] **Step 2:** commitCanvasSnapshot 幂等 roundtrip
- [x] **Step 3:** `npm test` 全绿（120）

### Task W0.5: 清理脚手架

- [x] **Step 1:** 删除 `HelloWorld.vue`
- [x] **Step 2:** W0 验收通过

**Checkpoint W0:** 人工确认后再进 W1。

---

## Phase W1 — SSOT + Workbench 拆分 + 删 Legacy UI

### Task W1.1: 常量模块（PowerRail / OLED / WorkbenchMode）

- [x] Create `constants/power-rail.ts`, `oled.ts`, `workbench-mode.ts`
- [x] Wire call sites (peripheral-pins, project.store, net-pin-resolver, manifest-to-canvas, useCircuitCanvas, workbench-mode.store)

### Task W1.2: SSOT 写路径

- [x] `commitCanvasSnapshot` alias + Workbench uses it

### Task W1.3–W1.4: 抽取子组件 + 删除 Legacy

- [x] `WorkbenchPropertyInspector.vue` / `WorkbenchFaultInjector.vue` / `OledFrameBufferRenderer.vue`
- [x] `EmbeddedWorkbench.vue` ~678 行，无 `legacyMode` / `VITE_LEGACY_SIM_TAB`
- [x] `.env.example` / `vite-env.d.ts` 清理

**Checkpoint W1:** 人工确认后再进 W2。

---

## Phase W2 — useCircuitCanvas 拆分

- [x] `composables/canvas/` 模块化（viewport/layout/drag/power/wire）
- [x] `circuitSvgRef` template ref 替代 `querySelector('.circuit-svg')`
- [x] `useCircuitCanvas.ts` 薄 re-export
- [x] `useCanvasViewport` 单测；全量 123 tests / typecheck / build 通过

**Checkpoint W2:** 人工确认后再进 W3。

---

## Phase W3 — 仿真分层 + 错误 UI

- [x] `constants/simulation.ts`（`SIM_UI_TICK_MS` / `MAX_SIM_LOG_ENTRIES`）
- [x] `simulation-runtime.ts` shallowRef 数据面；store 仅控制面
- [x] `simulation-client` 传输层 + `bindSimulationControl`
- [x] ErrorBoundary / SimulationErrorBanner / `errorHandler`
- [x] runtime + store 单测；全量 test / typecheck / build 通过

**Checkpoint W3:** 人工确认后再进 W4。

---

## Phase W4 — 收尾债

- [x] legacy wire routing rollback 删除（`VITE_LEGACY_WIRE_ROUTING` / URL param）；HCTR 失败 fallback 保留
- [x] `MANIFEST_SCHEMA_V2` gate 移除，绑定校验与机械/环境面板始终启用
- [x] TS `noUnusedLocals` 渐进：`tsconfig.strict-dirs.json` 覆盖 `constants/` + `types/`
- [x] i18n 补全（canvas 旋转、资产库 desc）并在组件中使用

**Checkpoint W4 / Done.**

---

## Out of scope (explicit)

- Vue Router（P3，无多页面需求不做）
- 全量 Prettier 重写历史文件
- 把 OLED 帧缓冲镜像进 Pinia
- 一次开启全仓库 TS strict 导致无法合入
- **外设插件化 / 注册表**（另见 [`2026-07-10-peripheral-plugin-registry-plan.md`](../core/2026-07-10-peripheral-plugin-registry-plan.md)；建议 W3 之后执行 P0–P3）

---

## Execution note

当前会话从 **W0** 开始执行；每完成一 Phase 汇报验收结果并等待确认进入下一 Phase（用户若说「继续」则进入下一 Phase）。

