# Arduino Semantic Sim JSON Gate - Design Spec

| Field | Value |
|-------|-------|
| Status | Draft - open points locked (post-review) |
| Date | 2026-07-19 |
| Scope | Arduino compat <-> Wasm UniSim; semantic-sim admission; wink-app.json / device_tree / DAL boundaries |
| Related | [ADR-0003](../../decisions/unisim/0003-simulation-fidelity-boundary.md), [ADR-0035](../../decisions/core/0035-arduino-compat-polymorphism-sandbox.md), [ADR-0036](../../decisions/core/0036-cpp-subset-compilation-policy.md), [multi-channel sim routing](../../design/04-wasm-simulation/archive/03-multi-channel-sim-routing.md) |
| Review input | Antigravity architecture review 2026-07-19 (section 9 lock + hijack guard / CI symbol audit / Host-Wasm consistency) |

> **Document note:** Superpowers drafting spec. After acceptance, formalize to
> `docs/tech-designs/` and an implementation plan under
> `docs/implementation-plans/`. Product policy "JSON gates semantic sim"
> is locked as **ADR-0040** (see section 9.5); backport a pointer into ADR-0003 / sim routing docs.

---

## 1. Goals

Enable Arduino Sketches (`.ino` / `setup`+`loop`) to participate in **the same UniSim semantic path** used by native DAL apps (ultrasonic distance, servo angle, etc.), without:

1. Duplicating wiring truth in both Sketch and JSON (SSOT violation).
2. Guessing peripheral type from raw `pulseIn` / GPIO patterns (false simulation).
3. Breaking Pin-level simulation for simple GPIO when no JSON is present.

**Success criteria:**

- With a valid `wink-app.json` that declares ultrasonic/servo (etc.), an Arduino-facing API can drive **DAL Value Bypass** (`js_sim_*`) and match `avoidance_car`-class behavioral fidelity.
- Without JSON (or without a declaration for that device), **semantic simulation is unavailable**; Pin-level (`js_pal_gpio_*`) remains available for undeclared GPIO.
- Semantic APIs fail **loud** when JSON/device binding is missing - never return plausible fake distances/angles.
- Wiring (pins, channels, device identity) appears **once**: in `wink-app.json` (or Workbench device graph that generates it). Sketch consumes generated bindings only.
- Arduino C++ polymorphism stays inside `frameworks/arduino/` (ADR-0035 leaf sandbox); kernel remains static-dispatch C.

---

## 2. Non-goals

- Full bit-accurate / us-busy-wait simulation of HC-SR04 `pulseIn` loops in the browser.
- Drop-in support for arbitrary third-party Arduino libraries without a Wink adapter or JSON binding.
- Making JSON optional for semantic sim "if the Sketch looks obvious".
- Teaching PAL to infer device class from pin traffic.
- Changing ADR-0004 static dispatch inside PAL/DAL/runtime.

---

## 3. Product policy (locked)

| Condition | Pin-level sim (LED / button GPIO) | Semantic sim (ultrasonic cm, servo angle, `js_sim_*`) |
|-----------|-----------------------------------|------------------------------------------------------|
| **JSON present** and device declared | Supported | **Supported (full behavioral path)** |
| **No JSON** or device not declared | Supported | **Not supported** |

One-liner: **JSON is the admission ticket for semantic simulation; without it, only Pin-level remains.**

### 3.1 Three hardening rules (must hold)

**R1 - Fail-loud on semantic API without binding**

Calls that require device semantics (`WinkUltrasonic::read`, unbound `pulseIn`, `WinkServo::write`, etc.) when no JSON binding exists must return a documented error / invalid sentinel or trip a sim assert/fault path - and must **not** return a plausible distance/angle.

**R2 - JSON is the only wiring SSOT**

- Pins, PWM channels, device names/types live only in `wink-app.json` (codegen -> `device_tree`).
- Sketch must not restate `trig_pin` / `echo_pin` / `pwm_channel` as authoritative constants.
- Sketch uses generated symbols only.
- Hard-coded pin conflicting with JSON -> compile-time or init-time failure. Late `pinMode` hijack is also blocked (section 9.6).

**R3 - Explicit path classification**

| Class | Examples | Sim path | JSON required? |
|-------|----------|----------|----------------|
| Pin-level | `pinMode`, `digitalRead`/`digitalWrite` on undeclared pins | `pal_gpio_*` -> `js_pal_gpio_*` | No |
| Protocol | I2C/OLED byte transactions (future `Wire` adapter) | `pal_i2c_transfer` -> `js_pal_i2c_transfer` | Yes (device identity / address) |
| Semantic | Ultrasonic distance, servo angle, motor setpoints | DAL -> `js_sim_*` / PWM + registry | **Yes** |

