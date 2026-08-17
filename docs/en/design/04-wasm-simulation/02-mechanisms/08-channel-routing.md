# Multi-Channel Routing & Peripheral Simulation Selection

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/08-channel-routing.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Document Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Document Status | **Active** (Switched 2026-08-02; Active Wasm simulation SSOT) |
| **Landed** | **Partial**: Channels 1/1b/2 are **Landed**; Ultrasonic edge injection is **Partial** (P0 shortcut **Deprecated**); Channels 3/4 are **Planned**. Selection table "Status" column uses root [00 §3.2](../00-README.md) vocabulary |
| Supporting Axis | **A (primary, data plane)**; PWM Channel 1b **routing** (Hardware behavior $\rightarrow$ [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)) |
| Associated Code | `wink-micro-os/targets/wasm/`, `wink-micro-os/targets/wasm/devices/wasm_dev_*.c`, `wink-micro-os/targets/wasm/wasm_bridge.h`, `wink-micro-os/targets/wasm/pal_hal_wasm.c`, `@wink-ai/unisim` (SimBridge module) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0002, 0003, 0040, 0042, 0045, 0047 |
| Migrated From | `04-wasm-simulation-2.0/09-channel-routing.md` (**stripped** §1.4 / §5.3 timer semantics to `09-timer-…`) |

> This document covers the **data plane** of Axis A (Peripheral Physical Source): which channel physical quantities enter firmware through, how to select peripheral simulation models, and Plugin Channel redlines. The configuration plane (Registry / PinArbiter) is in [`07-peripheral-registry.md`](./07-peripheral-registry.md).
>
> Behavioral semantics for **Hardware Timers / PWM periods / capture / `pal_hwtimer` / FOC soft-stepping** $\rightarrow$ [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md). Definitions and upper bounds for Axes B/C/D/E/F are condensed in [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md); production criteria in [`../01-overview/03-production-contract.md`](../01-overview/03-production-contract.md). This document **does not re-define** A~F and **does not duplicate** production criteria text.

---

## 1. Core Architectural Principles

### 1.1 Homology Boundary Contract

```text
App / BAL / DAL (API + Impl)   ← Zero simulation business branching; Target: 0 #ifdef SIMULATION
        │
PAL / HAL API (Identical signatures across dual targets)
        │
PAL Wasm Impl / wasm_dev_*     ← Sole legitimate platform bypass location (can specialize for sim)
        │
JS Plugin / ProductWorld       ← Produces "physical source" only; never replaces DAL logic
```

Flipping pins at µs/ns frequencies (115200 UART, 400kHz I2C) translates to hundreds of thousands of JS↔Wasm crossings per second, freezing the main thread. Early business shortcuts in DAL using `#ifdef SIMULATION` to return cm/°C directly were proven to fracture sim/real driver paths—protocol conversions, timeouts, and error recoveries were never verified in simulation.

### 1.2 Three Iron Rules

1. **Substitute Physical Data Sources Only** (pin levels, pulse edges, bus slave response bytes, raw ADC values, buffer contents); **never replace** DAL unit conversions, CRC/checksums, timeouts, or retry/error recovery.
2. **Platform-Layer Bypasses**: All interception/routing sinks into PAL/HAL (and Wasm target implementations); DAL business shortcuts are forbidden.
3. **Fail-Loud (ADR-0040)**: New peripherals must map to a specific channel; when unmapped, do not add private DAL `#ifdef`s—extend PAL abstractions or submit a channel contract ADR.

### 1.3 Accuracy Mode and Fidelity Gates

> **SSOT**: Accuracy Mode definitions, orthogonality with Execution Mode, and observational evidence validity $\rightarrow$ **[`11-accuracy-observation-lifecycle.md`](./11-accuracy-observation-lifecycle.md)**. This section retains only the selection gate summary and **prohibits** expanding a second full copy here.

| Mode | Supported | Prohibited as Evidence | Degradation Contract |
|---|---|---|---|
| `behavioral` | L1 state machine + L2 payload / StateChannel semantics | Edge-triggered IRQs, pulse width capture, debounce timing | **Capability Degradation**: Must preserve pulse width / distance information (via VirtualClock delayed dual edges or high-level payload); **strictly prohibited** to collapse into final static levels causing information loss |
| `timing` | L2 edge causality + bounded L3 virtual clock pulse/edge approximations | Cycle / electrical level conclusions | Full microsecond event queue scheduling |
| `cycle` | Planned (I2C edges, etc.) | — | Cycle-accurate / electrical level simulation |

