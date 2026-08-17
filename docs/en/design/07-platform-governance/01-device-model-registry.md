# 07. Device Model Registry Unified Specification

<!-- i18n-meta
source: docs/zh/design/07-platform-governance/01-device-model-registry.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

The Device Model Registry is the core metadata epicenter of the Wink-AI platform. It unifies peripheral electrical pinouts, business semantics, low-code properties, DAL APIs, simulation behavior, physical hardware constraints, fault models, and code-generation rules into a versioned device contract.

---

## 1. Design Goals

1. **Single Source of Truth (SSOT)**: Each peripheral maintains a single standard descriptor consumed across UI, Codegen, UniSim simulation, test suites, and hardware builds.
2. **AI Codegen Friendly**: AI agents do not blindly guess GPIO/I2C/PWM register timing, but generate constrained App calls against verified device contracts.
3. **Simulation & Physical Consistency**: The same device model declares simulation behavior alongside physical constraints, minimizing divergence.
4. **Extensible Ecosystem**: Third-party device vendors can submit new sensor, actuator, and board descriptors via standard JSON schemas.
5. **Schema Migration**: Automatic migrations ensure historical projects remain openable, simulatable, and compilable.

---

## 2. Layered Registry Hierarchy

```text
Device Model Registry
├── Board Model              Development Board: Chip, Pin maps, Capabilities, Flashing mode
├── Peripheral Model         Peripherals: LED, Button, Servo, Sensors, OLED Displays
├── Bus Model                Buses: GPIO, PWM, ADC, I2C, SPI, UART
├── DAL API Model            Semantic APIs: Read distance, Set angle, Draw text
├── Simulation Model         Simulation Paths: Pin-level / Protocol / Channel Bypass
├── Fault Model              Disconnect, Timeout, Out-of-bounds, Jitter, Noise
└── Codegen Model            device_tree, App blocks, SchemaForm templates
```
