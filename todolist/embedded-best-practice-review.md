# embedded-best-practice 文档改进 Todo

## 总体评价

当前 `.claude/skills/embedded-best-practice` 写得比较成熟，已经不是简单搬运 `zhaoming_embedded` 的通用嵌入式 C 规范，而是结合 WinkMicroOS 做了项目化裁剪：

- 明确把运行期 OOP / `ops` / `container_of` 隔离到阅读类 skill。
- 围绕静态分发、POD、命名 API、双 target、AI 生成友好性建立规则。
- 保留并强化了 zhaoming 文档中安全、并发、内存、硬件交互等通用纪律。

后续重点不是重写，而是补齐“静态分发架构在工程落地时还缺哪些契约”。

---

## Todo 1：补充静态分发的反例边界

当前文档明确说明本项目禁止用 `ops` / `container_of` 做器件抽象，但还可以补充：哪些场景本来就不适合静态分发。

建议补充场景：

- 运行期热插拔设备。
- Linux / Zephyr / RT-Thread 风格统一 device model。
- 插件式驱动框架。
- 运行期加载算法或协议。
- 大量同类设备需要统一运行期枚举和调度。

目的：让 ADR-0004 更有说服力，避免“禁止运行期多态”看起来像绝对化规则。

---

## Todo 2：增加 DAL / PAL 接口契约模板

建议增加一个 API contract 模板，要求每个公共接口说明：

- 是否可能阻塞。
- 是否线程安全。
- 是否 ISR-safe。
- 参数单位、范围、边界行为。
- 回调执行上下文。
- 返回错误码集合。
- 是否允许重复 init / deinit。
- 调用前置条件和后置条件。

示例字段：

```text
API:
- Blocking:
- Thread-safe:
- ISR-safe:
- Callback context:
- Input range:
- Error codes:
- Ownership:
- Preconditions:
- Postconditions:
```

价值：比单纯代码模板更能约束 AI 生成代码。

---

## Todo 3：补充静态 codegen 初始化顺序机制

zhaoming 文档中有 `INIT_DEVICE_EXPORT` / section-based initcall，但 WinkMicroOS 不采用运行期注册。

建议补充静态分发版本：

- `device_tree.c` 生成哪些静态实例。
- `device_tree_init_all()` 初始化顺序如何生成。
- DAL / PAL / target 的依赖图如何表达。
- 初始化失败如何回滚。
- 哪些 init 可以重复调用，哪些不可以。
- 生成代码如何保证拓扑顺序正确。

这是当前文档相对 zhaoming 最大的工程落地缺口之一。

---

## Todo 4：补充资源所有权与生命周期模型

POD 静态实例虽然简单，但仍需要明确生命周期规则。

建议补充：

- 谁创建设备实例。
- 谁初始化。
- 谁销毁或是否禁止销毁。
- 指针是否允许长期缓存。
- 回调 `ctx` 生命周期由谁保证。
- 静态全局设备是否允许 deinit。
- init 失败后对象状态是否可重试。
- PAL 资源和 DAL 资源谁负责释放。

建议新增 `lifecycle.md`，或放入 `static-dispatch/templates.md`。

---

## Todo 5：补充仿真保真分级

当前已有 `#ifdef SIMULATION` 收窄原则，但可以进一步定义仿真保真等级。

建议分级：

- L0：纯 mock，只保证 API 可调用。
- L1：行为仿真，返回合理物理量。
- L2：时序近似，模拟延迟、超时、边界时间。
- L3：错误注入，支持硬件失败、丢帧、timeout。
- L4：HIL 对齐，与真实硬件数据校准。

价值：帮助判断某个仿真实现是否足够支撑“仿真即真机”。

---

## Todo 6：补充错误注入策略

测试文档已经说明要测失败路径，但还可以补充如何制造失败。

建议 PAL / target stub 支持注入：

- GPIO 读写失败。
- PWM 设置失败。
- I2C / SPI timeout。
- UART 丢帧、CRC 错、半帧。
- NVS magic / version / CRC 错。
- queue full。
- mutex 创建失败。
- malloc / allocator 失败。
- time jump / tick overflow。

价值：把“错误码传播”和“失败恢复”从规则变成可验证证据。

---

## Todo 7：增加 AI 生成代码专用禁令

这是 skill 文档，建议明确约束 AI 常见翻车点。

建议禁令：

- 不得发明不存在的 PAL / DAL API。
- 不得绕过 DAL 直接调用 HAL / target 实现。
- 不得自动创建隐藏全局状态。
- 不得吞错误码。
- 不得扩大 `#ifdef SIMULATION` 范围。
- 不得把运行期 `ops` / `container_of` 用作器件抽象。
- 不得假设 wasm 单线程仿真能证明真机并发安全。
- 不得引入未在项目中出现过的第三方库。

---

## Todo 8：补充静态分发模式库

zhaoming 的 `design-patterns.md` 很完整，但偏运行期多态。WinkMicroOS 需要一组静态分发版本的模式。

建议收录：

- POD + 命名 API。
- 表驱动状态机。
- 编译期设备表。
- X-macro 生成枚举、名称、配置表。
- CMake source selection。
- codegen registry。
- PAL stub / fake target。
- 内部策略 vtable 例外。
- 静态 observer table。
- 静态 command dispatch table。

价值：让 AI 有可复制的“正确形状”。

---

## Todo 9：补充迁移指南

当前 `evolution.md` 已有方向，但建议更任务化。

建议迁移路径：

- `bool` 返回值迁移到 `wink_status_t`。
- `float get_xxx()` 迁移到 `wink_status_t xxx_get(..., float *out)`。
- 旧命名迁移到统一 `dal_xxx_action()`。
- poll API 迁移到 callback / worker。
- runtime ops 迁移到 POD + named API。
- 宽泛 `#ifdef SIMULATION` 下沉到 PAL / target 层。

每类迁移最好提供 before / after 示例。

---

## Todo 10：补充 grilling 问题清单

这些问题可作为设计评审或 ADR grilling checklist。

- 如果一个项目有 8 个超声波传感器，如何枚举它们而不引入统一 base device？
- 如果前端拓扑运行期变化，静态 codegen 是否仍成立？
- 如果 wasm 仿真是单线程，如何证明 ESP32 真机并发没问题？
- 如果 AI 生成一个新 DAL，谁保证初始化顺序正确？
- 如果 PAL API 在 wasm 永远成功，真机失败路径靠什么测试？
- 如果 DAL API 需要回调，回调上下文如何写入契约？
- 如果某个 PAL 实现阻塞，谁负责把阻塞封装进 worker？
- 如果设备 init 一半失败，资源回滚顺序在哪里定义？
- 如果 NVS 配置损坏，默认值和安全降级策略在哪里声明？
- 如果静态分发导致 API 数量膨胀，命名和目录如何治理？

---

## 优先级建议

### P0

1. DAL / PAL 接口契约模板。
2. 静态 codegen 初始化顺序机制。
3. 资源所有权与生命周期模型。
4. 错误注入策略。

### P1

1. 仿真保真分级。
2. AI 生成代码专用禁令。
3. 静态分发模式库。

### P2

1. 静态分发反例边界。
2. 迁移指南细化。
3. grilling 问题清单常态化。