> **Gate**: Any claim of "high consistency on pulse devices (such as ultrasonics)" **must** be verified under `timing`; behavioral results must not serve as pulse/interrupt consistency evidence. **Degradation Iron Rule**: Degradation in any mode is a capability-based division of time resolution and **must never alter or discard information carried by signals**.

**Accuracy Mode ≠ Execution Mode**: The former is a fidelity claim classification (behavioral/timing/cycle), while the latter is INTERACTIVE/HEADLESS (ADR-0042, see [`01-sandbox-and-execution.md`](./01-sandbox-and-execution.md)). The two are orthogonal.

---

## 2. Four Channels + PWM / Timing Modulation Channel

```text
Wasm Firmware (App/BAL/DAL Single Source)
   │
   ├─ Channel 1  Pin-Level pal_gpio_*       → PinArbiter (Buttons/LEDs/Ultrasonic pulses/Input capture)
   ├─ Channel 1b Timing Mod pal_pwm_set_duty → notifyDutyChange (Servos/Motor duty/Output compare)
   ├─ Channel 2  Bus Protocol pal_i2c/spi/uart → I2CBus/SPIBus/UARTBus (OLED/Bus sensors/UART)
   ├─ Channel 3  Analog Signal pal_adc_read  → ADC Source (NTC/LDR/Joysticks/Potentiometers)
   └─ Channel 4  Buffer Frame pal_ws2812_write → FrameBuffer/SAB (WS2812/Cameras)
        │
        ▼
   SimWorker + SimulationPluginHost → ControlHub / World UI / ProductWorld(3D)
```

> Nomenclature Note: PWM travels over physical GPIO pins and carries timer output compare modulation semantics rather than byte protocol buses, hence designated as **Channel 1b** (collectively "Data plane 4 channels + Channel 1b timing modulation"). PWM **carrier/period/hardware behavior / FOC** $\rightarrow$ [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md).

### 2.1 Channel 1: Pin-Level

- **Single-Source Retained**: DAL trigger sequences, `pulse_in`/captures, timeouts, and error handling;
- **Bypass**: Pin physical level sources (PinArbiter driver levels + edge timestamps);
- **PAL Anchors**: `pal_gpio_read` / `pal_gpio_write` / `pal_gpio_pulse_in` (or equivalent capture);
- Firmware GPIOs map to PinArbiter (multi-source driver arbitration + impedance/floating); plugins inject via `writePin`, and UI can inject via ideal drivers. Rotary encoders under timing mode use timer Input Capture hardware abstractions.

**Ultrasonic Target Form**: ProductWorld/ControlHub $\rightarrow$ UltrasonicPlugin (holding distanceCm) $\rightarrow$ Injects ECHO high/low edges into PinArbiter per VirtualClock $\rightarrow$ C `pal_gpio_write(TRIG)` + `pal_gpio_pulse_in(ECHO)` (shared measurement path) $\rightarrow$ DAL pulse-to-distance conversion/timeout/error codes (shared business path). Landing mechanism is Pin Event Queue zero-yield fast-forwarding (see [`02-virtual-clock.md`](./02-virtual-clock.md)).

### 2.2 Channel 1b: PWM Duty Cycle (Modulation Semantic)

- **Single-Source Retained**: DAL angle/speed $\rightarrow$ duty cycle conversion, enable, and clamping logic;
- **Bypass**: Microsecond-level carrier edges $\rightarrow$ only bypasses duty change events (`notifyDutyChange`), without per-edge simulation;
- **PAL Anchor**: `pal_pwm_set_duty(channel, duty_cycle_percent)` (duty range `[0.0, 100.0]`, clamped by DAL) $\rightarrow$ `notifyDutyChange` $\rightarrow$ plugin state / 3D joints;
- Fidelity defaults to L2 (duty semantics); does not claim carrier period L3 without explicit `timing` contracts. FOC fast loop / `pal_hwtimer` belongs to Axis C (see [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)).
- **Input Capture**: Rotary encoders / pulse counters under timing mode use timer hardware capture, with bypass anchor as `pal_hwtimer` capture channels (shares [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md) timer baseline with PWM output compare, but with reversed data flow: PWM is firmware $\rightarrow$ physical output, capture is physical $\rightarrow$ firmware input). Behavioral mode can still degrade to Channel 1 GPIO edge queues.

