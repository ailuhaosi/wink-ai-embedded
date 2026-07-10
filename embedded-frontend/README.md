# Embedded Frontend — Wink Workbench

Vue 3 + TypeScript + Vite workbench for dual-target (Wasm / ESP32) simulation.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run test` | Vitest unit / routing / mode-gate tests |
| `npm run test:e2e` | W1 smoke via **playwright-cli** (not `@playwright/test`) |
| `npm run wasm:build:oled` | Build and copy `oled_dashboard` Wasm to public |
| `npm run wasm:build:avoidance` | Build and copy `avoidance_car` Wasm to public |
| `npm run wasm:copy` | Copy already built Wasm files to public |

## Wasm Simulator Demos

The Workbench supports running different C-side application firmware compiled to WebAssembly.

### 1. OLED Dashboard Demo (Primary Path)
1. Build the OLED firmware:
   ```bash
   npm run wasm:build:oled
   ```
2. Start the dev server and open the browser:
   ```bash
   npm run dev
   ```
3. Load the template in the 3D World panel: Click **📟 OLED 仪表盘演示**.
4. Switch to **Simulate** mode, and click **Play**.
5. **Interactive checks**:
   - **User Button**: Hold down the canvas button. The LED should light up, and the SSD1306 OLED screen will display **"Hi!"**.
   - **Fault injection**: Adjust `bounce_us` or `i2c_drop_permil` slider, and observe the live **Trace** entries/OLED behavior.

### 2. Avoidance Car Demo
1. Build the avoidance car firmware:
   ```bash
   npm run wasm:build:avoidance
   ```
2. In the 3D World panel, load **🚗 避障小车模板**.
3. Switch to **Simulate** mode and click **Play**.
4. Adjust the **Distance Slider** on the HC-SR04 sensor, and see the simulator process the distance values on the C-side.


## E2E (playwright-cli only)

Do **not** install `@playwright/test`. Use the `playwright-cli` command.

```bash
# one-shot orchestrator (starts vite on :5174 if needed)
npm run test:e2e

# or manual (preferred for agents):
npm run dev -- --host 127.0.0.1 --port 5174
playwright-cli open http://127.0.0.1:5174
playwright-cli run-code --filename=scripts/e2e-sim-smoke.mjs
playwright-cli close
playwright-cli open http://127.0.0.1:5174
playwright-cli run-code --filename=scripts/e2e-onboarding.mjs
playwright-cli close
```

Reuse an existing server: `SKIP_DEV=1 npm run test:e2e`.

Scripts (plain `async (page) => { ... }` — no trailing `;`, no `process.env`):

- `scripts/e2e-sim-smoke.mjs` — open → simulate → dual pane → Play no fault
- `scripts/e2e-onboarding.mjs` — A18 three-step + `wink_onboarding_completed`
- `scripts/run-e2e-cli.mjs` — orchestrator used by `npm run test:e2e`
