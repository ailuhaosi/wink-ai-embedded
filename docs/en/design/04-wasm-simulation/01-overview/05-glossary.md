# Glossary of Terms (UniSim Glossary)

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/01-overview/05-glossary.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Term | One-Line Definition | Reference |
|---|---|---|
| **UniSim** | Browser/Node Wasm simulation engine (`@wink-ai/unisim`); Worker hosts single-source C + JS peripherals via `wasm_bridge` ABI | [`01-architecture.md`](./01-architecture.md) |
| **Step-Lock Pipe** | Co-simulation single-step contract: plugins read control outputs → advance physics by Δt → inject sensor readings back | [`01-architecture.md` §2.2](./01-architecture.md) |
| **3 Co-Sim Domains** | App Control Domain (100% C) / Platform Sim OS / Plugin Physics Domain | [`01-architecture.md`](./01-architecture.md) |
| **PinArbiter** | Multi-driver pin arbitration (logic level + drive strength); edge event generator | [`07-peripheral-registry.md`](../02-mechanisms/07-peripheral-registry.md) |
| **Asyncify** | Emscripten transformation yielding Wasm callstacks on blocking operations | [`01-sandbox-and-execution.md`](../02-mechanisms/01-sandbox-and-execution.md) |
| **Clock Gate** | Single virtual clock write point `wink_vclock_advance_internal` (`s_virtual_us`) | [`02-virtual-clock.md`](../02-mechanisms/02-virtual-clock.md) |
| **safe-off** | Actuator safety cutoff handler executed upon fault latching | [`05-memory-and-faults.md`](../02-mechanisms/05-memory-and-faults.md) |
| **5 Channels** | Pin-level / Bus / Analog / Buffer + PWM 1b | [`08-channel-routing.md`](../02-mechanisms/08-channel-routing.md) |
| **A~F Axes** | Orthogonal simulation fidelity axes | [`02-axes-af.md`](./02-axes-af.md) |
| **C1~C25** | Consistency test scenario namespace | [`01-consistency-spec.md`](../04-assurance/01-consistency-spec.md) |
