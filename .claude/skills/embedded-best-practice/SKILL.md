---
name: embedded-best-practice
description: 嵌入式 C 最佳实践路由器（双范式）。本工作区 wink-micro-os / chigo-micro 采用编译期静态分发（POD + 命名 API，禁用 vtable / container_of，见 ADR-0004）；另附运行期多态（ops vtable + container_of）作为阅读 Linux / Zephyr 源码的外部参考基线。在编写、修改或审查 C 代码、嵌入式固件、驱动、HAL、RTOS 任务或任何嵌入式平台代码时使用；用户提到 C 语言、嵌入式系统、MCU、STM32、驱动、外设或固件开发时也会触发。强制执行内存安全、线程安全、硬件交互规则与编辑后 12 阶段安全审查。
---

# 嵌入式 C 最佳实践（双范式路由器）

本工作区有**两套**嵌入式 C 架构范式。**动手前先判断场景**，读对应文档，不要混用。

> **文档集根（唯一权威源）**：`.claude/skills/embedded-best-practice/references/`（下文简称 `REF/`，skill 自带 bundle）。
> 该 `references/` 是本 skill 内容的**唯一 SSOT**——旧版在 `chigo-micro/docs/vendor/` 的副本已删除，勿再引用。
> 总览与决策树：`REF/index.md`

---

## ⚠ 第 0 步：判断你在哪种场景（最重要）

```
你在做什么？
│
├── 写 / 改 / 审  本项目代码（wink-micro-os、chigo-micro 的 C 固件 / 驱动 / HAL）
│     → 静态分发（本项目标准）
│     → 读 REF/static-dispatch/  +  REF/shared/
│     → ❌ 不要生成 vtable / container_of / struct xxx_ops（违反 ADR-0004）
│
├── 读 Linux / Zephyr / RT-Thread / STM32 HAL 源码，或理解 C 怎么手搓 OOP
│     → 运行期多态（外部参考基线，非本项目标准）
│     → 读 REF/runtime-polymorphism/
│
└── 任何 C 代码都要遵守的工程纪律（错误码 / 内存 / 并发 / 安全清单）
      → 读 REF/shared/（两种范式共用）
```

### 本项目 = 静态分发（ADR-0004）

本项目器件是 **POD 结构 + 命名式 API**：`dal_servo_set_angle(&dev, angle)`、
`motor_driver_set_outputs(&drv, out)`。**没有** `struct device_ops`、**没有** 运行期虚表、
**没有** `container_of`。换芯片 / 换器件靠**编译期选择**（CMake 链接 / codegen 静态绑定）。

> 即便本 Skill 被触发，写**本项目代码**时也**绝不**生成 `me->ops->on(me)` 这类运行期多态
> 代码——那是 `REF/runtime-polymorphism/` 的范式，本项目有意偏离。决策依据：
> `docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md`。
>
> （已知偏差：wink-micro-os 现有代码尚有 `bool`/`float` 返回 + `dal_*_get_distance` 旧命名，
> 属待迁移形态，见 `REF/static-dispatch/README.md` 偏差框。）

---

## 两范式适用场景

| 范式 | 何时用 | 何处读 |
|------|--------|--------|
| **静态分发**（本项目标准 ✅） | 写 wink-micro-os / chigo-micro 代码；拓扑编译期确定；AI 生成 + Wasm 仿真是 P0 | `REF/static-dispatch/` |
| **运行期多态**（外部参考基线 ⚠） | 读 Linux / Zephyr / RT-Thread 内核驱动源码；面试讲清 `container_of` / vtable 原理 | `REF/runtime-polymorphism/` |
| **共享工程纪律**（两者共用） | 任何 C 代码：错误码、内存、并发、RTC、双 target、安全清单 | `REF/shared/` |

完整对比表见 `REF/index.md`。

---

## 读哪个文档（按任务）

| 任务 | 读 |
|------|----|
| 设计本项目模块结构 / 写新器件驱动 | `REF/static-dispatch/architecture.md` → `templates.md` |
| 函数设计、命名、错误处理、const/static | `REF/shared/clean-code.md` |
| 错误码（0=ok/负数=错误，禁 `if(status)`） | `REF/shared/error-codes.md` |
| 堆 / 栈 / 缓冲区 / VLA·strcpy·sprintf 禁令 | `REF/shared/memory-safety.md` |
| 线程 / 临界区 / ISR→信号量→工作线程 / ISR 优先级上限 / volatile≠原子 | `REF/shared/concurrency.md` |
| RTC / 非阻塞驱动 / DMA / 看门狗 / NVS / 双 target 同源 | `REF/shared/realtime-hardware.md` |
| 工具链 / CI 正则门禁 / lint / 栈用量门禁 | `REF/shared/tooling.md` |
| 测试策略 / host 单测 / 帧解析 fuzzing / HIL | `REF/shared/testing.md` |
| 代码审查 / 排错（本项目） | `REF/static-dispatch/pitfalls.md` |
| 读内核源码 / 理解 C-OOP | `REF/runtime-polymorphism/architecture.md` |
| **每次编辑后（强制）** | `REF/shared/safety-checklist.md`（12 阶段） |

**如有疑问，先读 `REF/index.md`。** 安全关键代码，过度检查总好过检查不足。

---

## 强制的编辑后协议

每次代码修改后（无论多小），执行 `REF/shared/safety-checklist.md` 的**完整 12 阶段安全审查**。
这不是可选的——一行改动就可能引入内存泄漏、竞态或栈溢出。**修复任何问题后，从阶段 1 重新
跑完整清单**（修复本身可能引入新问题），重复直到全清。致命 / 高级问题必须本次解决。

