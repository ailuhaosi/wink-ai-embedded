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
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Partial**: Channels 1/1b/2 Landed; Channels 3/4 Planned |
| Primary Axis | **A (primary, data plane)**; PWM Channel 1b routing |

---

## 1. Core Architectural Principles

### 1.1 Homology Boundary
```text
App / BAL / DAL (C Source)       ← Zero simulation business logic branches
        │
PAL / HAL API (Dual-Target Parity)
        │
PAL Wasm Implementation          ← Sole legitimate platform bypass sink point
        │
JS Plugin / Virtual Peripherals  ← Produces physical stimulus, never alters DAL code
```

### 1.2 The 3 Iron Rules
1. **Substitute Physical Sources Only**: Pin levels, pulse edges, bus response bytes, raw ADC integers, buffer payloads. Never substitute DAL unit calculations, CRC, timeouts, or error handling.
2. **Bypass Sinks to PAL**: All interception and routing sink down to the PAL/HAL layer.
3. **Fail-Loud Enforcement**: Every peripheral must be mapped to an explicit channel.

---

## 2. The 5 Data-Plane Channels

1. **Channel 1: Pin-Level & Edges**: LED, button inputs, dual-edge pulse capture.
2. **Channel 1b: PWM Timing Modulation**: Servo angles, motor duty cycles.
3. **Channel 2: Bus Transaction Protocols**: I2C (SSD1306, EEPROM), SPI, UART.
4. **Channel 3: Analog Signals**: Potentiometers, photoresistors, ADC joysticks.
5. **Channel 4: High-Throughput Buffers**: WS2812 pixel streams, camera frames.
