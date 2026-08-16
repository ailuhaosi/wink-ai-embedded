# M1 — 契约文档化与架构护栏

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development` 或 `superpowers:executing-plans`。Steps 使用 checkbox。**前置：M0 出口已通过。**

**Goal:** 把「glyph / 外设包禁止直读 simulation-runtime 数据面」变成可自动检测的护栏；补齐模板 Checklist 与架构单测，为 M2 消除直读提供失败信号。

**Architecture:** 静态规则（ESLint `no-restricted-imports`）+ Vitest 架构测试双保险。M1 **允许**现有 OLED/舵机 glyph 仍直读——规则可先 `warn`，或架构测列出 known offenders 并在 M2 清零。不在本阶段完成 binder 插件化。

**Tech Stack:** ESLint flat config、Vitest、既有 `peripherals/__tests__/template-contract.test.ts`。

## Global Constraints

- 继承 roadmap Global Constraints。
- **不**删除 `bind*` 的 `switch`（属 M2）。
- **不**改 inject / observeDisplay（属 M3/M4）。
- 允许 M1 以 `warn` 落地 lint；M2 出口前必须升为 `error` 或架构测强制失败。

---

## 1. 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260712-SIM-OBS-M1` |
| **创建日期** | `2026-07-12` |
| **计划状态** | ✅ 已完成（Task 1.4 全量回归通过） |
| **优先级** | 🟡 P1 |
| **前置依赖** | [`m0-adr-and-docs.md`](./m0-adr-and-docs.md) |
| **后继** | [`m2-ui-bind-pluginization.md`](./m2-ui-bind-pluginization.md) |

---

## 2. 背景与目标

### 2.1 现状违规锚点（必须被护栏看见）

| 文件 | 违规 |
|------|------|
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/oled/CanvasGlyph.vue` | `import { oledFb } from '@/services/simulation-runtime'` |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/servo/CanvasGlyph.vue` | `import { actuatorObservations } from '@/services/simulation-runtime'` |

合法例外（护栏**不要**误杀）：

- `services/simulation-client.ts`、`simulation-runtime.ts` 自身
- `views/EmbeddedWorkbench.vue`（宿主总线，M3 前仍可持有 inject）
- `components/workbench/SimActuatorPanel.vue`（面板允许读 ③ SSOT；可选后续改为注入，非本阶段强制）

### 2.2 验收出口

| # | 指标 | 通过标准 |
|---|------|----------|
| A1 | 架构测存在 | `peripherals/__tests__/architecture-data-plane.test.ts`（或等价路径）可运行 |
| A2 | 能检出直读 | 测试文档化 known offenders ≥ 2（oled + servo）；或 lint warn 命中这两处 |
| A3 | 模板契约 | `_template` / Checklist 提及「禁止 import simulation-runtime 数据面」 |
| A4 | 测试全绿 | `cd ../../../../../wink-ai/packages/embedded-frontend && bun run test` |
| A5 | lint 可跑 | `npm run lint` 不因新规则配置错误而崩溃 |

---

## 3. 文件变更清单

| 文件路径 | 变更类型 | 说明 |
|----------|----------|------|
| `../../../../../wink-ai/packages/embedded-frontend/eslint.config.js` | ✏️ | `files: ['src/peripherals/**']` 限制 import `simulation-runtime` |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/architecture-data-plane.test.ts` | 🆕 | 扫描直读 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/CanvasGlyph.vue` | ✏️ | 注释强调经 props 消费 |
| `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/template-contract.test.ts` | ✏️ | 可选：断言模板无 runtime import |
| `docs/design/05-frontend-workbench/04-adding-a-peripheral.md` | ✏️ | 验收节引用护栏命令 |

---

## 4. Tasks

### Task 1.1: 写失败/基线架构测试

**Files:**
- Create: `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/architecture-data-plane.test.ts`

- [ ] **Step 1: 添加测试文件**

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PERIPH_ROOT = path.resolve(__dirname, '..');

