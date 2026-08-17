# Axis C — Hardware Timer Semantics

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/C-timer-semantics.md
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

HW timers, PWM periods, and capture.

## 2. Primary Mechanism

- [`../02-mechanisms/09-timer-and-pwm-semantics.md`](../02-mechanisms/09-timer-and-pwm-semantics.md) — Soft-step approximation, duty cycle, capture, `pal_hwtimer`, and FOC behavioral boundaries.

## 3. Secondary Mechanisms

- PWM as Channel 1b routing → [`../02-mechanisms/08-channel-routing.md`](../02-mechanisms/08-channel-routing.md)
- Physical FOC / `pal_hwtimer` layering contract → [ADR-0047](../../../decisions/core/0047-foc-isr-layering-and-pal-hwtimer.md)

## 4. Typical Bounds & Constraints

1. **Model Upper Bound**: No chip-level 10kHz+ hard timer ISR; no hardware PWM-ADC trigger synchronization.
2. **PWM L2**: `pal_pwm_set_duty` routes duty percentage; dead-time and center-alignment are not cycle-accurate.
3. **FOC / Fast Loops**: Deterministic virtual-time soft stepping (no wallclock/`rand()`).