### 2.3 Channel 2: Bus Protocol

- **Single-Source Retained**: DAL/BAL register packing, address resolution, CRC/checksums, timeout retry, frame state machines;
- **Bypass**: Byte-level bus transactions (Start/Stop conditions, ACK, bit timing) collapsed to payload transmissions;
- **PAL Anchors**:
  - I2C: `pal_i2c_transfer` $\rightarrow$ I2CBus / virtual slave register mirrors;
  - SPI: `pal_spi_transfer` $\rightarrow$ SPIBus;
  - UART: `pal_uart_write`/`pal_uart_read` $\rightarrow$ UARTBus (Async RX/RX IRQ see ADR-0054);
- Firmware accesses slaves via bus PAL; plugins register virtual slaves (`registerI2CDevice`/`registerSpiDevice`/UART port binding) responding to register reads/writes;
- Fidelity defaults to behavioral (transaction/register semantics); does not claim bit timing L3;
- Status: I2C/SPI **Landed**; UART TX **Partial**, async RX **Planned** (ADR-0054).

### 2.4 Channel 3: Analog Signal

- **Single-Source Retained**: DAL raw value calibration, filtering, thresholds, error codes; raw $\leftrightarrow$ mV $\leftrightarrow$ normalized conversions reside in shared C path (`pal_wasm_adc.c`), reusable and unit-testable by DAL/BAL;
- **Bypass**: Only the **normalized physical source** `[0,1]` of ADC channels;
- **PAL Anchors**: `pal_adc_read_raw/mv(channel)` (Public API in [ADR-0057](../../../decisions/core/0057-pal-adc-subsystem-and-channel-3-analog-contract.md); DAC counterpart reserved for future);
- **Wasm Data Path (ADR-0057 Decision 2)**: Imports `extern float js_pal_adc_read_norm(uint16_t pin)`, JS reads `PinArbiter.readAnalog(pin)` (written via `setAnalogDriver` by potentiometers, see [`07`](./07-peripheral-registry.md) §4.3). **Does not add `js_pal_adc_read_mv`**—JS performs no mV conversion and knows no full-scale value; C side calculates `raw = norm × ((1<<bits)-1)`, `mv = norm × full_scale_mv`, and overlays RC lowpass + Gaussian noise + warmup/sample interval checks via degradation engine (reusing `wink_phys_rc_lowpass`/`wink_phys_warmup_check`).
- **Prohibited**: Directly returning `return temperature_c` (that is a DAL business return); temperature/light/BPM/weight are interpreted by upper layers (App/BAL or `environment_sensor`/`motion_sensor` roles) based on `read_mv`.
- **PRNG Isolation**: ADC noise uses per-channel independent seeds (`seed = hash(pin)`), not consuming ADR-0009's global `s_prng`, thus leaving non-analog peripheral golden vectors undisturbed. This is the first implementation of the "per-id sub-stream derivation" roadmap from ADR-0009 §7.
- Status: **Partial** (Contract and PAL/Wasm paths finalized by ADR-0057; first DAL consumers `analog_knob`/`analog_sensor` promote to Landed upon landing with P0 plan).

### 2.5 Channel 4: Buffer Payload

- **Single-Source Retained**: App/DAL framebuffer/RGB array population and consumption algorithms;
- **Bypass**: Non-standard ultra-high-frequency bit waveforms (WS2812 0.4µs NRZ) or mass frame pin-flipping;
- **PAL Anchors**: `pal_ws2812_write(buf,len)` / `pal_camera_capture` / (Planned) `SharedArrayBuffer`;
- Must still route through **named PAL buffer APIs**; must not degrade to DAL `#ifdef` directly drawing UI.
- Status: **Planned**. Collaboration with ADR-0045 fixed heap (`-sALLOW_MEMORY_GROWTH=0`, pending landing) via SAB requires dedicated design upon landing.

### 2.6 Control Plane Anchors

While data plane 5 channels (1 / 1b / 2 / 3 / 4) convey physical signals, control plane 3 lines provide timing synchronization and interrupt driving:

1. **🔴 IRQ Line**: JS enqueues interrupt events into `InterruptQueue`, pulled at safe points by C via `js_pal_poll_interrupt` and dispatched (pull model, details in [`04-interrupt-model.md`](./04-interrupt-model.md)); supports MPU6050 data ready, button dual edges, UART RX; introduces no asynchronous push calls in JS→C direction;
2. **⏱️ HW Timer Anchor**: Unified timebase for Input Capture and Output Compare (see [`09`](./09-timer-and-pwm-semantics.md));
3. **📦 DMA / Frame Backpressure**: WS2812 / camera framebuffer completion signals and backpressure control. SAB ownership / seqlock / Atomics / COOP-COEP / overflow policies are **not yet designed**, to be specified in an independent contract upon Channel 4 landing (see §2.5 Planned status); this section registers anchors without defining protocols.

---

## 3. Peripheral Selection Decision

### 3.1 Selection Table

The "Status" column uses root [00 §3.2](../00-README.md) maturity vocabulary (Landed / Partial / Planned / Deprecated). The table includes **Functional Peripherals** (7 native categories) and **Infrastructure / Topology Peripherals** (5 topology paradigms).

| Category | Example | Key Characteristics & Fields | Simulation Channel | PAL Anchor | Status | Recommended Accuracy | Retained / Bypassed |
|---|---|---|---|---|---|---|---|
| **[Functional Peripherals]** | | | | | | | |
| Switch / Indicator (`input`/`output`) | Button / LED / Relay | Switch levels, GPIO edges, `gpio_pin` / `active_high` | 1 Pin | `pal_gpio_*` / PinArbiter | Landed | behavioral (IRQ: timing) | Retains read/write/subscribe; bypasses pin level source |
| Pulse Timing Sensor (`sensor`) | HC-SR04 | Pulse width measurement, µs-level capture/pulse_in, `trig_pin` / `echo_pin` | 1 Pin | `gpio` + `pulse_in` / capture | **Partial** (Measurement shortcut **Deprecated**) | **timing (Mandatory)** | Retains capture + conversion; bypasses ECHO edge source (see §5.1) |
| Pulse Encoder Sensor (`sensor`) | Rotary Encoder | Phase A/B orthogonal pulses, software counting / hardware input capture, `phase_a_pin` / `phase_b_pin` | 1 Pin (behavioral) / 1b Timed capture (timing) | `gpio` + edges / `pal_hwtimer` capture | Planned | behavioral (High-frequency counting: timing) | behavioral retains orthogonal state machine bypassing edge source; timing bypasses hardware capture counting |
| Bus Display (`display`) | SSD1306 | Framebuffer, graphics/text rendering, `i2c_bus` / `i2c_addr` | 2 Bus | `pal_i2c/spi_transfer` | Landed | behavioral | Retains protocol packing; bypasses bit timing to payload |
| Bus Sensor (`sensor`) | MPU6050 / AHT20 | Register read/write, periodic polling sampling, `i2c_bus` / `i2c_addr` | 2 Bus | Same as above | Partial (MPU6050 Landed; AHT20 Planned) | behavioral | Retains register logic; virtual slave plugins |
| Comm Module (`comm`) | GPS NMEA / AT Modem | **UART serial, baudrate, protocol frames/AT stream, `uart_port` / `baudrate`** | 2 Bus | `pal_uart_*` | **Partial** (TX / transaction level); async RX / RX IRQ **Planned** | behavioral (Do not claim timing for RX timing) | Retains frame parsing; bypasses electrical waveforms; **not** "lacking UI"—it is a model gap |
| Servo / Motor PWM (`actuator`) | SG90 / H-Bridge | Duty cycle modulation, frequency/period, `pwm_channel` / `max_angle` | 1b PWM | `pal_pwm_set_duty` | Landed (duty) | behavioral (Edges: timing) | Retains duty semantics; does not simulate carrier edges |
| Analog Sensor (`sensor`) | NTC / LDR / Joystick | Analog voltages, ADC sampling conversion, `adc_channel` / `raw_val` | 3 Analog | `pal_adc_read_raw/mv` | **Partial** (Contract ADR-0057; first DAL lands with P0) | behavioral | Retains calibration/thresholds; bypasses normalized source `js_pal_adc_read_norm` (see §2.4) |
| System Storage (`storage`) | AT24C02 / W25Q64 | **Non-volatile storage, page/byte read/write, `capacity_bytes` / `i2c_addr`** | 2 Bus | `pal_i2c/spi_transfer` | Landed / Partial | behavioral | Retains read/write algorithms; bypasses storage physical medium to payload |
| High-Frequency LED / Media | WS2812 / Camera | Ultra-high frequency NRZ timing, RGB buffers, `pal_ws2812_write` / capture | 4 Buffer | `pal_ws2812_write` / capture / SAB | Planned | behavioral | Retains RGB buffer semantics; does not simulate NRZ / per-pin flipping |
| **[Infrastructure / Topology Peripherals]** | | | | | | | |
| IO Expander (`infrastructure`) | PCF8574 / 74HC595 | **Bus attached without business Role, provides logical GPIO, `gpio_pin: "provider:P0"`** | Physical 2 Bus $\rightarrow$ Logical 1 Pin | `pal_gpio_*` / Provider | Planned | behavioral | Retains link resolution; bypasses bus expansion conversion to virtual Pins |
| Mux / Decoder (`infrastructure`) | 74HC138 / CD4051 | **Address/enable line multiplexing, `parent` / `channel` mounting** | Physical 1 Pin $\rightarrow$ Mux routing | `pal_gpio_*` / Pin Mux | Planned | behavioral | Retains enable/address logic; bypasses decoding switching levels |
| Bus Switch (`infrastructure`) | TCA9548A | **Resolves same-address slave conflicts, `i2c_bus: "switch:ch0"` mounting** | Physical 2 Bus $\rightarrow$ Virtual Bus | `pal_i2c_transfer` / Bus Switch | Planned | behavioral | Retains channel slicing logic; bypasses multi-channel bus routing |
| Resource Expander (`infrastructure`) | PCA9685 / ADS1115 | **Expands PWM/ADC resources, `pwm_channel: "provider:ch0"` mounting** | Physical 2 Bus $\rightarrow$ Logical 1b / 3 | `pal_pwm_*` / `pal_adc_*` | Planned | behavioral | Retains resource card binding; bypasses bus protocol to resource notifications |

