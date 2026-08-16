# 联合仿真插件契约分阶段落地计划

| 项 | 内容 |
|----|------|
| 状态 | **Draft（草案）** |
| 创建日期 | 2026-07-20 |
| 关联技术设计 | [`../../tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md`](../../tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md) v0.3 |
| 关联 ADR | ADR-00XX（待产出） |
| 总周期 | 8 周（4 个 Phase，各 2 周） |
| 负责人 | TBD |

---

## 核心原则

**绝对不按模块拆分，每一阶段都产出完整可运行的端到端插件链路。**

不追求第一版就 100% 实现设计文档的所有细节。先跑通骨架（Phase 1），再用外设迁移需求反向驱动契约细节细化（Phase 2），再做生态脚手架（Phase 3），最后补闭环增强（Phase 4）。砍掉的边缘 case 明确标注"延后到哪个阶段补"，避免上下文爆炸、进度不可控。

---

## 总览

```
Week 0-2 ──► Week 2-4 ──► Week 4-6 ──► Week 6-8
 Phase 1     Phase 2     Phase 3     Phase 4
   MVP      5 外设通    生态能力    闭环增强
   ↓          ↓           ↓           ↓
 HC-SR04   LED/BTN     独立插件包   混沌/回放
 全链路    OLED/PWM    CI 门禁全    安全增强
 跑通      迁完         生效
```

---

## Phase 1：MVP（2 周，Week 0–2）

### 目标

用 HC-SR04 单插件跑通**完整端到端链路**，证明插件化架构是可行的。砍掉 80% 边缘特性，只保留核心骨架。

### 必做任务

| # | 任务 | 模块 | 关联设计章节 |
|---|------|------|-------------|
| 1.1 | 产出 ADR-00XX《联合仿真插件作为一等扩展单元》，Phase 0 评审通过 | 文档 | §1.4/1.5 |
| 1.2 | manifest schema 最小可用版（type / pins / properties / timingModel / stateChannels / pluginEntry） | unisim | §3 |
| 1.3 | `SimulationPlugin` 最小接口（`onBind` / `onPinChange` / `onStep`，仅限同步） | unisim | §4.2 |
| 1.4 | `PluginContext` 最小门面（`pin.read/write/schedulePinChangeAt` / `state.publish/snapshot` / `fault.report`） | unisim | §5.2 |
| 1.5 | `SimulationPluginHost` 最小实现（加载 manifest、实例化插件、绑定 pin、dispatch pin change 事件） | unisim | §2 |
| 1.6 | IPC 消息最小集（`STATE_UPDATE` 含 plugin channels / `SET_PIN_IDEAL` / `DISPATCH_PLUGIN_EVENT`） | embedded-frontend | §6 |
| 1.7 | `UltrasonicSimulationPlugin` 实现（HC-SR04 时序逻辑） | packages/peripheral-hc-sr04 | §8.2 |
| 1.8 | Conformance 套件最小版 L1–L5（生命周期 / pin 沙箱 / 确定性基础） | unisim/testing | §7.2 |
| 1.9 | 移除 `createUnisimImports.ts:315-327` 硬编码超声逻辑 | unisim | §1.1 |
| 1.10 | 移除 `SimWorker.ts:158-161` 硬编码 `ultrasonicEchoUs` / `getEchoPin` | unisim | §1.1 |

### 明确砍掉（延后）

| 特性 | 延后到哪个阶段 |
|------|---------------|
| 模拟量/ADC/DAC 支持 | Phase 2 |
| 总线支持（I2C/SPI/PWM） | Phase 2 |
| 异步 `onPinChange` 钩子与 `ctx` 失效 | Phase 2 |
| WCET 预算度量与降级 | Phase 2 |
| 电源域/`PowerFault` 状态机 | Phase 4 |
| 黑板双缓冲（跨插件） | Phase 3 |
| `envFactor` 慢机适配 | Phase 4 |
| `RNG_SEEDED` 确定性回放握手 | Phase 4 |
| `codegen` 三端派生对账 | Phase 2 |
| `overrideLayout` offset 自动计算 | Phase 2 |

### 验收标准（可验证，不接受百分比）

- [ ] `avoidance_car` E2E 测试全绿（C 端 `pal_gpio_write(TRIG, 1)` → Plugin 调度 ECHO → C 端 `pal_gpio_read(ECHO)` 读到正确电平 → 避障逻辑正常）
- [ ] 超声相关硬编码点全部清零：`createUnisimImports.ts:315-327` / `SimWorker.ts:158-161` / `observe-builder.ts:14-15` 内 `watchUltrasonic` 移除
- [ ] `UltrasonicSimulationPlugin` 通过 Conformance L1–L5
- [ ] 前端 UI（Canvas Glyph / 3D World Widget）通过 `TypedStateChannel` 正常显示超声测距值，无遗留硬编码通信

### 风险与预案

- 风险：`PinArbiter` 与 PluginHost 的事件分发顺序冲突导致时序漂移 → 预案：Phase 1 先不做级联深度限制，单个插件场景不会触发
- 风险：IPC 消息字段格式变更导致旧版本 UI 不兼容 → 预案：Phase 1 仅超声走新路径，其他外设保持旧路径一阶段，Phase 2 再全量切

