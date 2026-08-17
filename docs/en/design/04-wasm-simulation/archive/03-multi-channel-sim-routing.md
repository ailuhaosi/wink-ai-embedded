# 4.3 Multi-Channel Simulation Routing & Selection Architecture

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/archive/03-multi-channel-sim-routing.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Status | Living Spec (Archived Historical Baseline) |
| Associated ADRs | [ADR-0003 Simulation Fidelity Boundary](../../../decisions/unisim/0003-simulation-fidelity-boundary.md), [ADR-0002 Dual-Target Compilation](../../../decisions/unisim/0002-dual-target-compilation.md), [ADR-0040 Arduino Semantic Sim JSON Gate](../../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md) |
| Associated Implementation | `wink-ai/packages/unisim`, `wink-ai/packages/embedded-frontend`, `wink-micro-os/targets/wasm` |
| Fidelity Specification | [05-simulation-consistency-and-fidelity-spec.md](./05-simulation-consistency-and-fidelity-spec.md) |

In embedded WebAssembly simulation, the central challenge is balancing **Hardware-Firmware Fidelity** with **Web Browser Performance**.

This specification defines UniSim's **4 Channels + PWM Modulation** platform bypass routing architecture and provides peripheral selection guidelines, ensuring App / BAL / DAL execute single-source driver logic.

---

## 0. Simulation Fidelity Boundary

Adhering to [ADR-0003](../../../decisions/unisim/0003-simulation-fidelity-boundary.md): **Behavioral (causal) fidelity** without cycle-accurate electrical promises.

| Fidelity Tier | Guaranteed Scope | Excluded Scope | Typical Verification Scenario |
|---|---|---|---|
| **L1 Logic / Causality** | App/BAL/DAL state machines, error codes, timeouts, protocol parsing | — | Obstacle avoidance logic, OLED refresh state |
| **L2 Protocol / Signals** | I2C/UART/SPI **transaction payloads**, causal GPIO edges, PWM **duty semantics**, ADC raw values | Bit waveforms, line impedance, reference drift | SSD1306 framebuffers, slave register read/write |
| **L3 Timing / Electrical** | Bounded virtual-clock pulse width / edge approximations under `timing` mode | Cycle-accurate hardware preemption, analog non-linearities | HC-SR04 echo pulse capture (Approximation) |

---

## 1. Core Architectural Principles

### 1.1 Layered Homology Boundary

```text
┌ App / BAL / DAL (API + Impl) ───── Zero simulation `#ifdef`s
├ PAL / HAL API (Dual Target) ────── Stable signatures shared across targets
├ PAL Wasm Impl / `wasm_dev_*` ───── Authorized platform bypass location
└ JS Plugin / ProductWorld ───────── Generates physical source quantities only
```

### 1.2 Three Iron Rules
1. **Physical Source Substitution**: Replace pin levels, pulse edges, and slave bytes; preserve DAL conversions, CRCs, and error handling.
2. **Platform Layer Convergence**: Sinks all bypasses into the PAL/HAL layer.
3. **Fail-Loud Selection (ADR-0040)**: Peripherals must map to an authorized channel.

---

## 2. 4-Channel Platform Routing Architecture

```text
                             [ Wasm Firmware: App / BAL / DAL Single-Source ]
                                                     │
        ┌──────────────────────┬─────────────────────┼─────────────────────┬──────────────────────┐
        ▼                      ▼                     ▼                     ▼                      ▼
 [1. Pin-Level]        [2. Bus Protocol]     [2b. PWM Duty]      [3. Analog Signal]    [4. Buffer Payload]
 pal_gpio_*            pal_i2c/spi/uart_*    pal_pwm_set_duty    pal_adc_read          pal_ws2812_write /
 PinArbiter            I2CBus/SPIBus/UARTBus notifyDutyChange    (raw / voltage)       pal_camera_* / SAB
 Buttons / LEDs        OLED / Bus Sensors    Servos / Motors     NTC / Potentiometers  WS2812 / Camera Frames
        │                      │                     │                     │                      │
        └──────────────────────┴─────────────────────┴─────────────────────┴──────────────────────┘
                                                     ▼
                                       [ SimWorker + SimulationPluginHost ]
                                                     │
                                                     ▼
                         [ embedded-frontend: ControlHub / Canvas / ProductWorld ]