> **风险分级触发（建议）**：纯注释 / 格式化 / 重命名改动可只跑阶段 1、10、12；普通 DAL/PAL
> 业务逻辑跑阶段 1、2、3、4、10、12；**触 ISR / DMA / 内存分配 / 共享状态 / 驱动 / 并发**
> 的改动必须跑**完整 12 阶段**。分级是为把精力压在真正安全相关的改动上，不是放松要求。

---

## 核心原则

1. **安全第一** —— 安全关键系统代码，每次修改都当生命攸关对待。
2. **面向对象设计思维** —— 数据 + 行为归位、封装、信息隐藏。**本项目以 POD + 命名 API 落地**
   （非 vtable）；运行期多态基线用 struct 嵌套 + ops 表。
3. **Clean Code** —— 函数只做一件事、命名揭示意图、无副作用、同抽象层级、DRY、表驱动。
4. **零容忍阻塞** —— 事件驱动 / RTC 执行模型下，整条调用链非阻塞；阻塞操作交给内部工作线程。
5. **验证到底层** —— 硬件交互查到寄存器级；永远不假设某 API 非阻塞。
6. **防御性编程** —— 断言内部契约、运行时校验外部输入、错误码传播、绝不静默吞失败。

## 硬性规则（速查 · 不可商量）

| 规则 | 限制 |
|------|------|
| 最大行宽 | 80 列 |
| 最大函数长度 | 80 行 |
| 最大嵌套深度 | 4 层 |
| 最大参数数 | 5 个（超过则组合成结构体） |
| 魔法数字 | 禁止，用宏（`U`/`UL` 后缀 + 括号） |
| 死代码 / 注释掉的代码 | 必须删除 |
| 非公共符号 | 必须 `static`（文件级 static 用 `s_` 前缀，全局 `g_`） |
| 未修改的指针参数 | 必须 `const`（但不要 const 值参数） |
| 整数类型 | 必须 `stdint.h` 固定宽度（禁裸 int/short/long） |
| 头文件 | 必须有保护宏 + 自包含 |
| 错误码检查 | 禁 `if(status)`（负数 truthy），用 `if(status < 0)` |
| 实时路径 | 禁 `malloc/free`（PID 回调 / ISR / Wasm 热路径） |
| 字符串拷贝 | 禁 `strcpy`/`sprintf`/`strncpy`，用 `snprintf`（见 `REF/shared/memory-safety.md`） |
| 命名 | 纯 snake_case：函数 `模块_动作()`、类型 `xxx_t`、宏 `UPPER` |

> 详见 `REF/shared/clean-code.md`。

## 上下文感知编码

写任何代码前，先看周围代码库：

1. **同目录兄弟文件**如何用信号 / 回调 / 事件 / 命名 API —— 跟随同一模式。
2. **头文件包含路径** —— 搜项目里其他文件如何 include 同一头文件，用同样路径格式。
3. **堆内存 API** —— 嵌入式可能用非标准 allocator（`platform_malloc` / `pvPortMalloc`），查现有用法跟随，**绝不混用**。
4. **设备访问** —— 本项目用命名 API（`dal_xxx_read(&dev, ...)`）传实例指针，**不要**套 vtable。
5. **编码风格** —— 匹配同目录文件的结构与格式约定。

## 驱动开发检查清单（本项目 · 静态分发）

1. 器件结构是纯 **POD**（无函数指针 / 无 ops / 无父类嵌入）。
2. 公共 API 是命名自由函数，返回 `wink_status_t`（0=ok，负数=错误）。
3. 内部需要非阻塞时，用「工作线程 + 消息队列 + 回调」封装在模块内；公共 API 入队即返回。
4. 周期性轮询留在驱动内部，不对外暴露 poll 接口。
5. 错误状态变化通过回调通知上层。
6. 完成后文档化：初始化顺序、线程安全保证、回调上下文、清理要求（init/deinit 对称）。

> vtable 仅在「同抽象需切换多算法」（策略模式，如 `control_algo_t`）时合法，且封装在模块内部、
> ops 是 const、**绝不用于器件抽象**。见 `REF/static-dispatch/architecture.md` 形态 4。

## SOLID / Clean Code 速查

- **SRP** —— 一个模块 = 一个职责 = 一个变更理由。
- **OCP** —— 通过扩展而非修改。*静态分发*：加命名 API + Device Registry 条目；*运行期多态*：加 ops 表项。
- **LSP** —— 所有实现遵守同一契约（静态分发里即同一命名 API 语义）。
- **ISP** —— 使用者只依赖其用到的接口。
- **DIP** —— 高层依赖抽象（静态分发里即 PAL/DAL 命名契约），不依赖底层芯片细节。

---

## 附：文档集结构

```
references/                  本 skill 自带 bundle（.claude/skills/embedded-best-practice/references/）—— 唯一 SSOT
├── index.md                 两范式对比 + 决策树 + 导航
├── shared/                  范式无关纪律（两者共用）
├── static-dispatch/         ✅ 本项目标准（wink-micro-os + chigo-micro）
└── runtime-polymorphism/    ⚠ 外部参考基线（zhaoming/Linux，非本项目标准）
```

> 注：本 skill 的全部详细规范都在 `references/`（skill 自带 bundle，随 skill 走、相对路径自洽）。
> 旧版在 `chigo-micro/docs/vendor/embedded-best-practice/` 的副本已删除——`references/` 是唯一权威源。