---

## Phase 2：契约增强（2 周，Week 2–4）

### 目标

迁完 5 种基础外设（LED / Button / OLED / PWM / 电位器），反向驱动细化契约中缺失的总线、模拟量、WCET 等细节。前端 `wasm-simulation.worker.ts:227-247` 硬编码枚举清零。

### 必做任务

| # | 任务 | 模块 | 关联设计章节 |
|---|------|------|-------------|
| 2.1 | 补 `PluginContext.bus.i2c` 接口 + 地址分发逻辑 | unisim | §5.2 |
| 2.2 | 补 `PluginContext.bus.pwm` 接口（读占空比 + 注入） | unisim | §4.8 延伸 |
| 2.3 | 补模拟量最小实现：`pin.readAdcMv/writeDacMv` + `signal: 'analog'` manifest 字段 | unisim | §4.8 |
| 2.4 | `OledSimulationPlugin` 实现，迁完 OLED | packages/peripheral-oled | §1.5 |
| 2.5 | `LedSimulationPlugin` / `ButtonSimulationPlugin` 实现 | packages/peripheral-led / button | §1.5 |
| 2.6 | `PotentiometerSimulationPlugin` 实现（第一个模拟量插件，反向验证 ADC 契约） | packages/peripheral-potentiometer | §4.8 |
| 2.7 | `PwmMotorSimulationPlugin` 实现 | packages/peripheral-pwm-motor | §13.3 |
| 2.8 | WCET 预算度量简化版：仅超时报警 + trace，不做自动降频 | unisim | §7.3 |
| 2.9 | Conformance 套件 L6–L9（WCET / Reset 不变性 / Fault 归一 / Idempotent power off） | unisim/testing | §7.2 |
| 2.10 | codegen 最小版：从 manifest 生成 `dal_xxx_config_t` 结构体定义 | wink-micro-os/tools | §3.3 |
| 2.11 | 移除 `wasm-simulation.worker.ts:227-247` 内所有 device-specific 硬编码枚举 | embedded-frontend | §1.1 |

### 明确砍掉（延后）

| 特性 | 延后到哪个阶段 |
|------|---------------|
| 异步 `onPinChange` 钩子 | Phase 3（有需求再加，UART 类插件需要时） |
| PowerFault / Brownout 完整建模 | Phase 4 |
| 独立 Worker 看门狗（死循环防护） | Phase 4 |
| `envFactor` 慢机自适应 | Phase 4 |
| 黑板双缓冲（跨插件） | Phase 3（IMU + 运动学插件需要时） |

### 验收标准

- [ ] 5 种外设（LED / Button / OLED / PWM 电机 / 电位器）全部通过 Conformance L1–L9
- [ ] `wasm-simulation.worker.ts` 内不再有任何 `if (type === 'oled')` / `if (type === 'pwm')` 的 device-specific 分支
- [ ] `oled_dashboard` demo 全绿：按钮按下 → LED 亮 + OLED 刷新，全走插件化路径，无硬编码旁路
- [ ] 电位器旋钮 UI 拖拽 → `readAdcMv` 读到正确 mV 值 → C 侧 ADC 采样逻辑正常工作
- [ ] codegen 输出的 `dal_ultrasonic_config_t` 与手写版字段顺序、类型 100% 一致（diff = 0）

---

## Phase 3：生态能力（2 周，Week 4–6）

### 目标

外部开发者可以**零改动核心三仓**加新外设。CI 门禁全量生效，有 scaffold 脚手架，插件包发布流程跑通。

### 必做任务

| # | 任务 | 模块 | 关联设计章节 |
|---|------|------|-------------|
| 3.1 | manifest schema v1 正式冻结，产出 JSON Schema 校验文件 | unisim | §3 |
| 3.2 | `wink new peripheral <name>` scaffold 命令：一键生成 manifest / Plugin.ts / UI Glyph / conformance test 模板 | wink-cli | §12 |
| 3.3 | CI 门禁全量生效：`manifest-lint`（字段校验 / 对齐规则） + `abi-check`（semver 兼容校验） + `conformance` 全量跑 | CI / github actions | §3.3 / §7.2 |
| 3.4 | 独立插件包发布流程：`@wink/peripheral-*` scope + monorepo 依赖声明 | pnpm workspace | §1.5 |
| 3.5 | Conformance L10–L11（manifest binding 校验 / 时间单调性校验） | unisim/testing | §7.2 |
| 3.6 | 黑板双缓冲实现：本 dt publish 对其他插件不可见，统一 flush 后翻转 | unisim | §4.7 |
| 3.7 | 异步 `onPinChange` 钩子 + `ctx` Proxy 失效逻辑（settle 后失效） | unisim | §4.6 / §7.4 |
| 3.8 | 文档：《新增外设指南》 step-by-step，对齐 4 小时完成目标 | docs | §12 |

### 明确砍掉（延后）

