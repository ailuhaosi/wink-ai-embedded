# 嵌入式 C 架构最佳实践 · 双范式导览

> 本文档集按 **dispatch 机制** 分两个范式 + 一份范式无关的工程纪律。
> **在 wink-micro-os / chigo-micro 写代码前，先读本页的决策树。**

---

## 治理摘要（务必先读）

本文件夹下有**两个性质不同的子目录**：

| 子目录 | 性质 | 是否本项目标准 |
|--------|------|----------------|
| [`static-dispatch/`](./static-dispatch/README.md) | 本项目实际采用的架构 | ✅ **是**——写本项目代码以此为准 |
| [`runtime-polymorphism/`](./runtime-polymorphism/README.md) | 外部参考基线（zhaoming/Linux 风格） | ⚠ **否**——本项目有意偏离，仅供阅读内核源码参考 |
| [`shared/`](./shared/clean-code.md) | 范式无关的工程纪律 | ✅ 两种风格共用 |

> ⚠ **Skill 触发注意**：本 docset 已注册为 Claude Code Skill。写本项目代码时，
> **不要**让 Skill 把你导向 `runtime-polymorphism/` 的 vtable / `container_of` 范式——
> 那违反 [ADR-0004](../../../../docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md)。
> 正确路由见下方决策树。

---

## 总体目标（两范式共同北极星）

```
换主控芯片，业务代码零修改。
换电机 / 换器件，业务零修改。
换协议，业务零修改。

加新功能几乎都是「加一个文件」，老代码很少动。
```

两范式**目标一致**，只是达到目标的 dispatch 机制不同。

---

## 两范式对比

| 维度 | 运行期多态（参考基线） | 静态分发（本项目标准 ✅） |
|------|------------------------|--------------------------|
| 调用形式 | `me->ops->on(me)` 两次指针跳转 | `dal_servo_set_angle(&dev, ...)` 直调 |
| 对象结构 | base 嵌入 + `ops` 指针 | 扁平 POD，无函数指针 |
| 子类恢复 | `container_of` 减偏移 | 不需要，编译期类型已知 |
| 注册 / 绑定 | `MODULE_INIT` 链接段自动收集 | `device_tree.c` codegen / CMake 文件链接 |
| 扩展方式 | 加 ops 项 / 加子类文件 | 加命名 API + Device Registry 条目 |
| 运行期热插拔 / 换型号 | ✅ 原生支持 | ❌ non-goal（编译期确定） |
| 统一句柄（数组 / 链表遍历） | ✅ | ❌ |
| **AI 生成友好度** | ❌ 指针强转 / container_of 易幻觉 | ✅ 命名确定、可静态校验 |
| **Wasm 仿真** | ❌ `call_indirect` 破坏优化、体积大 | ✅ 可旁路直通、零跳转 |
| RAM 开销 | 每实例 +4~8B ops 指针 | 0 |
| 可调试性 | 虚表迷雾 | gdb 直接看 POD 全部数据 |
| 适用场景 | 通用 RTOS / Linux / Zephyr，需运行时灵活性 | 低代码编排 + AI 生成 + Web 仿真 |
| 代表实现 | Linux 内核、Zephyr、RT-Thread | wink-micro-os DAL、chigo-micro |
| SSOT | zhaoming book（外部） | ADR-0004 + `02-wink-micro-os/`（本项目） |

---

## 决策树：我该读哪个？

```
你在做什么？
│
├── 在 wink-micro-os / chigo-micro 里 写 / 改 / 审 C 代码
│     → static-dispatch/（本项目标准）+ shared/（纪律）
│     → 切勿套用 runtime-polymorphism/ 的 vtable / container_of（违反 ADR-0004）
│
├── 读 Linux / Zephyr / RT-Thread / HAL 库源码，理解 C 怎么手搓 OOP
│     → runtime-polymorphism/（外部参考基线）
│
└── 任何 C 代码都要遵守的工程纪律（错误码 / 内存 / 并发 / 安全清单）
      → shared/（范式无关，两者共用）
```

---

## 快速导航

### `shared/`（范式无关纪律 · 两者共用）

| 文档 | 内容 |
|------|------|
| [clean-code.md](./shared/clean-code.md) | 硬限表、命名约定、函数设计、防御式编程、const/static、BARR-C、MISRA-C/CERT-C 对齐 |
| [error-codes.md](./shared/error-codes.md) | 0=成功/负数=错误、禁 `if(status)`、两项目错误码布局 |
| [memory-safety.md](./shared/memory-safety.md) | 实时路径禁 malloc、堆规、VLA/strcpy/sprintf/strncpy 禁令、栈/缓冲 |
| [concurrency.md](./shared/concurrency.md) | 线程安全选择表、临界区四规、ISR→工作线程、ISR 优先级上限、volatile≠原子≠内存序 |
| [realtime-hardware.md](./shared/realtime-hardware.md) | RTC 合规、非阻塞驱动、DMA+环形+D-Cache、看门狗设计原语、NVS 校验、双 target 同源（ADR-0002） |
| [tooling.md](./shared/tooling.md) | 编译器警告门禁、clang-tidy/cppcheck、**CI 正则门禁**、栈用量门禁、双 target 一致性 |
| [testing.md](./shared/testing.md) | 虚实同源的测试总纲：host 单测共享层、帧解析 fuzzing、HIL、静态分发可测性红利 |
| [safety-checklist.md](./shared/safety-checklist.md) | 12 阶段强制编辑后清单（风险分级触发）+ 严重性分级 |

### `static-dispatch/`（✅ 本项目标准）

| 文档 | 内容 |
|------|------|
| [README.md](./static-dispatch/README.md) | 治理声明 + SSOT + **代码现状 vs 目标偏差框** |
| [architecture.md](./static-dispatch/architecture.md) | BAL→DAL→PAL→Targets 分层 + 4 种静态分发形态 |
| [templates.md](./static-dispatch/templates.md) | POD 器件 / device_tree codegen / 平台文件切换 / control_algo vtable 模板 |
| [pitfalls.md](./static-dispatch/pitfalls.md) | 命名漂移 / 签名冲突 / SIMULATION 过宽 / wasm 假锁 |
| [evolution.md](./static-dispatch/evolution.md) | bool/float→wink_status_t 迁移 + 局部多态化退出路径 |

### `runtime-polymorphism/`（⚠ 外部参考基线 · 非本项目标准）

| 文档 | 内容 |
|------|------|
| [README.md](./runtime-polymorphism/README.md) | 外部基线声明 + 适用边界 + 出处 |
| [architecture.md](./runtime-polymorphism/architecture.md) | 4 层（应用/抽象/实现/注册）+ ops vtable + container_of |
| [templates.md](./runtime-polymorphism/templates.md) | 复制即用的 vtable 骨架 |
| [pitfalls.md](./runtime-polymorphism/pitfalls.md) | 10 陷阱（含修正后的陷阱 3/6） |
| [evolution.md](./runtime-polymorphism/evolution.md) | 5 阶段 OOP 演化路径 |
| [reference.md](./runtime-polymorphism/reference.md) | Linux/C++/框架对照 + 与静态分发对照 |

---

## 一句话

> 本项目（WinkMicroOS / chigo-micro）采用 **静态分发**——因为 AI 可生成性与 Wasm 仿真性能
> 是 P0 约束，而拓扑在编译期就确定了。运行期多态是理解 Linux 内核的**参考基线**，
> 不是本项目写代码的范式。两者共享同一份工程纪律（`shared/`）。
