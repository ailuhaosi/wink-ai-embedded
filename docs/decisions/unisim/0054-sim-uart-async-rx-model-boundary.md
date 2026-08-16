# ADR-0054：仿真 UART 异步 RX 模型边界

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-02 |
| 触发 | UniSim 3.0 mechanisms 审阅 P0-2；[审阅闭环 B2](../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md) |
| 影响范围 | 通道 2 UART；`wasm_bridge` 导入；IRQ/软中断；`dal_uart` 同源验证宣称 |
| 决策者 | 项目 Owner（会话确认 Accepted） |
| 关联既有 ADR | [ADR-0003](0003-simulation-fidelity-boundary.md)、[ADR-0018](../core/0018-pal-irq-api-narrowing.md)、[ADR-0053](0053-sim-same-timestamp-event-total-order.md)（同刻总序） |
| 关联活规范 | [`08-channel-routing.md`](../../design/04-wasm-simulation/02-mechanisms/08-channel-routing.md)、[`10-wasm-js-bridge-abi.md`](../../design/04-wasm-simulation/02-mechanisms/10-wasm-js-bridge-abi.md)、[`04-interrupt-model.md`](../../design/04-wasm-simulation/02-mechanisms/04-interrupt-model.md) |

---

## 背景（Context）

I2C/SPI 为**主机发起事务**，同 Worker 同步 Heap 切片模型成立。UART **接收**在真机上是异步字节流：字节随时间到达，可填环缓并触发 RX 中断。

现状（2026-08-02 核对）：

- 桥仅有 `js_pal_uart_write`（TX）；**无** `js_pal_uart_read` / 按虚拟时间注入字节的导入；
- 选型表曾写「Partial（总线有，UI 少）」——掩盖**模型缺口**；
- 默认 IRQ 延迟 O(`WINK_RUNTIME_TICK_MS`)≈10ms，对 115200（≈87µs/字节）不可在 `timing` 下主张一致（mechanisms `04` §8）。

若不钉契约，易对 `dal_uart` RX/环缓路径宣称「已同源仿真验证」。

---

## 方案比选（Options）

### 选项 A：MVP 明确不支持异步 RX（契约先行）

- 文档/API：UART = 主机侧 TX 与（若有）事务/帧级同步读；异步 RX / RX IRQ / 环缓时序 = **Planned**。
- Fail-Loud：尝试依赖未实现 RX 注入的路径 → 返回 `WINK_ERR_UNSUPPORTED` 或文档禁止宣称。
- 优点：立刻挡住过冲；零实现。
- 缺点：GPS NMEA / AT modem 类 App 仿真覆盖有限。

### 选项 B：最小「虚拟时间字节队列 + 软中断」

- JS/插件按 `s_virtual_us` 入队字节；调度 Phase 或 pull API 注入环缓；可选 `pal_irq_set_pending` 模拟 RX IRQ。
- 优点：可测部分 RX 状态机。
- 缺点：需新 ABI、与 ADR-0053 总序咬合、仍非位时序；工作量大。

### 选项 C：GPIO 位时序模拟 UART（否决）

- 否决：交叉爆炸、与通道 2 事务模型冲突、冻结主线程风险（mechanisms `08` 前言）。

---

## 决策结论（Decision）

**采纳选项 A** 作为现行契约边界；选项 B 作为 **Planned** 实现波次（另开计划；不阻塞文档 Active 门，阻塞 UART RX「高一致」宣称）。

契约要点：

1. **Landed / Partial**：TX（`js_pal_uart_write`）及主机发起的同步语义（若后续补对称 read，仍须标清是否异步）。  
2. **Planned**：按虚拟时间到达的 RX 字节流、RX IRQ、与真机环缓时序同源。  
3. **禁止**：在 Planned 落地前，用仿真绿灯作为 `dal_uart` RX 中断路径的 timing 证据。  
4. Accuracy：此类用例最多 `behavioral` 逻辑验收；`timing` 宣称 → HIL 或等选项 B。

---

## 后果与约束

- mechanisms `08`/`10` 已按本结论回写。  
- 选项 B 须引用 [ADR-0053](0053-sim-same-timestamp-event-total-order.md)（字节到期 vs wakeup/IRQ 总序）。  
- 与 ISR 延迟上限一致：即使 B 落地，默认同刻仍受 tick 粒度约束，不得宣称 µs 级 RX IRQ。

---

## 遵循与后续

1. **Accepted 2026-08-02**；① 已回写。  
2. 选项 B 实施计划独立编号（审阅闭环 C2）。  
3. CI 宣称门禁可与 Accuracy 标签校验一并 Planned。

---

*本 ADR 状态变更请在此记录：*

- 2026-08-02：Proposed（选项 A 契约 + B 实现 Planned）
- 2026-08-02：Accepted（项目 Owner 确认；回写 `08`/`10`）