/** Packages under peripherals/<type>/ that must not import simulation-runtime. */
function listVueAndTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listVueAndTsFiles(full));
    else if (/\.(vue|ts)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const RUNTIME_IMPORT_RE =
  /from\s+['"]@\/services\/(simulation-runtime|simulation-client)['"]|from\s+['"]\.\.\/.*(simulation-runtime|simulation-client)['"]/;
const ESLINT_DISABLE_RE = /\/\*\s*eslint-disable(?:[^*]|\*(?!\/))*\*\//; // 扫描禁用注释，防绕过

describe('architecture: peripheral packages must not import simulation-runtime or simulation-client', () => {
  it('documents current offenders (M1 baseline; M2 must clear)', () => {
    const files = listVueAndTsFiles(PERIPH_ROOT).filter((f) => {
      const rel = path.relative(PERIPH_ROOT, f).replace(/\\/g, '/');
      // allow tests, registry, types, observe-builder at package root helpers
      return rel.includes('/');
    });

    const offenders = files.filter((f) => {
      const code = fs.readFileSync(f, 'utf8');
      return RUNTIME_IMPORT_RE.test(code) || ESLINT_DISABLE_RE.test(code);
    });
    const rel = offenders.map((f) => path.relative(PERIPH_ROOT, f).replace(/\\/g, '/')).sort();

    // M1: lock the known debt so regressions are visible
    expect(rel).toEqual([
      'oled/CanvasGlyph.vue',
      'servo/CanvasGlyph.vue',
    ]);
  });
});
```

- [ ] **Step 2: 运行测试确认基线通过**

```bash
cd ../../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/peripherals/__tests__/architecture-data-plane.test.ts
```

Expected: PASS（恰好两个 offender）。

若还有其它文件命中，先扩 baseline 列表并在本计划记录，M2 一并清除。

- [ ] **Step 3: Commit**

```bash
git add ../../../../../wink-ai/packages/embedded-frontend/src/peripherals/__tests__/architecture-data-plane.test.ts
git commit -m "$(cat <<'EOF'
test: baseline peripheral simulation-runtime import offenders

EOF
)"
```

---

### Task 1.2: ESLint 护栏（warn）

**Files:**
- Modify: `../../../../../wink-ai/packages/embedded-frontend/eslint.config.js`

- [ ] **Step 1: 增加 peripherals 作用域规则**

在 `antfu(...)` 配置数组末尾追加：

```javascript
  {
    files: ['src/peripherals/**/*.{vue,ts}'],
    ignores: [
      'src/peripherals/__tests__/**',
      // root helpers may stay free; tighten in M2 if needed
      'src/peripherals/registry.ts',
      'src/peripherals/types.ts',
      'src/peripherals/observe-builder.ts',
      'src/peripherals/index.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'warn', // M2 exit: change to 'error' after offenders cleared
        {
          paths: [
            {
              name: '@/services/simulation-runtime',
              message:
                'Peripheral packages must consume SimViewContext via definition.ui binders (ADR-0027). Do not import simulation-runtime.',
            },
            {
              name: '@/services/simulation-client',
              message:
                'Peripheral packages must communicate via declarative apis or context, not via simulation-client (ADR-0027).',
            },
          ],
          patterns: [
            {
              group: ['**/services/simulation-runtime', '**/simulation-runtime'],
              message:
                'Peripheral packages must consume SimViewContext via definition.ui binders (ADR-0027).',
            },
            {
              group: ['**/services/simulation-client', '**/simulation-client'],
              message:
                'Peripheral packages must not direct import simulation-client (ADR-0027).',
            },
          ],
        },
      ],
    },
  },
```

- [ ] **Step 2: 运行 lint**

```bash
cd ../../../../../wink-ai/packages/embedded-frontend && bun run lint
```

Expected: 配置成功；oled/servo 可出现 warn（不阻塞若 CI 未把 warn 当失败）。

- [ ] **Step 3: Commit**

```bash
git add ../../../../../wink-ai/packages/embedded-frontend/eslint.config.js
git commit -m "$(cat <<'EOF'
chore(lint): warn peripherals against importing simulation-runtime

EOF
)"
```

---

### Task 1.3: 模板与文档提示

**Files:**
- Modify: `../../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/CanvasGlyph.vue`
- Modify: `docs/design/05-frontend-workbench/04-adding-a-peripheral.md`（验收节）

- [ ] **Step 1: 模板注释**

在 `_template/CanvasGlyph.vue` script 顶部增加：

```vue
<!--
  Do NOT import @/services/simulation-runtime.
  Receive pinStates / framebuffer / angle via props from definition.ui.canvasProps.
-->
```

- [ ] **Step 2: 文档验收增加命令**

```bash
cd ../../../../../wink-ai/packages/embedded-frontend && bunx vitest run src/peripherals/__tests__/architecture-data-plane.test.ts
```

说明：M2 完成后该测试应变为 `expect(rel).toEqual([])`。

- [ ] **Step 3: Commit**

```bash
git add ../../../../../wink-ai/packages/embedded-frontend/src/peripherals/_template/CanvasGlyph.vue \
  docs/design/05-frontend-workbench/04-adding-a-peripheral.md
git commit -m "$(cat <<'EOF'
docs: note data-plane binder rule in peripheral template

EOF
)"
```

---

### Task 1.4: 全量回归

- [x] **Step 1:** `cd ../../../../../wink-ai/packages/embedded-frontend && bun run test`
- [x] **Step 2:** 更新 roadmap：勾选 M1 出口。

---

## 5. 风险与回滚

| 风险 | 缓解 |
|------|------|
| lint patterns 误杀相对路径 | 先只禁 `@/services/simulation-runtime` path |
| SimActuatorPanel 被误扫 | 规则 `files` 限定 `src/peripherals/**` |
| CI 将 warn 当 error | M1 保持 warn；确认 CI 配置 |

**回滚：** 删除架构测与 eslint 块；恢复模板注释。

---

## 6. 文档变更记录

- 2026-07-12：初稿。
- 2026-07-12：Task 1.4 全量回归通过，M1 计划状态更新为已完成。