| 特性 | 延后到哪个阶段 |
|------|---------------|
| 确定性回放完整握手（`RNG_SEEDED`） | Phase 4 |
| 插件热更新 / 动态加载 | Phase 4+ |

### 验收标准

- [ ] 新增一个 `NtcThermistorSimulationPlugin`（NTC 热敏电阻），整个过程**核心三仓（wink-micro-os / unisim / embedded-frontend）零改动**，仅新增 `packages/peripheral-ntc/` 目录下的文件
- [ ] 从 `wink new peripheral ntc-thermistor` 脚手架开始 → 写完逻辑 → 跑通 demo → 通过 CI，总耗时 < 4 小时
- [ ] CI 门禁：manifest 字段不符合 schema → 直接 Block PR；ABI 版本不兼容 → 直接 Block PR；conformance 不通过 → 直接 Block PR
- [ ] 《新增外设指南》文档完整，第三方开发者可以仅靠文档完成新插件开发

---

## Phase 4：闭环增强（2 周+，Week 6 起，可并行其他开发）

### 目标

混沌仿真、故障注入、确定性回放、安全增强。这一阶段是锦上添花，不影响基础功能使用，可按需调整优先级。

### 任务（按优先级排序）

| # | 任务 | 模块 | 关联设计章节 | 优先级 |
|---|------|------|-------------|--------|
| 4.1 | `RNG_SEEDED` IPC 完整握手 + 跨回放序列确定性验证 | unisim / embedded-frontend | §6 / §7.5 | P1 |
| 4.2 | WCET 自动降级：连续 3 次超预算 → `stepPeriodUs` 翻倍；连续 10 次 → `PowerFault` | unisim | §7.3 | P2 |
| 4.3 | 电源域完整建模：`PowerFault` 状态 + `brownoutThresholdMv` + 宿主注入掉电事件 | unisim | §3.6 / §4.1 | P2 |
| 4.4 | `envFactor` 慢机自适应：INIT 阶段标定基准，WCET 比对时自动缩放阈值 | unisim | §7.3 / R3 | P3 |
| 4.5 | 独立 Worker 看门狗：不受信任的第三方插件放入独立 Worker，超时 terminate | unisim | §7.5 / R10 | P3 |
| 4.6 | 多插件级联深度硬限制（`MAX_CASCADE_DEPTH = 8`）：超限截断 + fault 上报 | unisim | §4.4.1 | P3 |

### 验收标准

- [ ] 同一回放序列在 x86 Windows / ARM macOS / Linux 三平台跑出完全一致的结果（数值型字段容差 `1e-6` 内）
- [ ] 插件 `onStep` 故意写死循环 → Worker watchdog terminate + UI 友好报错（不整页卡死）
- [ ] 宿主注入 brownout 事件（供电电压 < 阈值）→ 插件进入 `PowerFault` → C 侧驱动读到对应错误码 → 符合真实硬件故障语义

---

## 跨阶段依赖与回滚预案

### 依赖关系

- Phase 1 必须全绿才能进 Phase 2（骨架通了才能迁其他外设）
- Phase 2 必须 5 种外设全迁完才能进 Phase 3（证明契约足够通用，不是只适配 HC-SR04）
- Phase 3 必须验证"新增 NTC 三仓零改动"才能宣布插件化架构正式上线
- Phase 4 所有任务都是正交增强，不影响基础功能，可随时暂停/砍

### 回滚预案

- **Phase 1 失败**：保留硬编码超声逻辑，回退到 Phase 0 之前的状态，损失 2 周，无其他影响
- **Phase 2 失败**：保留超声插件化，LED/Button/OLED 走回旧路径，契约范围缩小为"仅传感器类外设"，损失 2 周
- **Phase 3/4 失败**：无回滚成本，基础功能已经稳定，只是生态/增强能力没做到

---

## 资源需求与分工建议

| 角色 | 参与阶段 | 主要职责 |
|------|---------|---------|
| 架构师 | 所有阶段 | Phase 0 ADR 评审、阶段验收、契约边界裁定 |
| Unisim 内核开发 | 所有阶段 | PluginHost、PluginContext、IPC、Conformance 套件 |
| 前端 UI 开发 | Phase 1–2 | TypedStateChannel UI 对接、外设 Glyph 迁移、scaffold UI 部分 |
| C 侧工具开发 | Phase 2–3 | codegen 工具、manifest 与 DAL 对账校验 |
| CI/DevOps | Phase 3 | 门禁配置、独立插件包发布流程 |
| 文档 | Phase 3 | 《新增外设指南》、契约 API 文档 |

---

## 里程碑节点总览

| 里程碑 | 时间点 | 可验证产出 |
|-------|--------|-----------|
| M0 | Week 0 end | ADR-00XX Accepted，Phase 1 开工 |
| M1 | Week 2 end | HC-SR04 插件全链路跑通，avoidance_car E2E 全绿 |
| M2 | Week 4 end | 5 种外设迁完，前端 Worker 内 device-specific 分支清零 |
| M3 | Week 6 end | 新增 NTC 三仓零改动，CI 门禁全量生效 |
| M4 | Week 8+ | 确定性回放、看门狗、电源域故障建模完成 |


