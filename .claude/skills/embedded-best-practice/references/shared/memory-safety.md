# 内存安全（范式无关）

> 适用范围：两种架构风格共用。

---

## 实时路径禁止 malloc / free（两项目共识）

- **PID 回调、中断、1kHz 快路径、Wasm 仿真热路径**——一律禁用 `malloc/free`。
- 所有结构体**静态分配**，或通过 FreeRTOS 队列 / 事件传递。
- chigo-micro：`c-embedded.md` 明文「实时路径禁止 malloc/free」。
- wink-micro-os：器件实例是 codegen 生成的静态全局（`device_tree.c`），无动态分配。

---

## 堆分配规则（仅在非实时路径允许时）

1. **每次分配都检查 NULL**。
2. **每次分配都配对释放**，并文档化所有权（谁负责释放）。
3. **按相反顺序释放**（A→B→C 分配，则 free C→B→A）。
4. **释放后置空指针**（防 use-after-free / double-free）。
5. **错误路径必须清理**已分配资源——用 `goto` 标签集中清理：

```c
int module_init(module_t *self)
{
    self->buf_a = platform_malloc(BUF_A_SIZE);
    if (self->buf_a == NULL) { return ERR_NO_MEMORY; }
    self->buf_b = platform_malloc(BUF_B_SIZE);
    if (self->buf_b == NULL) { goto fail_b; }
    self->queue = queue_create(DEPTH);
    if (self->queue == NULL) { goto fail_queue; }
    return 0;
fail_queue:
    platform_free(self->buf_b); self->buf_b = NULL;
fail_b:
    platform_free(self->buf_a); self->buf_a = NULL;
    return ERR_NO_MEMORY;
}
```

> ⚠ 嵌入式平台用**非标准 allocator**：`platform_malloc` / `pvPortMalloc` / `os_malloc` /
> `mem_alloc`。**绝不混用不同 allocator 家族**——先搜项目里现有用法再跟随。

---

## 明令禁止的 API（及替代）

| 禁止 | 原因 | 替代 |
|------|------|------|
| **VLA**（变长数组 `int a[n]`） | 栈大小不可控，易爆栈 | 固定大小数组 + 长度参数 |
| **`strcpy`** | 无界写入 | `snprintf(dst, sizeof dst, "%s", src)`（首选）或 `memcpy` + 手动 `dst[n-1]='\0'`；**勿用 `strncpy`**（`strlen(src)≥n` 时不补 `\0`，且 null 填满低效） |
| **`sprintf`** | 无界写入 | `snprintf` |
| **`gets`** | 无界写入 | `fgets` |
| **`alloca`** | 栈分配，不可控 | 静态缓冲或堆 |

- 缓冲区**必须连同长度一起传**；拷贝前校验输入长度 ≤ 目标容量。
- 缓冲区大小定义为宏，禁止魔法数字。

---

## 缓冲区溢出防护

- `memcpy`/`memmove` 的 size 必须 ≤ 目标缓冲区容量。
- chigo-micro：数组拷贝用 `memcpy(dst, src, sizeof(dst))`，而非逐元素。
- 协议帧解析：先校验长度字段再解析（见 chigo-micro CMD/STATE/PARAM 帧 + CRC16）。

---

## 栈溢出防护

- **禁止递归**（或严格有界 + 可证明安全）。
- 评估大型局部变量；栈紧张时改堆。
- 合理的调用链深度。
- FreeRTOS 任务栈按「最深调用链 + 余量」配置；用 `uxTaskGetStackHighWaterMark` 监控。

> 缓冲区 / 栈的运行时校验也出现在 [safety-checklist.md](./safety-checklist.md) 阶段 3、6。

---
> **源出（溯源）**：zhaoming `memory-safety.md`、chigo-micro `.claude/rules/c-embedded.md`。
