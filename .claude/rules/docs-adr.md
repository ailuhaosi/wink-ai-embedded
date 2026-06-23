---
paths:
  - "**/*.md"
---

# Markdown Documentation & Architecture Decision Record (ADR) Standards

Guidelines and rules for writing, refactoring, and maintaining documentation and architecture decision records.

## 1. Document Categories and Placement

Our design documentation is organized into three distinct categories under `docs/design/` as defined in [CLAUDE.md](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/CLAUDE.md):

- **Design Specifications** (`01-system-overall/`, `02-wink-micro-os/`, `03-bal-codegen/`, `04-wasm-simulation/`, `05-frontend-workbench/`, `06-build-toolchain/`, `07-platform-governance/`):
  - These represent the "living specifications" and the current source of truth for the codebase.
  - Directly edit these documents to reflect the actual and current system behaviors.
- **Review Records** (`reviews/`):
  - Datestamped, time-slice snapshots of system audits (e.g. `2026-06-22-architecture-review.md`).
  - Read-only once finalized and committed. Never edit historic reviews.
- **Architecture Decision Records (ADRs)** (`decisions/`):
  - Capture major design trade-offs, options considered, and final selections (e.g., `0001-error-code-sign-convention.md`).
  - Sequentially numbered (four digits starting at `0001-`).

## 2. Decision Backporting (Single Source of Truth)

**Critical Convention:** Whenever an ADR transitions to **Accepted**, the decision details, API layouts, and specifications **MUST** be backported and updated in the corresponding active `01~07` design specifications immediately. An ADR is a history log; the active specs must always represent the latest system design.

## 3. ADR Structure and Lifecycle Logs

All ADRs must adhere to the following structure:
- A header block with a metadata table:
  ```markdown
  # ADR-XXXX：[Title in Chinese]

  | 项 | 内容 |
  |---|---|
  | 状态 | **[Proposed（提议中） / Accepted（已采纳） / Rejected（已拒绝）]** |
  | 日期 | YYYY-MM-DD |
  | 触发 | [Reason / Reference review report] |
  | 影响范围 | [Impacted layers] |
  | 决策者 | [Decision makers] |
  ```
- Sections:
  - **背景（Context）**: Why the decision is needed, problems with current designs.
  - **方案比选（Options）**: Alternatives evaluated with pros/cons.
  - **决策结论（Decision）**: The recommended option and justifications.
  - **后果与约束（Consequences & Constraints）**: Side effects, migration efforts, and code generation guidelines.
  - **遵循与后续（Compliance & Follow-up）**: Action items for backporting.
- **Status Change Log (底部状态变更日志)**: Place this at the very bottom of the document to record transitions:
  ```markdown
  ---

  *本 ADR 状态变更请在此记录：*
  - YYYY-MM-DD：Proposed（[Details]）
  - YYYY-MM-DD：Accepted（[Details / Decision maker]）
  ```

## 4. Checking ADR Statuses

To manage and inspect ADR statuses, run the helper script:
- **Default (List proposed/pending decisions)**:
  ```bash
  python docs/design/decisions/scripts/list_adrs.py
  ```
- **List all ADRs (Overview table)**:
  ```bash
  python docs/design/decisions/scripts/list_adrs.py -a
  ```
- **Filter by specific status** (e.g., `Accepted`):
  ```bash
  python docs/design/decisions/scripts/list_adrs.py -s Accepted
  ```

*On Windows, you can also double-click [list_adrs.bat](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/scripts/list_adrs.bat) in file explorer to quickly check pending decisions.*