### 3.2 Decision Tree

```text
New Peripheral
 ├─ No business Role / pure topology extension (GPIO expander/decoder/bus switch)? → Infrastructure mode (infrastructure)
 ├─ Standard digital bus byte transactions (sensor/display/storage/serial)?       → Channel 2 Bus
 ├─ PWM duty / motor modulation?                                                 → Channel 1b PWM
 ├─ Pure analog ADC/DAC?                                                         → Channel 3 Analog
 ├─ GPIO/pulse capture?                                                          → Channel 1 Pin
 ├─ High throughput / non-standard ultra-high frequency?                         → Channel 4 Buffer
 └─ None of the above → Fail-Loud: Extend PAL or submit ADR, ban DAL business #ifdef
```

---

## 4. Plugin Channel Fidelity Redline

`js_sim_get_plugin_channel(instance_id, channel_name)` (C signature `extern float js_sim_get_plugin_channel(const char*, const char*)`, e.g. instance `"ultrasonic:0"`, channel `"distanceCm"`) / ControlHub / `stateChannels` serves as the **physical semantics SSOT between plugins and host**, **not a DAL business bypass API**.

| Allowed | Prohibited |
|---|---|
| UI/3D $\rightarrow$ Plugin injects distanceCm / voltages / register mirrors | DAL directly reading business semantic channel and returning `return` to app |
| Plugins computing physical states and writing Pin/Bus slaves/ADC sources | Using channel to skip `pulse_in`/bus transactions/ADC sampling paths without annotation |
| Observability / Trace / UI bindings reading channel | DAL `#ifdef SIMULATION` calling channel equivalents |

Ultrasonic Convergence: Channels only feed plugins; measurement paths must return to Channel 1 edge injection (§2.1). C-side `wasm_dev_*` "reading cm and converting locally to µs" is permitted only as a **Deprecated shortcut**, prohibited from being copied to new device templates.

---

## 5. Architectural Status & Fidelity Convergence

