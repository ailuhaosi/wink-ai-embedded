# Phase 1 Implementation Plan Review: User Surface + DAL Semantic Freeze

> Independent technical review of [2026-07-28-user-surface-phase1-plan.md](../../implementation-plans/frontend/2026-07-28-user-surface-phase1-plan.md),
> grounded in code facts (dal_encoder.h / dal_dc_motor.h / dal_rc_servo.h / codegen drivers).

**Reviewer:** Senior Embedded Expert
**Date:** 2026-07-28
**Type:** Implementation Plan Review (Doc Layer 4)
**Status:** Findings should be backfilled into plan SS5 Risk; adopted items update plan Tasks or Global Constraints.

---

## 1. Executive Summary

**Direction correct, breakage window well-identified.** The plan's core judgment
-- "freeze ABI semantics that would pierce through Role abstraction before the
breakage window closes" -- is accurate. Fail-closed strategy (pwm_on_in ->
UNSUPPORTED), additive-field default-value compatibility, and the no-board-template
boundary are all sound.

**But 2 correctness/safety defects must be fixed (SS2.1, SS2.2)**, plus several
execution-order dependencies and architecture omissions.

| Severity | Count | Core Issues |
|----------|-------|-------------|
| RED P0: Correctness/Safety | 2 | dc_motor enum name conflicts with reality; safe_off x enable_pin undefined |
| ORANGE P1: Blocks execution | 2 | lint error rule lands before Role; sim target adaptation missing |
| YELLOW P2: Robustness | 5 | Test depth, sentinel risk, semantic ambiguity, naming system, ABI regression guard |
| BLUE P3: Governance/Process | 3 | Missing ADR closure for rulings; verification lacks mechanical evidence; override wire stance |

---

## 2. RED P0: Must Fix Before Execution

### 2.1 dc_motor drive_mode Enum Name Contradicts Current Topology

**Problem:** Task A3 defines DAL_DC_MOTOR_MODE_PHASE_ENABLE = 0 annotated as
"today's wiring" (plan:176-177). But the current dal_dc_motor_config_t
(dal_dc_motor.h:20-26) topology is **pwm_channel + dir_pin_a + dir_pin_b** --
this is an **IN/IN (dual-input) H-bridge**: PWM controls magnitude, two direction
pins IN_A/IN_B control direction (forward=H/L, reverse=L/H, brake=H/H, coast=L/L).

PHASE_ENABLE in motor-driver industry terminology refers to a **single direction
pin + single enable pin** (phase controls direction, enable controls on/off).
These are two different topologies. Using PHASE_ENABLE to name today's behavior
will systematically confuse maintainers.

**Recommendation:**

`c
typedef enum {
    DAL_DC_MOTOR_MODE_IN_IN = 0,        /* default -- today's IN/IN H-bridge */
    DAL_DC_MOTOR_MODE_PHASE_ENABLE = 1, /* reserved; unsupported until impl */
} dal_dc_motor_drive_mode_t;
`

And add a truth-table comment in the header:

`
/* IN/IN mode truth table:
 *   dir_pin_a  dir_pin_b  |  motor state
 *   -----------------------+--------------
 *       0          0       |  coast (LOW/LOW)
 *       1          0       |  forward
 *       0          1       |  reverse
 *       1          1       |  brake (short brake)
 */
`

### 2.2 dc_motor safe_off x enable_pin Interaction Undefined (Safety)

**Problem:** Current safe_off -> brake (dal_dc_motor.h:70-77), brake requires
dir_pin_b >= 0. Single-dir motors (dir_pin_b = -1) calling safe_off return
WINK_ERR_UNSUPPORTED -- **fault-safe shutdown fails, motor may keep running**.

This Phase introduces enable_pin (chip-enable, e.g. nSLEEP/STBY), offering a
more reliable path: **when enable_pin >= 0, safe_off should pull enable LOW
for hard-stop**, independent of direction-pin braking.

**Recommendation:** Add to Task A3 interface contract and tests:

`
safe_off behavior hierarchy:
  1. enable_pin >= 0 -> pull enable_pin LOW (hard stop), return WINK_OK
  2. enable_pin == -1 && dir_pin_b >= 0 -> brake (current behavior)
  3. enable_pin == -1 && dir_pin_b == -1 -> coast (WINK_OK, doc: "coast only")
     // Never return UNSUPPORTED -- safe-off must not fail
`

**Rationale:** Fault-safe shutdown is a red-line semantic in embedded systems.
safe_off contracts must guarantee "motor stopped after call", not fail due to
topology limits. enable_pin is the opportunity to fix this.

---

## 3. ORANGE P1: Blocks Execution

### 3.1 Lint DEVICE-REQUIRES-ROLE error Level but B1 Lags

