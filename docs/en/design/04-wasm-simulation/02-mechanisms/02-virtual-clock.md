# Virtual Clock Engine Mechanism

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/02-virtual-clock.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (`s_virtual_us` SSOT, Single Gate, Headless fast-forward) |
| Supporting Axis | **B (primary)** (Timebase) |

---

## 1. Core Principles

1. **`s_virtual_us` as Sole SSOT**: All firmware clock lookups (`pal_time_get_us()`, timeouts) read this value, isolated from host wallclock time (`Date.now()`).
2. **Single Gate Control**: The only authorized point to advance time is `wink_vclock_advance_internal`. `pal_delay` dual-stepping is strictly forbidden.
3. **Headless Fast-Forwarding**: Advances virtual time directly to the next scheduled event in CI environments.