1. **PinArbiter is the GPIO Electrical SSOT** (superseding legacy PinManager; configuration details in [`07-peripheral-registry.md`](./07-peripheral-registry.md)).
2. **Bus Transmissions**: Synchronous Heap slicing within the same Worker $\rightarrow$ I2C/SPI/UART Bus; not cross-thread SAB zero-copy.
3. **OLED**: Scheme-A address short-routing is deprecated; unified `js_pal_i2c_transfer` $\rightarrow$ `MonoOledPlugin`.
4. **Legacy Dedicated Imports Deprecated**: `js_sim_trigger_ultrasonic` / `js_sim_measure_echo_pulse_us` do not exist, and new designs must not use them.
   > Note: Top historical comments in `wasm_bridge.h` previously mentioned that "Plan 4 will append" these two symbols—that comment is obsolete (conflicts with this section), and documentation takes this section as authoritative.
5. **Trace**: DAL/PAL do not trace directly; `pal.transfer` style summaries are recorded by the Worker upon `js_pal_*` returns.
6. **ProductWorld / Raycaster**: 3D collisions belong to presentation layer; distances inject into plugins and are **strictly forbidden** from serving as C DAL return values.

### 5.1 Known Fidelity Gaps (Must Converge)

| Priority | Gap | Current Status | Target |
|---|---|---|---|
| **P0** | Ultrasonic Measurement Shortcut | `wasm_dev_ultrasonic_get_pulse_us` prefers `js_sim_get_plugin_channel(..., "distanceCm")` and converts cm $\rightarrow$ µs in C | Plugins inject ECHO edges + single-source `pulse_in`; remove/deprecate C-side conversion shortcut |
| P1 | Outdated DAL Comments | `dal_ultrasonic.c` still mentions deprecated `js_sim_trigger/measure` | Align to evolved PAL path per ADR-0003 |
| P1 | UART Async RX | Only `js_pal_uart_write`; no virtual-time byte injection / RX IRQ | [ADR-0054](../../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md) (Contract Accepted; implementation Planned) |
| P2 | Channel 4 (Buffer) | Architecture placeholder | Implement PAL buffer APIs + plugins upon landing |
| P0 $\rightarrow$ P2 | Channel 3 (Analog) | Contract finalized by ADR-0057 (`js_pal_adc_read_norm` + PinArbiter + C-side raw/mV conversion) | Land first DAL consumers (`analog_knob`/`analog_sensor`) with P0 plan, promoting selection table to Landed; Channel 4 remains Planned |
| P2 | UART / SPI UI | Few frontend rendering consumers | Incrementally add World/Hub per device; **does not** substitute UART async RX model |

### 5.2 Self-Check Checklist for Adding Peripherals / Modifying Bypasses

1. DAL/App contains no simulation business branches (no `#ifdef SIMULATION` returning physical semantic shortcuts);
2. Bypass anchor lands on PAL API or Wasm PAL implementation, identifying Channels 1/1b/2/3/4;
3. Selection table fully populated (Retained/Bypassed, Status, Accuracy Mode);
4. Pulse/edge/timeout use cases reproducible under `timing` (must not use behavioral to impersonate timing evidence);
5. Plugin Channel used solely for physical sources or observation, with measurement paths traceable to corresponding `js_pal_*`;
6. If unmappable $\rightarrow$ Fail-Loud (extend PAL or submit ADR), with no private DAL shortcuts.

---

## 6. Deprecations and Migrations

| Item | Status | Reason |
|---|---|---|
| DAL Business Passthrough (Entire driver `#ifdef` returning business values) | Deprecated | Fractures single-source path, creates false test coverage |
| Drivers Embedding 3D Raycaster / Calling `js_sim_get_distance` Directly | Deprecated | Presentation layer pierces DAL |
| Per-Device Dedicated `js_sim_trigger_*` / `js_sim_measure_*` Long-Term ABI | Deprecated | Unified into Pin/Bus/ADC/Buffer + Plugin Channel |
| C `wasm_dev_*` Reading distanceCm and Calculating Pulse Width Locally | Transitional Deprecated | Converges to §2.1 edge injection |

**Evolutionary Note**: Relative to the original ADR-0003 Decision 2 text, "substitute physical data sources only" remains valid; landing points have sunk further from "lowest-layer DAL `#ifdef`" to **PAL Wasm Implementation + Plugins**; DAL targets zero simulation macros.