**Problem:** B3's DEVICE-REQUIRES-ROLE is error (plan:240), but B1 (adding
dc_motor/encoder default_role) executes after B3. From B3 landing to B1
completion, all non-experimental drivers without default_role (including
dc_motor/encoder) will be lint-blocked.

**Recommendation:** Two options:
- **Option A (preferred):** Move B1 before B3, so when B3 lands, dc_motor/encoder
  already have default_role.
- **Option B:** Land B3 with DEVICE-REQUIRES-ROLE = warn, upgrade to error in
  a B3 substep after B1 completes.

### 3.2 Simulation Dual-Target Adaptation Missing

**Problem:** Plan states "changes must be dual-target compilable (wasm/ESP32)"
(plan:35), but the new decode_mode, max_angle, drive_mode/enable_pin have
no corresponding stubs or assertions in the **WASM simulation HAL layer**
(	argets/sim/, 	argets/wasm/).

Three possibilities:
1. Sim PAL already has GPIO simulation -> just verify compilation.
2. Sim enable_pin init fails -> need WINK_ERR_UNSUPPORTED fallback + test.
3. Fields are compile-time only (no sim behavior) -> document.

**Recommendation:** Add a substep to A1/A3: "Verify sim target compiles; if PAL
sim layer doesn't support, provide #ifdef SIMULATION fallback or document."

### 3.3 apply_override Wire Version Stance Unstated for dc_motor/encoder

**Problem:** Plan says "new config fields must have default value compatible with
today's behavior; if pply_override exists, bump wire version" (plan:22).
rc_servo has override (dal_rc_servo.h:111), and max_angle correctly stays out
of override (plan:154-155). But dc_motor/encoder have **no override wire**, and
the plan doesn't declare future intent.

**Recommendation:** Add a one-line comment to each header:
- dal_encoder.h: /* NOTE: No apply_override wire yet. Future serialization order follows config struct member declaration order. */
- dal_dc_motor.h: same.

This prevents an implicit ABI decision when override is added later.

---

## 4. YELLOW P2: Robustness

### 4.1 rc_servo max_angle Contract Test Must Assert Pulse Mapping Golden Value

**Problem:** Task A2 tests only "default max=180, 200 -> clamp to 180" (plan:157),
but max_angle may also participate in the **angle-to-pulse mapping denominator**.
Current mapping: pulse = min + (angle / 180.0) * (max - min). If changed to
pulse = min + (angle / max_angle) * (max - min), default=180 matches numerically
but needs a contract test.

**Recommendation:** Add assertion:
`
With max_angle=180 (default), min_pulse=0.5, max_pulse=2.5:
  set_angle(90.0) -> expected pulse = 0.5 + (90/180)*2.0 = 1.5 ms
`
Plus verify max_angle=270 explicit: set_angle(200) does NOT clamp.

### 4.2 encoder invert Semantics Must Be Locked Down

**Problem:** invert has two common meanings: (a) swap A/B phase (direction
reversal), (b) negate count (software flip). These differ in implementation
path (ISR code path vs get_count * -1), and in x2/x4 mode, (b) is wrong.