```

### 2.1 Channel 1: Pin-Level
- **Single-Source Preserved**: DAL triggers, `pulse_in`/captures, timeouts.
- **Bypass Sunk**: Electrical pin levels on `PinArbiter`.
- **PAL Anchors**: `pal_gpio_read` / `pal_gpio_write` / `pal_gpio_pulse_in`.

### 2.2 Channel 2: Bus Protocol
- **Single-Source Preserved**: DAL register sequences, packet serialization, retries.
- **Bypass Sunk**: Bit-level clock timings; dispatches transactional payloads to virtual slaves.
- **PAL Anchors**: `pal_i2c_transfer` / `pal_spi_transfer` / `pal_uart_write|read`.

### 2.3 Channel 2b: PWM Duty Modulation
- **Single-Source Preserved**: DAL duty calculations, scaling, and limits.
- **Bypass Sunk**: Microsecond-level carrier wave edges.
- **PAL Anchors**: `pal_pwm_set_duty` $\rightarrow$ `notifyDutyChange`.

### 2.4 Channel 3: Analog Signal
- **Single-Source Preserved**: Raw ADC value calibration, filtering, and thresholds.
- **Bypass Sunk**: Analog voltage generation.
- **PAL Anchors**: `pal_adc_read`.

### 2.5 Channel 4: Buffer Payload
- **Single-Source Preserved**: Framebuffer generation algorithms.
- **Bypass Sunk**: High-frequency bit-banging (WS2812 return-to-zero codes).
- **PAL Anchors**: `pal_ws2812_write` / `pal_camera_capture`.

---

## 3. Peripheral Selection Decision Matrix

| Peripheral Category | Exemplary Devices | Channel | PAL Anchor | Status | Accuracy Mode | Preservation vs Bypass |
|---|---|---|---|---|---|---|
| Digital I/O | Buttons, LEDs, Relays | **1 Pin** | `pal_gpio_*` | Landed | `behavioral` / `timing` | Preserves read/write; bypasses electrical levels |
| Pulse Sensors | HC-SR04 | **1 Pin** | `gpio` + `pulse_in` | **Partial** | **`timing` (Mandatory)** | Preserves capture & math; bypasses ECHO edges |
| Bus Displays | SSD1306 | **2 Bus** | `pal_i2c/spi_transfer` | Landed | `behavioral` | Preserves framing; bypasses bit timings |
| Bus Sensors | MPU6050, AHT20 | **2 Bus** | `pal_i2c_transfer` | Partial | `behavioral` | Preserves register logic; bypasses physical bus |
| Serial Modules | GPS NMEA, AT Modules | **2 Bus** | `pal_uart_*` | Partial | `behavioral` | Preserves parsing; bypasses serial signals |
| Servo / PWM | SG90, H-Bridges | **2b PWM** | `pal_pwm_set_duty` | Landed | `behavioral` / `timing` | Preserves duty routing; bypasses carrier waves |
| Analog Sensors | NTC, Potentiometers | **3 Analog** | `pal_adc_read` | Planned | `behavioral` | Preserves calibration; bypasses ADC sampling |
| High-Speed LEDs | WS2812B | **4 Buffer** | `pal_ws2812_write` | Planned | `behavioral` | Preserves RGB buffers; bypasses bit timings |
| Camera / Media | Camera / I2S | **4 Buffer** | Capture / SAB | Planned | `behavioral` | Preserves algorithms; bypasses streaming bits |

---

## 4. Plugin Channel Fidelity Guardrails

`js_sim_get_plugin_channel` / `stateChannels` are physical telemetry channels between plugins and the host, **not** DAL business bypass APIs.
- UI/3D injects physical quantities (`distanceCm`, voltages) into plugins;
- Plugins compute electrical responses and update PinArbiter or Bus slaves;
- Reading state channels directly inside the DAL is strictly prohibited.

---

## 5. Architecture Alignment & Known Gaps

1. **PinArbiter**: Sole electrical SSOT.
2. **Bus Transfers**: Synchronous heap slices inside the worker thread.
3. **Deprecations**: Specialized imports (`js_sim_trigger_ultrasonic`) are permanently removed.
4. **Ultrasonic Gap (P0)**: Eliminate `distanceCm` C-side conversions in favor of Channel 1 edge injection.

---

## 6. Deprecations & Migration Notes

| Status | Item | Notes |
|---|---|---|
| **Deprecated** | Direct DAL bypasses (`#ifdef SIMULATION` returning centimeters) | Causes false test greens |
| **Deprecated** | Embedded 3D Raycasting inside drivers | UI must not penetrate firmware DAL |
| **Deprecated** | Per-device custom imports (`js_sim_trigger_*`) | Replaced by standard 4 Channels |
| **Transitional** | C `wasm_dev_*` reading `distanceCm` | Deprecated shortcut; migrating to edge injection |
