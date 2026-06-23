# ✅ 静态分发 —— 本项目实际采用的标准

> **本项目标准**。在 `wink-micro-os/` 与 `chigo-micro/` 里写 C 代码时，**以本文件夹为准**。
> 不要套用 [../runtime-polymorphism/](../runtime-polymorphism/)（那是外部参考基线，本项目有意偏离）。

---

## 一句话

**编译期静态分发 + 命名式 API + POD 结构体**。没有 `struct device_ops`、没有运行期虚表、
没有 `container_of`。换芯片 / 换器件靠**编译期选择**（CMake 链接 / codegen 静态绑定），
不靠运行期查表。

决策依据：[ADR-0004](../../../../../docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md)。

---

## 为什么偏离业界通用的运行期多态

本项目（Wink-AI / WinkMicroOS）不是通用 RTOS，而是「**以 LLM 代码生成为核心体验、以
浏览器端高保真 Wasm 仿真为命门**」的垂直平台。两条 P0 约束压倒了「运行期扩展性」：

| 约束 | 静态分发优势 | 运行期多态劣势 |
|------|--------------|----------------|
| **AI 生成友好** | 命名直观（`dal_ultrasonic_read`），LLM 可 100% 确定性生成、静态校验指针安全 | 指针强转 / `container_of` 嵌套易幻觉，难静态分析 |
| **Wasm 仿真性能** | 无 `call_indirect`，控制流可优化；可旁路直通渲染器 | 大量 `call_indirect` 破坏优化、增大体积 |
| RAM | 每实例零指针开销 | 每实例 +4~8B ops 指针 |
| 可调试 | gdb 直接看 POD 全部数据 | 虚表迷雾 |

---

## ⚠ 代码现状 vs 目标（重要：阅读本文件夹代码前必看）

wink-micro-os 的**实际代码尚处于 ADR-0001 / ADR-0004 落地前**的形态，与文档目标有偏差。
**以 ADR / 设计文档为 SSOT**，下表是已知 drift（迁移 delta 见 [evolution.md](./evolution.md)）：

| 项 | 代码现状（旧） | 目标（ADR） | 说明 |
|----|----------------|-------------|------|
| 返回类型 | `bool` / `float` + 哨兵 `-1.0f` | `wink_status_t`（0=ok，负数=错误） | ADR-0001 |
| 超声波读 API | `dal_ultrasonic_get_distance` | `dal_ultrasonic_read` | Device Registry SSOT 命名 |
| `js_sim_*` 签名 | 三处冲突（代码 / DAL doc / Registry） | 以 Registry 为准 | SSOT 未强制，反例 |
| `device_tree.c` | **尚未生成**（codegen 设计态） | 由 codegen 静态生成 | 见 templates.md |
| `#ifdef SIMULATION` | 整函数重复（过宽） | 只旁路最低物理信号层 | ADR-0003 |

> 读代码看到 `bool`/`float` 返回是「旧形态待迁移」，不是「本项目就这么写」。写新代码
> 请用 `wink_status_t` 目标形态。

---

## SSOT（单一事实来源）

写本文件夹文档时遵循的权威来源：

- **ADR-0004**：静态分发 vs 运行期 ops 选型（`docs/design/decisions/0004-...`）
- **ADR-0001**：错误码符号约定（`docs/design/decisions/0001-...`）
- **ADR-0002**：双 target 同源编译（`docs/design/decisions/0002-...`）
- `docs/design/02-wink-micro-os/01-dal-device-abstraction.md`、`02-pal-platform-abstraction.md`
- `docs/design/07-platform-governance/01-device-model-registry.md`（Device Registry / SSOT）
- 实际代码：`wink-micro-os/dal/`、`wink-micro-os/pal/`、`wink-micro-os/targets/`、`chigo-micro/project/embedded/`

> 本文件夹是上述 SSOT 的**蒸馏 + 模板 + 陷阱**，不替代它们。ADR 变更时以 ADR 为准。

---

## 导航

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | BAL→DAL→PAL→Targets 分层 + 4 种静态分发形态 |
| [templates.md](./templates.md) | DAL POD 器件 / device_tree codegen / 平台文件切换 / control_algo 局部 vtable 模板 |
| [pitfalls.md](./pitfalls.md) | 命名漂移 / 签名冲突 / SIMULATION 过宽 / wasm 假锁 / 何时回退运行期多态 |
| [evolution.md](./evolution.md) | 局部多态化退出路径 + bool/float→wink_status_t 迁移 delta |

> 范式无关的工程纪律（错误码、内存、并发、清单）在 [../shared/](../shared/)，同样适用。
