# 错误码约定（范式无关）

> 适用范围：两种架构风格共用。核心决策见 **ADR-0001**。

---

## 核心规则

**所有可能失败的函数返回状态码：`0 = 成功，负数 = 错误`**（对齐 Linux/POSIX）。

```c
/* wink-micro-os */
wink_status_t dal_servo_set_angle(dal_servo_t *dev, float angle);

/* chigo-micro（同为 0/负数约定，类型为 int） */
int motor_driver_init(motor_driver_t *drv);
```

---

## ⚠ 头号脚雷：禁用 `if (status)`

负数在 C 里是 **truthy**。`if (status)` 会把一个负数错误码当成「真」——即当成「有情况」，
而在「0 = 成功」约定下，成功反而是假。这是 AI 代码生成最易踩的雷。

```c
wink_status_t status = dal_ultrasonic_read(&radar, &dist);

/* ❌ 错误：负数错误码是 truthy，会把失败当成功 */
if (status) { /* ... 误以为成功了 ... */ }

/* ✓ 正确 */
if (status < 0)         { /* 失败处理 */ }
if (status != WINK_OK)  { /* 失败处理 */ }   /* WINK_OK == 0 */
```

---

## 两项目的错误码布局对照

| 项目 | 返回类型 | 布局 |
|------|----------|------|
| **wink-micro-os** | `wink_status_t` | 分段：`0 = WINK_OK`；`-1..-11` 常见可恢复；`-20..-29` 功能安全可恢复（如 `WINK_ERR_OVERCURRENT`）；`-30..-49` 致命（如 `WINK_ERR_WATCHDOG`）；`-50..-59` **可恢复降级**（ADR-0005，如 `WINK_ERR_CONFIG_CORRUPT_DEGRADED(-50)`、`WINK_ERR_FAILED_INIT(-51)`——系统继续运行）；`-99 = WINK_ERR_PANIC` |
| **chigo-micro** | `int` + 位域 | `0` 成功 / 负数错误（非结构化 int）；安全状态另用 `ERR_BIT_*` 位域（OVERCURRENT/OVERHEAT/STALL/COLLISION/COMM_TIMEOUT/CRC_ERROR 等，见 `message_parser.h`） |

> 写 wink-micro-os 代码用 `wink_status_t` + 分段码；写 chigo-micro 代码用 `int` + `ERR_BIT_*`。
> 两者共享「0=成功 / 负数=错误 / 禁 `if(status)`」这条铁律。
>
> **无正数 warning 段**（ADR-0005）：「降级但继续运行」也归负数（`-50s`），故 `if(status<0)` 对降级状态依然正确捕获——BAL 用 `status == WINK_ERR_CONFIG_CORRUPT_DEGRADED` / `== WINK_ERR_FAILED_INIT` 特判走保守降级，其余 `<0` 走常规错误恢复。统一 `ERR_*` 前缀，**禁用 `WARN_*` 前缀**。

---

## 错误传播

- **每层要么处理，要么向上传播，绝不静默吞掉**。
- 必须检查每一个返回值（BARR-C 第 4 条）；忽略必须有明确标注。
- 初始化链失败时，按相反顺序 deinit 已成功初始化的资源（资源生命周期对称）。

```c
int init_system(void)
{
    int rc = a_init();
    if (rc < 0) return rc;
    rc = b_init();
    if (rc < 0) { a_deinit(); return rc; }   /* 回滚 a */
    rc = c_init();
    if (rc < 0) { b_deinit(); a_deinit(); return rc; }
    return 0;
}
```

> 详细的「断言 vs 运行时检查」区分见 [clean-code.md](./clean-code.md)。

---
> **源出（溯源）**：ADR-0001（`docs/design/decisions/0001-error-code-sign-convention.md`）、
> zhaoming `clean-code.md` 错误处理策略、chigo-micro `.claude/rules/c-embedded.md`。
