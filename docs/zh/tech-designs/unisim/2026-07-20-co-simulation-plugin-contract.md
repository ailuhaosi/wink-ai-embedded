# 联合仿真插件契约规范 (Co-Simulation Plugin Contract)

| 项 | 内容 |
|---|---|
| **状态** | **Accepted** |
| **关联 ADR** | ADR-0003、ADR-0009 |

定义仿真外设插件的生命周期钩子（`create`, `step(Δt)`, `onPinWrite`, `onBusWrite`, `reset`, `destroy`）与 TS 接口规范。
