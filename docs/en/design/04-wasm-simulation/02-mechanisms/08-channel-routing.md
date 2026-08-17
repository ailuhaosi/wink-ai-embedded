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
| **Landed** | **Partial**: Channels 1/1b/2 are **Landed**; Ultrasonic edge injection is **Partial** (P0 shortcut **Deprecated**); Channels 3/4 are **Planned** |
| Supporting Axis | **A (primary, data plane)**; PWM Channel 1b routing (Hardware behavior $\rightarrow$ [`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)) |
| Associated Code | `wink-micro-os/targets/wasm/`, `wink-micro-os/targets/wasm/devices/wasm_dev_*.c`, `wink-micro-os/targets/wasm/wasm_bridge.h`, `wink-micro-os/targets/wasm/pal_hal_wasm.c`, `@wink-ai/unisim` (SimBridge) |
| Last Audit | 2026-08-02 |
| Governing ADRs | 0002, 0003, 0040, 0042, 0045, 0047 |
| Migrated From | `04-wasm-simulation-2.0/09-channel-routing.md` |

> This document defines the **Data Plane** of Axis A (Peripheral Physical Source): how physical quantities enter firmware, peripheral selection matrices, and plugin channel discipline.

---

## 1. Core Architectural Principles

### 1.1 Homology Boundary

```text
App / BAL / DAL (API + Impl)   ← Zero simulation business branching (Target: 0 #ifdef SIMULATION)
        │
PAL / HAL API (Identical signatures across dual targets)
        │
PAL Wasm Impl / wasm_dev_*     ← Sole legitimate platform bypass location
        │
JS Plugin / ProductWorld       ← Supplies physical sources only; never replaces DAL logic
```

### 1.2 3 Fundamental Rules

1. **Substitute Physical Data Sources Only** (pin levels, pulse edges, slave response bytes, raw ADC counts, buffer arrays); **never replace** DAL unit conversions, CRC/checksums, timeouts, or retry/recovery state machines.
2. **Platform Layer Bypasses**: Bypasses sink into PAL/HAL (and Wasm target implementations); direct DAL shortcuts are strictly forbidden.
3. **Fail-Loud (ADR-0040)**: Unmapped peripherals must fail at compile time rather than introducing ad-hoc `#ifdef`s.

### 1.3 Accuracy Modes & Verification Gates

| Mode | Supported Scope | Prohibited as Evidence | Degradation Contract |
|---|---|---|---|
| `behavioral` | L1 state machine + L2 payload semantics | Edge-triggered IRQs, pulse capture, debounce timing | Preserves pulse/distance information without collapsing to static levels |
| `timing` | L2 edge causality + bounded L3 pulse approximations | Cycle-accurate/electrical conclusions | Microsecond event queue scheduling |
| `cycle` | Planned (I2C bit edges) | — | Cycle-accurate electrical simulation |

---

## 2. 4 Channels + PWM / Timing Modulation Channel

```text
Wasm Firmware (App/BAL/DAL Single Source)
   │
   ├─ Channel 1  Pin-Level pal_gpio_*       → PinArbiter (Buttons/LEDs/Ultrasonic Pulses/Input Capture)
   ├─ Channel 1b Timing Mod pal_pwm_set_duty → notifyDutyChange (Servos/Motor PWM/Output Compare)
   ├─ Channel 2  Bus Protocol pal_i2c/spi/uart → I2CBus/SPIBus/UARTBus (OLED/Bus Sensors/UART)
   ├─ Channel 3  Analog pal_adc_read        → ADC Source (NTC/LDR/Joysticks/Potentiometers)
   └─ Channel 4  Buffer pal_ws2812_write    → FrameBuffer/SAB (WS2812 LEDs/Camera Frames)
        │
        ▼
   SimWorker + SimulationPluginHost → ControlHub / World UI / ProductWorld (3D)
```

### 2.1 Channel 1: Pin-Level

- **Single-Source Retained**: DAL trigger sequences, `pulse_in`/captures, timeouts, and error handling;
- **Bypass**: Pin physical level sources (PinArbiter driver states + edge timestamps);
- **PAL Anchors**: `pal_gpio_read` / `pal_gpio_write` / `pal_gpio_pulse_in`.

### 2.2 Channel 1b: PWM Duty Cycle (Modulation Semantics)

- **Single-Source Retained**: DAL angle/speed $\rightarrow$ duty cycle conversions, enable logic, clamping;
- **Bypass**: Carrier wave microsecond transitions $\rightarrow$ event-driven duty change notifications (`notifyDutyChange`);
- **PAL Anchor**: `pal_pwm_set_duty(channel, duty_cycle_percent)` $\rightarrow$ `notifyDutyChange` $\rightarrow$ 3D Joint Rotations.
- **Input Capture**: Encoders under `timing` mode route through timer input capture hardware abstractions ([`09-timer-and-pwm-semantics.md`](./09-timer-and-pwm-semantics.md)).

### 2.3 Channel 2: Bus Protocol

- **Single-Source Retained**: DAL/BAL register packing, address validation, CRC checks, retry loops;
- **Bypass**: Byte-level bus transactions (Start/Stop conditions, ACK bits) abstracted to payload transfers;
- **PAL Anchors**: `pal_i2c_transfer`, `pal_spi_transfer`, `pal_uart_write`/`pal_uart_read`.

### 2.4 Channel 3: Analog Signal

- **Single-Source Retained**: DAL calibration, filtering, thresholds, error codes;
- **Bypass**: Normalized physical source $[0, 1]$;
- **PAL Anchors**: `pal_adc_read_raw/mv(channel)` ([ADR-0057](../../../decisions/core/0057-pal-adc-subsystem-and-channel-3-analog-contract.md)).
- **Wasm Data Path**: Imports `js_pal_adc_read_norm(pin)` reading `PinArbiter.readAnalog(pin)`. C scales `raw = norm * ((1<<bits)-1)` and applies RC filtering and Gaussian noise.

### 2.5 Channel 4: Buffer Payload

- **Single-Source Retained**: Framebuffer array manipulation and consumption;
- **Bypass**: High-frequency NRZ bit waveforms (WS2812 0.4µs pulses) or dense camera frames;
- **PAL Anchors**: `pal_ws2812_write(buf, len)` / `pal_camera_capture`.

### 2.6 Control Plane Anchors

1. **IRQ Line**: Enqueues interrupt events into `InterruptQueue`, pulled at safe points via `js_pal_poll_interrupt`;
2. **HW Timer Anchor**: Unified timebase for input capture and output compare ([`09`](./09-timer-and-pwm-semantics.md));
3. **DMA Backpressure**: Buffer completion and flow control signals.

---

## 3. Peripheral Selection Matrix

| Category | Example | Key Characteristics & Fields | Channel | PAL Anchor | Status | Recommended Accuracy | Retained / Bypassed |
|---|---|---|---|---|---|---|---|
| **[Functional Peripherals]** | | | | | | | |
| Switch / Indicator (`input`/`output`) | Button / LED / Relay | On/off levels, GPIO edges, `gpio_pin` / `active_high` | 1 Pin | `pal_gpio_*` / PinArbiter | Landed | behavioral (IRQ: timing) | Retains read/write/subscribe; bypasses electrical level |
| Pulse Sensor (`sensor`) | HC-SR04 | Pulse width measurement, `pulse_in`, `trig_pin` / `echo_pin` | 1 Pin | `gpio` + `pulse_in` / capture | **Partial** (Shortcut **Deprecated**) | **timing (Mandatory)** | Retains capture + math; bypasses ECHO edge source |
| Quadrature Encoder (`sensor`) | Rotary Encoder | Orthogonal pulses, `phase_a_pin` / `phase_b_pin` | 1 Pin / 1b Capture | `gpio` edges / `pal_hwtimer` | Planned | behavioral (High-speed: timing) | Retains quadrature state machine; bypasses edge source |
| Bus Display (`display`) | SSD1306 | Framebuffers, graphics/text rendering, `i2c_bus` / `i2c_addr` | 2 Bus | `pal_i2c/spi_transfer` | Landed | behavioral | Retains protocol packing; bypasses bit waveforms |
| Bus Sensor (`sensor`) | MPU6050 / AHT20 | Register reads/writes, polling sampling, `i2c_bus` / `i2c_addr` | 2 Bus | Same as above | Partial (MPU6050 Landed; AHT20 Planned) | behavioral | Retains register logic; virtual slave plugins |
| Comm Module (`comm`) | GPS NMEA / AT Modem | UART serial, baudrate, protocol frames, `uart_port` / `baudrate` | 2 Bus | `pal_uart_*` | **Partial** (TX Landed; Async RX Planned) | behavioral | Retains frame parsing; bypasses electrical waveforms |
| Servo / Motor PWM (`actuator`) | SG90 / H-Bridge | Duty cycle modulation, frequency, `pwm_channel` / `max_angle` | 1b PWM | `pal_pwm_set_duty` | Landed (Duty) | behavioral (Edges: timing) | Retains duty semantics; skips carrier edge simulation |
| Analog Sensor (`sensor`) | NTC / LDR / Joystick | Analog voltages, ADC conversions, `adc_channel` / `raw_val` | 3 Analog | `pal_adc_read_raw/mv` | **Partial** (ADR-0057) | behavioral | Retains calibration; bypasses normalized `js_pal_adc_read_norm` |
| System Storage (`storage`) | AT24C02 / W25Q64 | Non-volatile storage, page/byte ops, `capacity_bytes` / `i2c_addr` | 2 Bus | `pal_i2c/spi_transfer` | Landed / Partial | behavioral | Retains read/write algorithms; bypasses physical medium |
| High-Speed LED / Media | WS2812 / Camera | NRZ waveforms, RGB buffers, `pal_ws2812_write` / capture | 4 Buffer | `pal_ws2812_write` / SAB | Planned | behavioral | Retains RGB buffer; bypasses NRZ bit shifting |
| **[Infrastructure Peripherals]** | | | | | | | |
| IO Expander (`infrastructure`) | PCF8574 / 74HC595 | No business role, logical GPIO provider, `gpio_pin: "provider:P0"` | 2 Bus $\rightarrow$ 1 Pin | `pal_gpio_*` / Provider | Planned | behavioral | Retains decoding; converts bus transactions to virtual pins |
| Mux / Decoder (`infrastructure`) | 74HC138 / CD4051 | Address/enable line multiplexing, `parent` / `channel` | 1 Pin $\rightarrow$ Mux | `pal_gpio_*` / Pin Mux | Planned | behavioral | Retains enable logic; bypasses physical level routing |
| Bus Switch (`infrastructure`) | TCA9548A | Resolves duplicate I2C addresses, `i2c_bus: "switch:ch0"` | 2 Bus $\rightarrow$ Virt Bus | `pal_i2c_transfer` / Switch | Planned | behavioral | Retains slice selection; bypasses physical bus muxing |
| Resource Expander (`infrastructure`) | PCA9685 / ADS1115 | Expands PWM/ADC resources, `pwm_channel: "provider:ch0"` | 2 Bus $\rightarrow$ 1b / 3 | `pal_pwm_*` / `pal_adc_*` | Planned | behavioral | Retains binding cards; converts bus packets to notifications |

---

## 4. Plugin Channel Guardrails

`js_sim_get_plugin_channel(instance_id, channel_name)` represents a **physical semantics SSOT between host and plugins**, never an application-level bypass.

| Allowed | Prohibited |
|---|---|
| UI/3D $\rightarrow$ Plugin injects `distanceCm` / voltages / registers | DAL directly reading semantic channels to return to App |
| Plugins computing physical states and updating Pin/Bus/ADC sources | Using channels to skip `pulse_in` or bus transactions |
| Observability/Tracing tools inspecting channel data | DAL `#ifdef SIMULATION` calling channel equivalents |

---

## 5. Architectural Status & Convergence

1. **PinArbiter is the Electrical SSOT** for GPIOs.
2. **Bus Transmissions** execute via synchronous linear memory slices inside the Worker.
3. **OLED** uses unified `js_pal_i2c_transfer` $\rightarrow$ `MonoOledPlugin`.
4. **Dedicated Legacy Imports are Retired**: `js_sim_trigger_ultrasonic` and `js_sim_measure_echo_pulse_us` are removed.
5. **ProductWorld 3D Collisions** supply physical inputs to plugins, never direct DAL return values.

### 5.1 Fidelity Gap Convergence

| Priority | Gap | Current Status | Target Resolution |
|---|---|---|---|
| **P0** | Ultrasonic Measurement Shortcut | `wasm_dev_ultrasonic_get_pulse_us` converts `distanceCm` in C | Plugins inject ECHO edges into single-source `pulse_in` |
| P1 | Outdated DAL Comments | Mentions deprecated `js_sim_trigger` | Cleaned up to reflect PAL routing |
| P1 | UART Async RX | `js_pal_uart_write` only; no byte stream / RX IRQ | [ADR-0054](../../../decisions/unisim/0054-sim-uart-async-rx-model-boundary.md) |
| P2 | Channel 4 (Buffer) | Architecture placeholder | Implement PAL buffer APIs + Plugins |
| P0 $\rightarrow$ P2 | Channel 3 (Analog) | Governed per ADR-0057 | Land first DAL consumers (`analog_knob`) |

---

## 6. Deprecations & Migrations

| Item | Status | Reason |
|---|---|---|
| DAL Business Bypasses (Entire driver `#ifdef`s) | Deprecated | Fractures single-source testing; false green tests |
| Direct 3D Raycaster DAL Invocations | Deprecated | Breaches presentation-driver boundaries |
| Device-Specific `js_sim_trigger_*` ABI Stubs | Deprecated | Consolidated into 4 Channels + Plugin Channels |
| C `wasm_dev_*` Local cm $\rightarrow$ μs Calculations | Deprecated | Replaced by Pin Channel 1 edge injections |
