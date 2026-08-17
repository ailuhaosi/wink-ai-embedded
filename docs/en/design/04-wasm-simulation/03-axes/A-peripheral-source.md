# Axis A — Peripheral Physical Source

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/03-axes/A-peripheral-source.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Tier | Ⅱb Thin Index |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Canonical Definition | [`../01-overview/02-axes-af.md`](../01-overview/02-axes-af.md) |

## 1. Questions Answered

Where does sensor, actuator, and bus data come from?

## 2. Primary Mechanism

- [`../02-mechanisms/08-channel-routing.md`](../02-mechanisms/08-channel-routing.md) — 5-Channel data plane and peripheral routing.

## 3. Secondary Mechanisms

- Configuration Plane (Registry / PinArbiter / Schemas) → [`../02-mechanisms/07-peripheral-registry.md`](../02-mechanisms/07-peripheral-registry.md)
- Physical degradation and bus fault injection → [`../02-mechanisms/06-physical-degradation.md`](../02-mechanisms/06-physical-degradation.md)

## 4. Typical Bounds & Constraints

1. **Model Upper Bound**: Does not simulate ADC quantization, impedance, or power integrity.
2. **Channel Coverage**: Channel 1 (Pin edge) and Channel 2 (Bus payload) are main paths; Channel 1b handles PWM duty.
3. **Bypass Discipline**: Sinks to PAL physical sources only; DAL business shortcuts are forbidden.
