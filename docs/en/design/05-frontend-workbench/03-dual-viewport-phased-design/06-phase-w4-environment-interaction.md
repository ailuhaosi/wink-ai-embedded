# W4 Environmental Interaction — Heat Source, Thermal Fields & Templates

<!-- i18n-meta
source: docs/zh/design/05-frontend-workbench/03-dual-viewport-phased-design/06-phase-w4-environment-interaction.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| Phase | W4 |
| Effort Estimate | ~1.5 days |
| Prerequisites | W3c Sensors & Environment Bridge complete |
| Deliverables | Heat source environmental prop, Thermal field decay model, Runtime environment editing, EnvironmentInspector, `tpl_temp_alarm` |
| Milestone | M5: Drag heat source near sensor $\rightarrow$ DHT temperature rises $\rightarrow$ Firmware alarm triggers $\rightarrow$ LED illuminates |
| Upstream Refs | [02-dual-viewport-product-world-layout.md](../02-dual-viewport-product-world-layout.md) §8.3, [00-master-plan.md](./00-master-plan.md) §10 |

---

## 1. Goals

1. Render 3D heat source meshes (Emissive core + volumetric ring + particle smoke) with Transform Gizmos.
2. Implement distance attenuation thermal field models with multi-source superposition.
3. Support `temperature_field_sample` sensor bindings.
4. Allow environmental prop transform adjustments during `simulate` mode.
5. Create the EnvironmentInspector panel.
6. Deliver end-to-end execution of the `tpl_temp_alarm` template.

---

## 2. Heat Source Mesh & Thermal Ring

```typescript
export function createHeatSourceMesh(prop: EnvironmentProp): THREE.Group {
  // Spherical emissive core + horizontal range ring + point light
}
```

---

## 3. Thermal Field Distance Decay Model

Calculates sampled temperature at the sensor mount position using a quadratic attenuation formula:
$$T = T_{\text{ambient}} + (T_{\text{core}} - T_{\text{ambient}}) \cdot \left(1 - \frac{d}{R}\right)^2$$

Multi-source contributions are superposed onto the ambient baseline ($25^\circ\text{C}$).

---

## 4. Runtime Gizmo Control

`TransformControls` allows users to translate environmental props during simulation. Position updates automatically recalculate thermal field samples in `EnvStateManager.tick()`.

---

## 5. EnvironmentInspector Panel

- Displays selected environmental prop IDs, XYZ coordinates, and core temperatures ($80^\circ\text{C}$).
- Real-time sliders for falloff radius ($1.5\text{m}$) and ambient temperature baselines.
- Real-time sensor telemetry previews showing current thermal impact on active DHT bindings.

---

## 6. Thermal Alarm Causal Chain (`tpl_temp_alarm`)

```text
[world]      fire_01 at position (0.6, 0, 0.3) -> 0.7m to sensor_box
  → [env]    sampleTemperature = 52.3°C
  → [worker] setIdealInputs({ bind_dht_temp: 52.3 })
  → [pal]    +noise -> 52.1°C, warmup OK
  → [app]    if (temp > 50) { trigger_alarm(); set_led(HIGH); }
  → [worker] actuatorOutput: GPIO_LED=HIGH, BUZZER=HIGH
  → [mirror] LED brightness -> 3D indicator lamp glows red
  → [world]  led_window emissive intensity increases
```

---

## 7. Verification Criteria (A1~A10)

- **A1**: Heat source 3D rendering displays emissive cores and range indicators.
- **A3**: Dragging fire source closer to the sensor increases sampled temperatures.
- **A5**: Multi-source superposition accurately sums thermal contributions.
- **A7**: Complete closed-loop execution of the `tpl_temp_alarm` starter template.
- **A8**: Environmental props can be translated freely during active simulations.
