# 3.4 Runtime Lifecycle & Golden Trace Specification

<!-- i18n-meta
source: docs/zh/design/02-wink-micro-os/04-runtime-and-trace.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

| Item | Content |
|---|---|
| **Code-Mapping** | `wink-micro-os/runtime/` |
| **Related ADRs** | ADR-0003, ADR-0007, ADR-0053 |

Defines the cooperative runtime main loop, lifecycle hooks, and Golden Trace event logging.

---

## 1. Runtime Lifecycle

```text
wink_device_tree_init()
  ↓
app_init()
  ↓
while (running) {
    Phase 0: drain_irq_queue()
    Phase 1: tick_virtual_clock()
    Phase 2: run_cooperative_tasks()
    Phase 3: app_loop()
}
  ↓
wink_device_tree_deinit()
```
