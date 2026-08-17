# Axis B — Timebase

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/B-timebase.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Tier | Ⅱb Thin Index |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Canonical Definition | [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) |

## 1. Questions Answered

Who acts as the clock for delays, timeouts, and pulse widths?

## 2. Primary Mechanism

- [`../02-mechanisms/02-virtual-clock.md`](../02-mechanisms/02-virtual-clock.md) — `s_virtual_us` SSOT, Single Gate, Headless fast-forwarding.

## 3. Secondary Mechanisms

- Execution modes & fast-forwarding → [`../02-mechanisms/01-sandbox-and-execution.md`](../02-mechanisms/01-sandbox-and-execution.md)
- `timing` Accuracy Mode evidence weight → [`../02-mechanisms/11-accuracy-observation-lifecycle.md`](../02-mechanisms/11-accuracy-observation-lifecycle.md)

## 4. Typical Bounds & Constraints

1. **Model Upper Bound**: Timings are anchored to virtual microseconds, not tied to host wallclock time.
2. **Single Gate**: `pal_delay_*` must not advance `s_virtual_us` autonomously.
3. **Division with Axis C**: Axis B answers "who is the clock", while Axis C answers HW timers & PWM semantics.
