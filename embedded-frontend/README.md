# Embedded Frontend — Wink Workbench

Vue 3 + TypeScript + Vite workbench for dual-target (Wasm / ESP32) simulation.

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck + production build |
| `npm run test` | Vitest unit / routing / mode-gate tests |
| `npm run test:e2e` | W1 smoke via **playwright-cli** (not `@playwright/test`) |

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