Undeclared semantic-shaped APIs under Wasm sim = unsupported (R1).

---

## 4. Terminology

| Term | Meaning |
|------|---------|
| **Sketch** | User Arduino program (`.ino`) with `setup()` / `loop()` |
| **Arduino compat sandbox** | `wink-micro-os/frameworks/arduino/` (+ device facades) - ADR-0035 leaf |
| **JSON / wink-app.json** | App device manifest; SSOT for wiring and device identity |
| **device_tree** | Codegen output holding POD DAL instances + `wink_device_tree_init` |
| **Pin-level sim** | Level flips via `js_pal_gpio_write` / `js_pal_gpio_read` |
| **Semantic sim** | Behavioral bypass via DAL + `js_sim_*` |

---

## 5. Architecture overview

```text
                    wink-app.json  -------------------------.
                         | (SSOT: wiring + device id)       |
                         v                                  |
                   Codegen -> ${GEN_DIR}                     |
              device_tree.c/h                               |
              + wink_arduino_bindings.h                     |
                         |                                  |
         .---------------|--------.-------.                 |
         v               v        v       |                 |
   DAL instances    Resource   Sketch     |                 |
         |          claim      (.ino)     |                 |
         |          pal_resource_*        |                 |
         |               |        |       |                 |
         |         Zero-cost facades      |                 |
         |         (WinkUltrasonic /      |                 |
         |          WinkServo)            |                 |
         `-------^-------'--------'       |                 |
                 |  dal_* named APIs only |                 |
                 v                        |                 |
         Wasm: dal_* -> js_sim_* / js_pal_* <---------------'
               (same path as avoidance_car)
```

**Dependency direction (ADR-0035):** Sketch + facades -> DAL/PAL C APIs. Kernel never includes `Arduino.h`.

---

## 6. Data flow

### 6.1 Full semantic path (JSON present)

1. **Build:** Codegen reads JSON -> emits `device_tree` + Arduino bindings into `${GEN_DIR}` (section 9.4).
2. **Init:** `wink_device_tree_init()` claims resources and `dal_*_init`.
3. **Sketch:** `front_radar.read()` -> `dal_ultrasonic_*` -> (Wasm) `js_sim_*` -> C-side pulse-to-cm (ADR-0003).
4. **Sketch:** `neck_servo.write(angle)` -> `dal_servo_set_angle` -> `pal_pwm_set_duty` -> `js_pal_pwm_set_duty`.
5. **Frontend:** Binds 3D by **device id** from JSON, not Sketch literals.

### 6.2 Pin-level-only path (no JSON)

1. **Build:** Empty / missing `devices`.
2. **Claim:** `pinMode()` auto-claims with owner `"arduino_compat"` (section 9.1). No JSON `led` required.
3. **Sketch:** `digitalWrite` -> `pal_gpio_write` -> `js_pal_gpio_write`.
4. **Semantic facade without JSON device:** R1 fail-loud.

**Wasm caveat:** `pal_resource_*` is currently documented as no-op on wasm. Conflict detection (sections 9.1 / 9.6) needs the resource table (or a sim-side equivalent) enabled on wasm before UniSim mixed-path conflict tests can pass.

### 6.3 Mixed path

- Declared ultrasonic/servo -> semantic path.
- Extra undeclared GPIO -> Pin-level only.
- Unbound `pulseIn` as "echo" -> unsupported (R1).
- `pinMode` on DAL-owned pin -> fail-loud (section 9.6).

---

## 7. No-JSON / unbound failure behavior

### 7.1 Matrix

| Call site | No JSON / unbound | JSON bound |
|-----------|-------------------|------------|
| `digitalWrite` / `digitalRead` / `pinMode` | Pin-level OK; `pinMode` auto-claims `"arduino_compat"` | Claim `WINK_ERR_BUSY` if DAL owns pin -> fail-loud |
| `WinkUltrasonic::read` | **Fail-loud** (section 7.2) | DAL + `js_sim_*` |
| `WinkServo::write` | **Fail-loud** | DAL + PWM / registry |
| Raw `pulseIn` Wasm unbound | Return `0` + one-shot WARN; `WINK_SIM_STRICT` -> panic (section 9.3) | May route to DAL if pin is declared `echo_pin` |
| Host unit test without JSON | Pin-level OK; semantic tests need JSON/DT | - |

### 7.2 Fail-loud contract

1. **Init-time:** Facade bind fails / `initialized=false` if device id missing.
2. **Use-time:** error status or invalid sentinel (e.g. `-1.0f` cm) + one-shot `pal_log` WARN.
3. **Strict:** `WINK_SIM_STRICT=1` -> `wink_runtime_fault` / panic.

**Host <-> Wasm consistency (section 9.8):** same unbound call must fail observably on both targets.

**Forbidden:** fake `25.0f` cm / `90` deg / silent success when unbound.

### 7.3 ESP32 without JSON

Blink without JSON may remain allowed. Semantic facades still require JSON/device_tree (R2 on device too).

---

## 8. Arduino adapter boundaries

### 8.1 In scope

| Component | Responsibility |
|-----------|----------------|
| `frameworks/arduino` core | GPIO/timing/Serial/`pulseIn` -> PAL; `pinMode` auto-claim; `setup`/`loop` callbacks |
| Device facades | Zero-cost C++ wrappers (section 9.2) -> existing `dal_*` only |
| Generated bindings | JSON-only symbols in `${GEN_DIR}` (section 9.4) |

### 8.2 Forbidden

| Action | Why |
|--------|-----|
| PAL/DAL `#include <Arduino.h>` | ADR-0035 |
| Facades calling `js_sim_*` directly | ADR-0003 - bypass stays in DAL |
| Authoritative pin tables in Sketch/facade | Breaks R2 |
| Busy-wait `pulseIn` as primary ultrasonic sim | Wrong fidelity tier |
| Kernel linking `wink_arduino_compat` | Leaf-only |
| Exceptions / RTTI / STL in facades | ADR-0036; CI audit section 9.7 |

