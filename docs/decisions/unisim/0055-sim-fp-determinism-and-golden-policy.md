# ADR-0055：仿真物理算法浮点确定性与 Golden 策略

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已采纳）** |
| 日期 | 2026-08-02 |
| 触发 | UniSim 3.0 mechanisms 审阅 P0-4；[审阅闭环 B3](../../implementation-plans/unisim/2026-08-02-unisim3-mechanisms-review-closure-plan.md)；回写 [ADR-0002](0002-dual-target-compilation.md) / [ADR-0003](0003-simulation-fidelity-boundary.md) 容差链 |
| 影响范围 | `targets/common/wink_sim_physical`；host/wasm 构建 flag；golden 向量；mechanisms `06` |
| 决策者 | 项目 Owner（会话确认 Accepted） |
| 关联既有 ADR | [ADR-0002](0002-dual-target-compilation.md)、[ADR-0003](0003-simulation-fidelity-boundary.md)、[ADR-0009](0009-physical-behavior-simulation-fault-injection.md) |
| 关联活规范 | [`06-physical-degradation.md`](../../design/04-wasm-simulation/02-mechanisms/06-physical-degradation.md)、assurance golden 场景 |

---

## 背景（Context）

物理退化算法宣称 host vs wasm **byte-identical**、以及「1000 次零偏差」（mechanisms `06` Test-L*）。同时：

- WinLibs/x86-64 与 wasm 的 FPU（FMA 收缩、fast-math、中间精度）**不保证**逐位一致；
- ADR-0002 已将「浮点编译选项与容差」降级并入 ADR-0003 Golden Trace，但 **未**形成可执行契约；
- `wink_phys_rc_lowpass` 等已避免 `expf`，不足以覆盖全部漂移源。

若继续写「跨 host/wasm L3 零偏差」而无 flag/容差策略，CI 将在工具链漂移时假红或假绿。

---

## 方案比选（Options）

### 选项 A：强制全链路 bit-exact（含跨 host/wasm）

- 统一 `-ffp-contract=off`、禁 fast-math、固定 libm、可能软浮点。  
- 优点：口号简单。  
- 缺点：成本高、与 ESP 真机 flag 可能冲突；收益有限（行为级仿真本非 cycle-exact）。  
- **不作为默认**。

### 选项 B：分层主张（**采纳方向**）

| 主张范围 | 策略 |
|---|---|
| **同** toolchain + **同** binary 重复跑 | bit-exact（Test-L3「1000 次」仅对此） |
| **host vs wasm**（或跨版本编译器） | **tolerance band**（相对/ULP/绝对值按算法标注）；单独证明后才可升格 bit-exact |
| 构建 | 物理算法 / golden 目标：**禁止 `-ffast-math`**；声明 FP contract；CI grep/核查 **Planned** |
| 算法 | 固定中间精度（float vs double）并在单测注释写死；继续避免无必要 libm |

### 选项 C：放弃数值 golden，只测单调/边界

- 过弱；去抖/RC 回归价值下降。否决为唯一策略；可作为无 golden 的补充断言。

---

## 决策结论（Decision）

**采纳选项 B**。

1. 文档与 CI 文案禁止把「host↔wasm」默认写成 byte-identical，除非该用例元数据声明 `fp_mode=bit_exact` 且已证明。  
2. 默认 `fp_mode=tolerance`；容差表挂 assurance / 单测头注释（**第一版数表 Planned**，本 ADR 不冻结具体 ULP）。  
3. 构建契约：仿真物理与 golden 目标禁 fast-math；落地前标 **Planned**，不得宣称已门禁。  
4. ADR-0002/0003 指向本 ADR 为浮点/Golden **执行细节 SSOT**。

---

## 后果与约束

- mechanisms `06` §8 已回写。  
- PRNG 全局消费序变更仍会破 golden（与浮点正交）——见 `06` §7；重构须重基。  
- 真机 ESP 浮点（FTZ/DAZ 等）**不**在本 ADR 要求与 wasm bit-exact。

---

## 遵循与后续

1. **Accepted 2026-08-02**；① `06` 与 ADR-0002/0003 交叉引用已回写。  
2. 实施：CMake/CI 禁 fast-math 核查（审阅闭环 C3）。  
3. 选 1～2 个 RC/debounce golden 标注 `fp_mode` 作样板。

---

*本 ADR 状态变更请在此记录：*

- 2026-08-02：Proposed（分层 bit-exact / tolerance）
- 2026-08-02：Accepted（项目 Owner 确认；回写 `06` + ADR-0002/0003 指针）

