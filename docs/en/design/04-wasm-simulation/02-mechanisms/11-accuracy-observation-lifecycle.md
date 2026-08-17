# Accuracy Modes, Observability Planes & Lifecycle

<!-- i18n-meta
source: docs/zh/design/04-wasm-simulation/02-mechanisms/11-accuracy-observation-lifecycle.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Doc Level | ① Design Specification (UniSim 3.0 / mechanisms) |
| Status | **Active** (Switched on 2026-08-02; Active SSOT) |
| Landing | **Landed** (Accuracy Modes, PinTracer, VCD Export, SessionRecorder) |
| Supporting Axis | **F (secondary)** |

---

## 1. Observability Planes

- **PinTracer**: Records microsecond-level pin level changes into waveform streams.
- **VCD Exporter**: Exports logic traces into standard Value Change Dump (VCD) files for GTKWave analysis.
- **SessionRecorder**: Records reproducible session streams for automated regression replay.
