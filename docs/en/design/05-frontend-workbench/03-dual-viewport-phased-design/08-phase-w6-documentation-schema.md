# W6 Documentation Sync & Schema Finalization

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/08-phase-w6-documentation-schema.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W6 |
| Effort Estimate | ~0.5 days |
| Prerequisites | W5 Causal Chain MVP complete |
| Deliverables | Manifest schema v2 formal sync, Implementation plan archival, Navigation indexes, Migration script verification |
| Milestone | Design specs, implementation plans, and TypeScript types are 100% aligned |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §9–§10 |

---

## 1. Goals

1. Formally record `mechanical`, `environment`, and `bindings` sections into [`02-project-manifest-schema.md`](../../03-app-codegen/02-project-manifest-schema.md).
2. Align field naming across [`02-dual-viewport-product-world-layout.md`](../02-dual-viewport-product-world-layout.md) and all phased design documents.
3. Mark [`implementation-plans/2026-07-09-dual-viewport-layout-plan.md`](../../../implementation-plans/frontend/2026-07-09-dual-viewport-layout-plan.md) as Archived, pointing to this directory as the Execution SSOT.
4. Establish acceptance testing criteria for `manifest-migration.ts`.

---

## 2. Sync Checklist (D1~D8)

| # | Action | Target Document | Acceptance Criteria |
|---|---|---|---|
| D1 | Add §mechanical / §environment / §bindings chapters | `03-app-codegen/02-project-manifest-schema.md` | JSON schemas match W2 types |
| D2 | Add `schemaVersion: 2` migration rules | `02-project-manifest-schema.md` | Aligns with `manifest-migration.ts` |
| D3 | Update center workspace cross-references | `01-frontend-workbench-architecture.md` | Links valid |
| D4 | Update §15 implementation status | `02-dual-viewport-product-world-layout.md` | Links to phased-design |
| D5 | Add navigation index for `03-dual-viewport-phased-design/` | `docs/design/README.md` | Clickable links |
| D6 | Archive implementation plan v1.1 | `implementation-plans/2026-07-09-dual-viewport-layout-plan.md` | Status: Archived |
| D7 | Sync Wasm bridge contracts | `04-wasm-simulation/` | Aligns with W3c/W4 bridge tables |
| D8 | Record ADR evaluation conclusion | `00-master-plan.md` §9 | Accepted / Not needed |

---

## 3. Manifest Migration Acceptance Criteria

| Test ID | Input | Expected Output |
|---|---|---|
| M-01 | `schemaVersion: 1`, without `mechanical` | `schemaVersion: 2` with empty array sections |
| M-02 | `schemaVersion: 2`, missing `bindings` | Auto-completes `bindings: { actuators:[], sensors:[], displays:[] }` |
| M-03 | Unknown `schemaVersion: 99` | Throws readable user error |
| M-04 | v2 complete round-trip | `JSON.stringify` preserves all keys exactly |

---

## 4. Verification Criteria (A1~A6)

- **A1**: `02-project-manifest-schema.md` contains full Manifest v2 section specifications.
- **A2**: Zero field name discrepancies across schema specs, 02-layout, and W2 TypeScript types.
- **A4**: Implementation plan header points to `03-dual-viewport-phased-design/` as Execution SSOT.
- **A5**: Vitest tests for M-01~M-04 in `manifest-migration.ts` pass cleanly.
