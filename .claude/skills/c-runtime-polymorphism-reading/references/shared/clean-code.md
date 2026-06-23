# Clean Code 与代码风格（范式无关）

> 适用范围：**两种架构风格共用**（运行期多态参考基线 + 本项目静态分发）。
> 本文件只讲范式无关的工程纪律。风格选择见 [../index.md](../index.md)。

---

## 硬性限制（不可商量）

| 规则 | 限制 |
|------|------|
| 最大行宽 | 80 列（超长必须换行） |
| 最大函数长度 | 80 行（接近上限就拆子函数） |
| 最大嵌套深度 | 4 层（用 early return / guard clause 降嵌套） |
| 最大函数参数数 | 5 个（更多就组合成配置结构体） |
| 死代码 / 注释掉的代码 | 必须删除 |
| 未使用的符号 | 必须删除 |

---

## 命名约定（以本项目为准）

> ⚠ **本项目用纯 snake_case**。zhaoming 参考基线用 `PascalCase_t` 类型 + `Module_Action`
> 函数名——那是外部风格，**本项目不采用**，阅读其文档时注意区分。

| 元素 | 约定 | 示例 |
|------|------|------|
| 宏 / 常量 | 全大写蛇形 | `NUM_JOINTS`、`PID_PERIOD_US`、`RX_BUFFER_SIZE` |
| 类型 | snake_case + `_t` | `motor_driver_t`、`dal_servo_t`、`cmd_frame_t` |
| 函数 | `模块_动作()` 小写蛇形 | `motor_driver_init`、`dal_servo_set_angle` |
| 局部变量 / 结构体成员 | 小写蛇形 | `retry_count`、`current_angle` |
| 枚举值 | `UPPER_CASE` 或 `前缀_名称` | `MOTOR_MODE_IDLE`、`CMD_TYPE_TRAJECTORY` |
| 文件级 static 变量 | `s_` 前缀 | `static int s_pending_count;` |
| 全局变量 | `g_` 前缀 | `g_motor_driver`、`g_state_mutex` |

**命名即文档**：作用域越大，名字越长越完整。循环计数器可短（`i`、`n`）；公共函数必须
带完整上下文（`motor_driver_check_overcurrent`，不是 `check`）。布尔用 `is_`/`has_`/
`can_`/`should_` 前缀。

---

## 函数设计

- **单一职责（SRP）**：能用「和」描述的函数就该拆。`validate_and_send` → `validate_packet` + `send_packet`。
- **抽象层级一致**：一个函数内所有操作处于同一抽象层级。不要把高层编排和裸寄存器位操作混在一起。
- **命令-查询分离（CQS）**：函数要么执行动作（命令），要么返回信息（查询），不要兼而有之。例外：原子「取并改」（如 `queue_pop`）。
- **无副作用**：一个 `validate_xxx` 偷偷改全局状态或写硬件，是缺陷。
- **参数 ≤ 5**：超过就打包成配置结构体（如 7 参 `uart_init` → 传 `uart_config_t`）。

---

## 防御性编程：断言 vs 运行时检查

| 情况 | 机制 |
|------|------|
| 程序员错误（不应该发生） | `ASSERT()` |
| 外部 / 不可信输入（用户、网络、传感器、跨模块调用） | 运行时检查 + 错误码 |
| 硬件故障检测 | 运行时检查 + 恢复机制 |

- 断言抓「内部契约被破坏」（如 `self != NULL`），**不**抓运行时错误。失败 = 程序员 bug。
- 外部输入必须运行时校验 + 优雅失败（返回错误码），**不**用断言。
- 防御编码 6 条：解引用前校验所有指针；校验数组下标；校验枚举范围；检查每个返回值；所有变量初始化；switch 即使枚举穷尽也写 `default`。

---

## const / static（硬规，非建议）

- **`const` 尽量多用**：防止意外修改 + 表达意图。最常见的是「指向 const 数据的指针」。
  - **不要** const 值参数（`const uint16_t len`）——C 里值是副本，毫无意义。
- **`static` 强制**：所有非公共 API 的函数和变量必须 `static`（信息隐藏，缩窄链接域）。
- 头文件只暴露公共契约；内部细节留在 `.c`。

---

## DRY 与表驱动

- **DRY**：发现复制粘贴带微小差异、多处相似 switch/if-else、重复校验模式 → 提取共享函数；变化部分用函数指针（策略）。优先 `static inline` 而非宏。
- **表驱动**：用查找表替代冗长 switch/if-else。适用：错误码→字符串、命令分发表（ID→函数指针）、状态机转移表、配置参数范围校验、协议字段解析。

---

## BARR-C 安全编码四条

1. **大括号**：`if`/`for`/`while`/`do-while` 即使单行也必须加大括号。禁止 `if (err) return;`。
2. **固定宽度整数**：禁用裸 `int`/`short`/`long`/`unsigned`；必须用 `stdint.h`（`int32_t`、`uint8_t`）。
3. **位操作安全**：只对无符号操作；移位计数 < 操作数位宽；有符号左移是 UB。
4. **返回值检查**：非 `void` 返回值必须检查，或显式标注忽略。

---

## MISRA-C / CERT-C 对齐

> 本项目「安全关键」纪律以 **BARR-C**（见上）为骨架，并向 **MISRA-C:2012** 与 **CERT C** 看齐。
> 不追求逐条合规，而是遵循其**高价值子集**；偏离可接受，**未记录的偏离不可接受**。

| 来源 | 高价值规则（本项目强制） |
|------|------------------------|
| MISRA-C:2012 | Dir 4.1（运行时故障最小化）、Rule 8.x（声明/定义一致）、Rule 17.x（指针）、Rule 18.x（整数与位操作用无符号）、Rule 21.x（标准库 `strcpy/sprintf/atoi` 等禁用——见 [memory-safety.md](./memory-safety.md)） |
| CERT C | MEM（内存）、INT（整数溢出/移位）、STR（字符串）、CON（并发，见 [concurrency.md](./concurrency.md)）、EXP（求值序） |

要点：这三套在「禁裸 int / 禁 `strcpy` / 检查返回值 / 位操作无符号 / 指针校验」上**高度一致**——
本项目硬规则已覆盖大多数。工具侧用 clang-tidy 的 `cert-*` / `misra-*` 检查子集自动卡
（见 [tooling.md](./tooling.md)）。任何偏离必须注释写明：规则号、理由、风险、缓解。

---

## 注释

- 解释「为什么」，不是「做了什么」（代码自己能说明做什么）。
- 与代码同步，过时即删。
- 删掉注释掉的代码。
- 不写冗余注释（`i++; /* i 加 1 */`）。

---
> **源出（溯源）**：zhaoming `ai-coding-skill/references/code-style.md` + `clean-code.md`。
> 本文为范式无关提炼，命名约定已改写为本项目（snake_case）标准。