**Recommendation:** Lock in dal_encoder.h comment: invert = true ->
**swap A/B trigger polarity** (A falling edge = today's A rising edge equivalent).
This preserves correct reuse for x2 (A dual-edge) and x4 (A+B dual-edge) modes.

### 4.3 encoder ISR x1 Counting Direction Must Be Specified

**Problem:** dal_encoder.h:27 defines count as olatile int32_t, but the
ISR x1 direction scheme is unspecified -- unidirectional increment on A rising,
or sample B on A rising (B high -> inc, B low -> dec)?

**Recommendation:** Lock ISR protocol in Task A1: **x1 mode: on each A rising
edge, sample B level; B high -> count++, B low -> count--**. Write into
dal_encoder.h comment. This is industry standard and the foundation for x2/x4.

### 4.4 dc_motor Role set_speed Should Not Blindly IGNORE_RESULT

**Problem:** Plan B1 says "align with rc_servo set_angle style" (plan:204) --
IGNORE_RESULT. But set_speed can return UNSUPPORTED in PWM_ON_IN mode;
single-dir rake also returns UNSUPPORTED (dal_dc_motor.h:59-60). App
calls could silently fail.

**Recommendation:** dc_motor Role set_speed retains wink_status_t return;
coast/rake can use IGNORE_RESULT. Don't blindly align with rc_servo.

### 4.5 float 0 == 180 Sentinel Lacks Defense

**Problem:** Plan uses  .0f as sentinel for max_angle=180 (plan:154), because
designated init leaves unset fields at 0. But if user explicitly writes
max_angle: 0 (intending "zero range"), it's silently interpreted as 180.

**Recommendation:** codegen 
c_servo.py detects max_angle == 0 and prints a
warning; or document "0 = 180 (compatibility), use 0.001 for near-zero range."
Low probability but high subtlety.

### 4.6 safe_off Contract Test Needs Physical-Level Assertion

**Problem:** Plan:185 tests only "safe_off calls brake", but brake's semantic is
"both direction pins HIGH". If the mock only returns OK, GPIO level is unchecked.

**Recommendation:** In test_dal_dc_motor.c, use mock to verify
pal_gpio_set_level is called with dir_pin_a and dir_pin_b both set to
	rue/PAL_GPIO_HIGH. If the test framework can't do this, at minimum comment:
"Test locks call chain, not physical level; HIL test required."

---

## 5. BLUE P3: Governance / Process

### 5.1 Rulings Missing ADR Closure

**Problem:** Plan SSGlobal Constraints contains multiple "default rulings"
(plan:16-20) -- encoder default x1, dc_motor default mode, role naming,
pwm_on_in fail-closed. These are **long-term system-constraining design decisions**
written in an implementation plan (doc layer 3, one-time archive). After execution,
these rulings lose their living-document载体.

Per CLAUDE.md doc flow: Technical issue -> ADR -> Accepted -> backfill to 01~07
design specs. This plan's class of decisions bypassed ADR.

**Recommendation:** Create or extend ADR for at least:
- dc_motor safe_off/enable_pin safety semantics (extend ADR-0048 or new).
- Role naming system dimension (open_loop_actuator vs ngular_actuator).

### 5.2 Verification Lacks Mechanical Evidence

**Problem:** Success criterion "old JSON behavior identical to today" (plan:74)
with verification "unit tests + existing sample regression". But "regression"
isn't mechanically defined -- compile + green tests don't prove byte-identical
codegen output.

**Recommendation:** Add to C2 exit gate:
- For voidance_car, oled_dashboard samples: **diff codegen output before and
  after changes**, confirm device_tree.c is zero-diff (since new fields default
  to not emitted, matching rc_servo.py:87-91 advanced strategy).

### 5.3 pulse_counter CPR Reservation

**Problem:** pulse_counter's get_count returns raw pulse count, but physical
encoders have CPR (cycles per revolution). Future Need layer may need "rotate N
revolutions" -- raw count is insufficient.

**Recommendation:** Reserve cpr field name in stable_fields (not implemented
this Phase); document in pulse_counter Role comment: "pulse_counter is raw pulse
count, no CPR implied; external conversion or cpr field (future) required for
physical angle/revolution."

### 5.4 open_loop_actuator vs angular_actuator: Naming Dimension Mismatch

**Problem:** ngular_actuator (rc_servo) is named by **motion output type**;
open_loop_actuator (dc_motor) is named by **control strategy**. An App developer
faces two different naming dimensions for the same class of device, increasing
cognitive load.

**Recommendation:** Unify on motion-output dimension: linear_speed_actuator or

otary_speed_actuator. Or at minimum document "both are open-loop actuators."

---

## 6. Adoption Summary

| Item | Severity | Required? | Action | Plan Location |
|------|----------|-----------|--------|---------------|
| 2.1 | Correctness | MUST | dc_motor enum -> IN_IN, add truth-table doc | Task A3, GC SS18 |
| 2.2 | Safety | MUST | safe_off hierarchy (enable > brake > coast), add tests | Task A3 Interface |
| 3.1 | Sequence | SHOULD | Move B1 before B3, or B3 starts as warn | Execution DAG SS3.2 |
| 3.2 | Completeness | SHOULD | Add sim-target substeps to A1/A3 | Task A1/A3 |
| 3.3 | ABI | SHOULD | Add override-wire stance comment to headers | Task A1/A3 |
| 4.1 | Test depth | SUGGEST | Add pulse-mapping golden assertions | Task A2 Step 1 |
| 4.2 | Semantics | SUGGEST | Lock invert as "swap A/B polarity" | Task A1 Interface |
| 4.3 | Semantics | SUGGEST | Lock x1: sample B on A rising | Task A1 Interface |
| 4.4 | API design | SUGGEST | Keep set_speed status return | Task B1 |
| 4.5 | Robustness | SUGGEST | Warn on max_angle: 0 in codegen | Task A2 Step 3 |
| 4.6 | Test depth | SUGGEST | Add GPIO-level mock assertion | Task A3 Step 1 |
| 5.1 | Governance | SUGGEST | Create ADR for safe_off/enable_pin semantics | Post-Phase |
| 5.2 | Verification | SUGGEST | Add codegen diff to C2 exit gate | Task C2 |
| 5.3 | Forward-looking | SUGGEST | Reserve cpr in stable_fields | Task B4 |
| 5.4 | Naming | SUGGEST | Unify role naming dimension | Task B1 |

---

*This review is a Doc Layer 4 snapshot. Findings adopted by Owner should be
backfilled into the implementation plan before execution begins.*

