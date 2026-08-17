# 3.2 Platform Abstraction Layer (PAL) & Hardware Bus Abstraction

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/02-pal-platform-abstraction.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `/src/core/pal/` (`pal_hal.h`, `pal_osal.h`, `pal_time.h`) |
| **Related ADRs** | ADR-0002, ADR-0003, ADR-0004, ADR-0047 |

The Platform Abstraction Layer (PAL) defines the unified hardware interface across physical microcontrollers (ESP32, STM32) and host/simulation targets (WebAssembly, Native OS).

---

## 1. Core Layering & Static Dispatch

PAL relies on compile-time static dispatch rather than runtime function pointers:
- **PAL HAL**: Hardware bus APIs (GPIO, PWM, I2C, SPI, UART).
- **PAL OSAL**: OS abstractions (delays, critical sections, virtual clocks).
- **Identical Dual-Target Signatures**: PAL APIs share 100% identical signatures across ESP-IDF and WebAssembly targets.