### 8.3 MVP device mapping

| JSON `type` | DAL | Facade | Sim path |
|-------------|-----|--------|----------|
| `ultrasonic` | `dal_ultrasonic_*` | `WinkUltrasonic` | `js_sim_trigger_ultrasonic`, `js_sim_measure_echo_pulse_us` |
| `servo` | `dal_servo_*` | `WinkServo` | `js_pal_pwm_set_duty` + registry/UI |
| (later) led/button | `dal_led_*` / `dal_button_*` | optional | `js_pal_gpio_*` |

Prefer `dal_ultrasonic_request_measurement` + `dal_ultrasonic_get_cached_distance` (or `dal_ultrasonic_read` where blocking allowed). Facades must not invent a second measure algorithm.

### 8.4 Sketch shape (normative)

```cpp
#include <Arduino.h>
#include "wink_arduino_bindings.h"  // from ${GEN_DIR}

void setup() {
  Serial.begin(115200);
}

void loop() {
  float cm = front_radar.read();
  if (cm >= 0.0f) {
    neck_servo.write(cm < 20.f ? 45.f : 90.f);
  }
  delay(50);
}
```

**Disallowed:** `WinkUltrasonic ultra(4, 5);` / `s.attach(13);` as wiring SSOT.

### 8.5 Facade shape (zero-cost wrapper)

```cpp
#pragma once
#include "dal_ultrasonic.h"

class WinkUltrasonic {
public:
    explicit WinkUltrasonic(dal_ultrasonic_t& dal_dev) : _dev(dal_dev) {}
    WinkUltrasonic(const WinkUltrasonic&) = delete;

    float read() {
        float cm = 0.0f;
        wink_status_t rc = dal_ultrasonic_get_cached_distance(&_dev, &cm);
        if (rc != WINK_OK) {
            return -1.0f;  // fail-loud sentinel
        }
        return cm;
    }
private:
    dal_ultrasonic_t& _dev;  // codegen POD ref - no heap, no vtable
};
```

Codegen emits DAL POD + global facade. No virtual methods on device facades (ArduinoCore-API `Print`/`Stream` vtables stay in the sandbox only).

---

## 9. Locked design decisions (former open points + review additions)

### 9.1 GPIO claim without JSON - `pinMode` auto-claim

**Decision:** `pinMode()` calls `pal_resource_claim(PAL_RESOURCE_GPIO_PIN, pin, "arduino_compat")`.

- Blink needs no JSON `led` entry.
- Same-owner re-`pinMode` is idempotent (`WINK_OK`).
- Foreign owner (DAL device id) -> `WINK_ERR_BUSY` -> fail-loud.

**Correction vs review sample:** do **not** `if (pal_resource_is_claimed) panic` - that breaks re-entrant `pinMode` by `"arduino_compat"`. Use **claim return value** (`BUSY` = foreign owner).

**Prerequisite:** enable real `pal_resource_*` on wasm (or sim-equivalent map).

