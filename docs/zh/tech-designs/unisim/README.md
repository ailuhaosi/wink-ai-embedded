# 仿真引擎领域技术方案 (UniSim Tech-Designs RFC)

本目录归档 `unisim` Wasm 仿真引擎、虚拟时钟、通道旁路与联合仿真插件的技术方案。

---

## 📜 核心方案列表

| 方案文档 | 核心内容 | 对应 ADR |
| :--- | :--- | :--- |
| [2026-07-02-concurrency-stress-sample-design.md](./2026-07-02-concurrency-stress-sample-design.md) | 仿真并发压力测试用例与时钟漂移校验设计 | ADR-0013, ADR-0014 |
| [2026-07-12-sim-observation-layers-design.md](./2026-07-12-sim-observation-layers-design.md) | 仿真多层观测体系与 Golden Trace 捕获架构 | ADR-0025 |
| [2026-07-19-arduino-semantic-sim-json-gate-design.md](./2026-07-19-arduino-semantic-sim-json-gate-design.md) | Arduino 语义仿真与 JSON 门控机制设计 | ADR-0040 |
| [2026-07-20-co-simulation-plugin-contract.md](./2026-07-20-co-simulation-plugin-contract.md) | 联合仿真插件契约与 Wasm-JS Bridge 通信协议 | ADR-0042 |
