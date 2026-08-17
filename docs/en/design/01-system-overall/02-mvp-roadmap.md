# 02. MVP Product Roadmap, Capability Boundaries & Phased Delivery Plan

<!-- i18n-meta
source: docs/zh/design/01-system-overall/02-mvp-roadmap.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

Wink-AI's long-term vision is a unified platform for low-code AI embedded development, high-performance in-browser simulation, and one-click physical flashing. To avoid premature overengineering, the MVP stage focuses on the shortest critical path: enabling users to create a working ESP32 project in the browser, simulate it, verify faults, and flash via WebSerial.

---

## 1. Product Positioning

Core MVP Positioning:

> A safe embedded development platform oriented towards AI-generated applications: "Simulate First, Flash Second".

---

## 2. MVP Scope

### 2.1 Supported Capabilities

| Module | Scope |
|---|---|
| Target Boards | ESP32 DevKit V1 / STM32F4 / Host Wasm |
| Peripherals | LED, Button, RC/Industrial Servo, HC-SR04, SSD1306 OLED, FOC Motor, DC Motor, Latching Relay, ADC Analog |
| Buses & Layers | GPIO, PWM Router, I2C (v6 compat), ADC Subsystem, RMT |
| Simulation | Wasm Worker (`@wink-ai/unisim`), Asyncify, PAL Physical Source Bypass, Protocol Bypass |
| Codegen | App templates, static devicetree generation (`wink gen`) |
| Safety | App static linting, Worker watchdog, `wink_status_t` error codes |
| Build | Containerized cloud build & `wink build` CLI |
| Flashing | Chrome/Edge WebSerial / WebUSB flashing (`wink flash`) |
| Verification | Golden Trace semantic event recording & comparison |

---

## 3. Phased Roadmap

* **Phase 0: Architectural Skeleton** — Bootstrap minimum runtime pipeline (App/BAL/DAL/PAL).
* **Phase 1: Behavioral Simulation Closed Loop** — Validate PAL physical source bypass architecture.
* **Phase 2: Protocol-Level Bypass** — Verify I2C / OLED transaction-level simulation.
* **Phase 3: Cloud Compilation & WebSerial Flashing** — Complete physical hardware delivery loop.
* **Phase 4: Golden Trace Consistency Verification** — Prove virtual-to-physical behavioral fidelity.