### 9.2 Facade language surface - zero-cost C++ wrapper

**Decision:** Header C++ classes holding a reference to codegen `dal_*_t`. No vtable, no exceptions, no STL, no facade heap (ADR-0036). Prefer `front_radar.read()` UX.

### 9.3 Raw `pulseIn` under simulation

| Mode | Unbound / non-echo `pulseIn` |
|------|------------------------------|
| Default Wasm | Return `0` + one-shot `pal_log` WARN |
| `WINK_SIM_STRICT=1` | Panic / runtime fault |

No busy-wait echo sim; no invented pulse widths.

### 9.4 Codegen path - `${GEN_DIR}`

**Decision:** Emit `wink_arduino_bindings.h` beside `device_tree.*` under build `${GEN_DIR}`. Never write codegen into the app source tree.

### 9.5 Formal ADR - ADR-0040

**Decision:** Promote "JSON gates Arduino semantic simulation" to **ADR-0040**. Backport a short pointer into ADR-0003 and multi-channel sim routing doc.

### 9.6 Late-binding hijack prevention (review addition)

After device_tree claimed trig/echo, Sketch `pinMode(trig, OUTPUT)` must hit section 9.1 `BUSY` and fail-loud. Closes dynamic SSOT bypass that static codegen alone cannot catch.

### 9.7 CI binary symbol audit (review addition)

After linking Arduino-enabled `.elf` / `.wasm`, scan and fail on:

- Exception/unwind symbols (`__cxa_throw`, `_Unwind_RaiseException`, ...)
- Unexpected heavy `std::` / iostream symbols
- `operator new` / `malloc` not routed per Arduino arena policy (ADR-0036)

Complements ADR-0035 include-path CI scans.

### 9.8 Host <-> Wasm fail-loud consistency (review addition)

| Target | Observable failure |
|--------|--------------------|
| Host | Status / assertion / log |
| Wasm | WARN and/or panic to JS console |

CI must include at least one paired case (same Sketch + stripped JSON) on both targets.

---

## 10. Testing strategy

| Case | Expect |
|------|--------|
| `arduino_blink_demo` host E2E, no/empty devices | PASS; `pinMode` auto-claim |
| Wasm blink without JSON | Pin-level LED (after wasm claim table enabled) |
| Arduino avoidance Sketch + JSON | Semantic distance + servo duty updates |
| Same Sketch, devices stripped | Fail-loud on host **and** Wasm; no plausible cm |
| `pinMode` on DAL-owned pin | BUSY / fail-loud |
| Unbound `pulseIn` Wasm | `0` + WARN; STRICT -> panic |
| ADR-0035 include scan | No Arduino under `pal/`/`dal/`/`targets/` |
| ADR-0036 symbol scan | No exception / forbidden STL symbols |

---

## 11. Rollout phases

| Phase | Deliverable |
|-------|-------------|
| P0 | Spec accepted; draft **ADR-0040**; doc pointers |
| P1 | `${GEN_DIR}` bindings; zero-cost `WinkUltrasonic` / `WinkServo` |
| P1b | `pinMode` auto-claim + wasm resource-table enablement |
| P2 | Wasm Arduino sample + UniSim semantic smoke |
| P3 | Fail-loud matrix + STRICT + Host-Wasm paired tests + symbol CI |
| P4 | Optional Wire/OLED protocol path (still JSON-gated) |

---

## 12. Decision summary

| Topic | Decision |
|-------|----------|
| Semantic sim without JSON | **Not supported** |
| Pin-level without JSON | **Supported** (`pinMode` auto-claim) |
| Wiring SSOT | **`wink-app.json` only** |
| Sketch role | Control logic + generated symbols |
| Sim bypass | **DAL** (facades never call `js_sim_*`) |
| Facade surface | **Zero-cost C++ wrapper** |
| Unbound `pulseIn` | **`0` + WARN**; STRICT -> panic |
| Codegen output | **`${GEN_DIR}`** |
| Policy ADR | **ADR-0040** |
| Approach A (silent full Arduino sim) | **Rejected** |

---

## 13. Spec self-review checklist

- [x] Former section 9 open points closed with explicit decisions
- [x] Review additions incorporated (9.6-9.8) with PAL API correction (claim vs `is_claimed`)
- [x] Wasm `pal_resource` no-op caveat documented
- [x] Consistent with ADR-0035 / ADR-0003
- [x] SSOT dual-write and late `pinMode` hijack forbidden
- [x] Fail-loud + Host-Wasm consistency required
- [x] Scope limited to Arduino-sim gate
