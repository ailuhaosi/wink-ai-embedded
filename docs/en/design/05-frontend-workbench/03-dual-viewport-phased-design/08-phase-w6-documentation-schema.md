# W6 Documentation Backport & Schema Closure

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
| Prerequisites | W5 Causal Chain MVP complete (W4 can run in parallel with W5, but W6 requires all phase acceptances to pass) |
| Deliverables | Manifest schema v2 formal backport, Implementation plan synchronization, Navigation indexes, Migration script specifications |
| Milestone | Design specifications / Implementation plan / TypeScript types are 100% consistent |
| Master Plan Ref | [00-master-plan.md](./00-master-plan.md) §9–§10 |

---

## 1. Goals

1. Formally record the `mechanical` / `environment` / `bindings` defined in W2 into [`02-project-manifest-schema.md`](../../03-app-codegen/02-project-manifest-schema.md).
2. Synchronize field naming across [`02-dual-viewport-product-world-layout.md`](../02-dual-viewport-product-world-layout.md) §8 and phased design documents (adhering strictly to schema specifications).
3. Mark [`implementation-plans/2026-07-09-dual-viewport-layout-plan.md`](../../../implementation-plans/frontend/2026-07-09-dual-viewport-layout-plan.md) as **Archived**, pointing to this directory as the Execution SSOT.
4. Define acceptance standards for `manifest-migration.ts` (implemented starting in W2, accepted in W6).
5. Evaluate and record whether Three.js domain boundaries require a new ADR.

---

## 2. Backport Checklist

| # | Action | Target Document | Acceptance |
|---|---|---|---|
| D1 | Add formal §mechanical / §environment / §bindings chapters | `03-app-codegen/02-project-manifest-schema.md` | JSON examples match W2 types |
| D2 | `schemaVersion: 2` migration notes + v1 $\rightarrow$ v2 rules | Same as above §Migration | Matches `manifest-migration.ts` behavior |
| D3 | Update center workspace description + phased design links | `01-frontend-workbench-architecture.md` | Cross-references valid |
| D4 | Update §15 implementation status to Completed | `02-dual-viewport-product-world-layout.md` | Links to phased-design |
| D5 | Add navigation entry for `03-dual-viewport-phased-design/` | `docs/design/README.md` | Clickable |
| D6 | Implementation plan v1.1: W3 $\rightarrow$ W3a/b/c, points to SSOT | `implementation-plans/2026-07-09-dual-viewport-layout-plan.md` | Status Archived |
| D7 | Wasm bridge contract backports (if W3 spike reaches conclusion) | `04-wasm-simulation/` or `tech-designs/` | Matches W3c/W4 bridge tables |
| D8 | Record ADR evaluation conclusion | `00-master-plan.md` §9 or new ADR | Accepted / Not needed |

---

## 3. Schema Backport Outline

When backporting to `02-project-manifest-schema.md`, the following must be included (field names strictly follow [00-master-plan.md](./00-master-plan.md) §10):

### 3.1 Top-Level

- When `schemaVersion: 2`, three optional sections are supported: `mechanical`, `environment`, `bindings`.
- When loading v1 projects, these three sections default to empty objects/arrays without breaking execution.

### 3.2 `mechanical`

- `parts[]`: `partId`, `modelId`, `displayName`, `parentPartId?`, `transform`, `physics`
- `joints[]`: `jointId`, `type`, `parentPartId`, `childPartId`, `axis`, `limits?`

### 3.3 `environment`

- `props[]`: `propId`, `modelId`, `transform`, `physics?`, `properties?` (e.g. heat source `coreTemperatureC`)
- `fields[]`: `fieldId`, `type`, `valueC` (thermal field), `falloff?`, `falloffRadiusM?`, `region?`

> **Note**: Early draft phase documents used `intensity` for environmental temperature; **the formal schema standardizes on `valueC`** (consistent with upstream 02 layout specification).

### 3.4 `bindings`

- `actuators[]`: `bindingId`, `deviceComponentId`, `pin`, `mechanicalJointId?`, `mechanicalPartId?`, `mapping`
- `sensors[]`: `bindingId`, `deviceComponentId`, `mechanicalPartId?`, `environmentPropId?`, `mapping`
- `displays[]`: `bindingId`, `deviceComponentId`, `mechanicalPartId?`, `mapping`

### 3.5 Binding Validation Rules

Backport B-01 through B-08 (including B-07 extensions, see W2 §3.2).

---

## 4. `manifest-migration.ts` Acceptance Standards

| Test Case | Input | Expected Output |
|---|---|---|
| M-01 | `schemaVersion: 1`, without `mechanical` | `schemaVersion: 2`, three sections populated with empty arrays |
| M-02 | `schemaVersion: 2`, missing `bindings` | Auto-completes `bindings: { actuators:[], sensors:[], displays:[] }` |
| M-03 | Unknown `schemaVersion: 99` | Throws human-readable error |
| M-04 | v2 complete sample round-trip | Key fields unchanged after `JSON.stringify` |

Implementation location: `../../../../../wink-ai/packages/embedded-frontend/src/services/manifest-migration.ts` (created in W2, accepted in W6).

---

## 5. Implementation Plan Archival Template

Append to the header of `2026-07-09-dual-viewport-layout-plan.md`:

```markdown
> **Archival Notice (2026-07-09)**: Execution details have been deconstructed into
> [`03-dual-viewport-phased-design/`](../../../README.md).
> This document is retained for historical background and effort rollups; **the phased design directory serves as the SSOT**.
```

Plan status updated to: `📦 Archived (v1.1) -> see phased-design`.

---

## 6. ADR Assessment (Three.js Domain Boundaries)

| Question | Options | Recommendation |
|---|---|---|
| Is ADR-00XX required? | A. Not needed (already covered by ADR-0009 dual-domain model) | **Default to A** |
| | B. New ADR defining JS 3D domain / Wasm domain import whitelist | Open only if W3 spike reveals new architectural boundaries |

Evaluation conclusion recorded in D8; if B is chosen, W6 blocks on ADR Accepted.

---

## 7. Acceptance Criteria

| # | Acceptance Item | Validation Method |
|---|---|---|
| A1 | `02-project-manifest-schema.md` contains full definitions of the three v2 sections | Manual comparison with W2 types |
| A2 | Zero field name discrepancies across three documents (schema / 02-layout / W2 types) | diff inspection |
| A3 | `docs/design/README.md` includes phased-design navigation | Valid links |
| A4 | Implementation plan archived and points to phased-design | Review header |
| A5 | `manifest-migration` Vitest M-01 through M-04 pass cleanly | `npm run test` |
| A6 | ADR evaluation conclusion recorded | 00 §9 or `decisions/` |

---

*Document Revision History:*

- 2026-07-09: Initial creation (Review patch checklist #7).
