# Hardware Timer & PWM Semantics

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/09-timer-and-pwm-semantics.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Partial**: Channel 1b PWM duty bypass (`pal_pwm_set_duty` $\rightarrow$ `js_pal_pwm_set_duty`) is **Landed**; `pal_hwtimer_*` hardware contract ([ADR-0047](../../../decisions/core/0047-foc-isr-layering-and-pal-hwtimer.md)) & FOC soft-stepping are **Partial ~ Planned**; Generic HW capture channel is **Planned** |
| Supporting Axis | **C (primary)**; Division with Axis B (Timebase) defined in [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) |
| Associated Code | `wink-micro-os/targets/wasm/pal_hal_wasm.c` (`pal_pwm_*` / `pal_gpio_pulse_in`), `wink-micro-os/targets/wasm/wasm_bridge.h` (`js_pal_pwm_set_duty`), `wink-micro-os/targets/common/` (Planned plant partition, FOC), ADR-0047 contract surface |
| Last Audit | 2026-08-11 Amend (PWM reclassified as Channel 1b Timing Modulation) |
| Governing ADRs | 0047, 0003, 0002 |
| Migrated From | `04-wasm-simulation-2.0/09-channel-routing.md` §1.4 / §5.3 |

> This document serves as the **primary home** for Axis C (Timer Hardware Semantics): HW timers, PWM periods, capture, soft stepping, `pal_hwtimer`, and FOC fast-loop behavioral boundaries.

---

## 1. Timebase vs Timer Hardware Semantics (Axis B vs Axis C)

| Dimension | Axis B Timebase | Axis C Timer Hardware Semantics |
|---|---|---|
| Question Addressed | Reference clock for delays / timeouts / pulses | Behavior of hardware timers, PWM periods, capture, and periodic ISRs |
| SSOT | `s_virtual_us` + Single Gate ([`02-virtual-clock.md`](./02-virtual-clock.md)) | PAL timer / PWM / (Planned) `pal_hwtimer` semantic contracts |
| Simulation Technique | Fast-forwarding, absolute `wakeup_us`, zero-yield loopback | Duty percentage bypass, soft-stepping fast loops, resource exclusion gates |
| Model Upper Bound | Non-wallclock real-time | **No** 10kHz+ hard ISRs; No physical PWM–ADC hardware trigger synchronization |

```text
┌─ App/BAL/DAL ───────────────────────────────────────┐
│  Periodic tasks, timeouts, pulse math (pal_os_get_us)│
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL Soft Timebase / Cooperative Scheduler (Axes B/E)─┐
│  pal_os_sleep_ms, soft timers, scheduler wakeup_us   │  ← Landed
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL PWM / Modulation Semantics (Channel 1b)─────────┐
│  pal_pwm_set_duty(channel, percent) → notifyDuty    │  ← Landed (L2 duty)
│  Does not simulate carrier edges or dead-time       │
└───────────────────────────┬──────────────────────────┘
                            ▼
┌─ PAL Hardware Timers (FOC, ADR-0047)─────────────────┐
│  pal_hwtimer_* physical contract Landed; sim =       │  ← Contract Landed
│  Deterministic soft stepping, bans wallclock/rand    │    Sim Impl Partial
└──────────────────────────────────────────────────────┘
```

---

## 2. FOC Fast Loops & PWM (ADR-0047)

SimpleFOC local control loops (10kHz ISR / PWM–ADC sync / `pal_hwtimer`) execute in simulation as **virtual-time-driven deterministic soft-stepping**: the caller steps the control loop $N = f_{\text{ctrl}} / 1000$ times per virtual millisecond, **strictly banning wallclocks and `rand()`**. Hardware PWM–ADC triggering degrades to synchronous plant reads at the end of each soft step.

Hardware vs Simulation Degradation:

| Physical Hardware | Simulation Environment |
|---|---|
| 10kHz+ Hard Timer ISR | Deterministic virtual-time soft-stepping |
| PWM TRGO / Underflow Triggers ADC | Synchronous plant sampling at step boundaries |
| IRAM / Xtensa ISR FPU constraints | Cooperative single core; constraints omitted |

---

## 3. Behavioral Semantics Summary (Axis C Bounds)

| Topic | Simulation Behavior | Upper Bound / Honest Status |
|---|---|---|
| PWM Duty (L2) | `pal_pwm_set_duty` $\rightarrow$ JS `notifyDutyChange`; plugins read duty percent | **No** carrier edge, dead-time, or center-aligned simulation; routing in [`08`](./08-channel-routing.md) §2.3 |
| Soft-Stepping Fast Loops | $N$ steps per virtual ms; bans wallclocks and `rand()` | **No** 10kHz+ hard ISRs |
| Pulse Capture | `pal_gpio_pulse_in` + Pin Event Queue | Generic HW capture abstraction is **Planned** |
| Resource Conflicts | PWM router / (Planned) `pal_hwtimer` gates | Behavioral alignment without cycle-accurate clock drift |
| `pal_hwtimer` | ADR-0047 contract; simulation = virtual-time stepping | Simulation implementation is **Partial ~ Planned** |
