# 静态分发范式下的设计模式

> **适用范围**：本项目静态分发范式（wink-micro-os）。
> 所有模式均遵循：POD + 命名 API + 无运行期器件虚表。

---

## 核心原则

本项目的设计模式必须遵守以下约束：

1. ❌ **禁止在 DAL 器件结构体中放 ops 虚表**（违反 ADR-0004）
2. ❌ **禁止使用 container_of 进行向下转型**（器件抽象层）
3. ✅ 纯软件业务逻辑层（BAL）可有限使用函数指针
4. ✅ 策略模式（形态4）仅限算法切换，不可用于器件抽象
5. ✅ 静态绑定优先于运行期绑定

---

## 模式一：状态机（State Machine）

**嵌入式最重要的模式，没有之一**。BAL 业务逻辑 90% 是状态机。

### 适用场景

- 设备工作流程控制（如机械臂运动序列、传感器校准流程）
- 协议通信状态管理
- 有限状态的行为建模

### 静态分发实现方式（推荐）

```c
/* 状态枚举 */
typedef enum {
    DEV_STATE_IDLE,
    DEV_STATE_CONNECTING,
    DEV_STATE_ACTIVE,
    DEV_STATE_ERROR,
    DEV_STATE_COUNT
} dev_state_t;

/* 事件枚举 */
typedef enum {
    EVT_START,
    EVT_CONNECTED,
    EVT_DATA,
    EVT_FAULT,
    EVT_RESET,
    EVT_COUNT
} dev_evt_t;

/* POD 状态机实例 */
typedef struct {
    dev_state_t  current_state;
    uint32_t     retry_count;
    uint32_t     last_error;
    /* ... 其他状态变量 ... */
} dev_sm_t;

/* 命名式状态处理函数 */
static dev_state_t state_idle_handler(dev_sm_t *self, dev_evt_t evt);
static dev_state_t state_connecting_handler(dev_sm_t *self, dev_evt_t evt);
static dev_state_t state_active_handler(dev_sm_t *self, dev_evt_t evt);
static dev_state_t state_error_handler(dev_sm_t *self, dev_evt_t evt);

/* 静态状态处理表（编译期绑定） */
typedef dev_state_t (*state_handler_fn)(dev_sm_t *self, dev_evt_t evt);

static const state_handler_fn s_state_table[DEV_STATE_COUNT] = {
    [DEV_STATE_IDLE]       = state_idle_handler,
    [DEV_STATE_CONNECTING] = state_connecting_handler,
    [DEV_STATE_ACTIVE]     = state_active_handler,
    [DEV_STATE_ERROR]      = state_error_handler,
};

/* 命名式事件分发 API */
void dev_sm_handle_event(dev_sm_t *self, dev_evt_t evt)
{
    ASSERT(self != NULL);
    ASSERT(self->current_state < DEV_STATE_COUNT);

    dev_state_t next = s_state_table[self->current_state](self, evt);

    if (next != self->current_state) {
        /* 状态退出动作 */
        self->current_state = next;
        /* 状态进入动作 */
    }
}
```

### 为什么这样做

- 符合静态分发：状态处理函数在编译期确定，绑定到数组
- POD 结构：`dev_sm_t` 是纯数据，无函数指针成员
- 零运行期开销：数组索引直接跳转
- 类型安全：编译期检查数组越界

---

## 模式二：表驱动分发（Table-Driven Dispatch）

### 适用场景

- 命令/协议分发（如串口命令解析、网络帧处理）
- 错误码到字符串映射
- 配置参数范围校验
- 任何需要替代冗长 `switch` 的场景

### 实现方式

```c
/* 命令处理函数签名 */
typedef wink_status_t (*cmd_handler_fn)(const uint8_t *payload,
                                        uint16_t len);

/* 命令表项 */
typedef struct {
    uint8_t          cmd_id;
    cmd_handler_fn   handler;
    const char      *name;
} cmd_entry_t;

/* 静态命令表（编译期绑定，OCP 友好） */
static const cmd_entry_t s_cmd_table[] = {
    { CMD_READ_STATUS,  handle_read_status,  "read_status"  },
    { CMD_SET_CONFIG,   handle_set_config,   "set_config"   },
    { CMD_FIRMWARE_VER, handle_fw_version,   "fw_version"   },
    /* 新增命令只需加一行，不修改现有代码 */
};

#define CMD_TABLE_COUNT  (sizeof(s_cmd_table) / sizeof(s_cmd_table[0]))

/* 命名式分发 API */
wink_status_t cmd_dispatch(uint8_t cmd_id, const uint8_t *payload,
                           uint16_t len)
{
    for (uint32_t i = 0; i < CMD_TABLE_COUNT; i++) {
        if (s_cmd_table[i].cmd_id == cmd_id) {
            return s_cmd_table[i].handler(payload, len);
        }
    }
    return WINK_ERR_UNKNOWN_CMD;
}
```

### 优点

- 符合开闭原则（OCP）：新增命令不修改现有分发代码
- 可读性好：命令表一目了然
- 易扩展：支持附加元数据（名称、权限、超时等）
- 编译期常量：存储在 Flash，不占 RAM

---

## 模式三：策略模式（Strategy）

> ⚠️ **仅限算法切换场景，绝对不能用于器件抽象**
> 这是 ADR-0004 允许的「形态4 受控 vtable 例外」。

### 适用场景

- PID / 级联 PID / 前馈控制等不同控制算法切换
- CRC32 / XOR / 校验和等不同校验算法
- 滤波算法（均值滤波 / 中值滤波 / 卡尔曼滤波）

### 实现方式

```c
/* 策略接口（纯算法，不含器件抽象） */
typedef struct {
    float (*calc)(float input, float setpoint);
    void  (*reset)(void);
} control_algo_t;

/* 策略实现（命名式 API） */
float pid_algo_calc(float input, float setpoint);
void  pid_algo_reset(void);

float cascade_pid_algo_calc(float input, float setpoint);
void  cascade_pid_algo_reset(void);

/* 静态策略实例（编译期常量） */
static const control_algo_t s_pid_algo = {
    .calc  = pid_algo_calc,
    .reset = pid_algo_reset,
};

static const control_algo_t s_cascade_pid_algo = {
    .calc  = cascade_pid_algo_calc,
    .reset = cascade_pid_algo_reset,
};

/* POD 上下文（不含虚表指针） */
typedef struct {
    const control_algo_t  *algo;  /* 指向静态 const 策略 */
    float                  kp;
    float                  ki;
    float                  kd;
    /* ... 其他状态 ... */
} controller_t;

/* 命名式 API */
wink_status_t controller_init(controller_t *self,
                               const control_algo_t *algo)
{
    ASSERT(self != NULL);
    ASSERT(algo != NULL);

    self->algo = algo;
    self->algo->reset();
    return WINK_OK;
}

float controller_update(controller_t *self, float input, float setpoint)
{
    ASSERT(self != NULL);
    ASSERT(self->algo != NULL);

    return self->algo->calc(input, setpoint);
}
```

### 关键约束

1. ✅ 策略表是 `static const`，存储在 Flash，不占 RAM
2. ✅ POD 结构 `controller_t` 只保存指针，不嵌入 ops
3. ✅ 仅用于**纯算法**，不涉及硬件抽象
4. ❌ 禁止用于 DAL 器件抽象（如 `sensor_ops_t`）

---

## 模式四：观察者（发布-订阅）

### 适用场景

- 事件通知（如传感器数据就绪、按键按下、状态变化）
- 解耦事件生产者和消费者
- 一对多的通知场景

### 静态分发实现方式（编译期注册）

```c
/* 回调函数签名 */
typedef void (*observer_cb_t)(void *ctx, uint32_t event_id,
                               const void *data);

/* 观察者表项 */
typedef struct {
    observer_cb_t  cb;
    void          *ctx;
} observer_t;

/* 静态观察者表（编译期分配，无 malloc） */
#define MAX_OBSERVERS  (8U)

typedef struct {
    observer_t  observers[MAX_OBSERVERS];
    uint8_t     count;
} subject_t;

/* 命名式 API */
void subject_init(subject_t *self)
{
    ASSERT(self != NULL);
    self->count = 0;
}

wink_status_t subject_subscribe(subject_t *self, observer_cb_t cb,
                                void *ctx)
{
    ASSERT(self != NULL);
    ASSERT(cb != NULL);

    if (self->count >= MAX_OBSERVERS) {
        return WINK_ERR_BUFFER_FULL;
    }

    self->observers[self->count].cb  = cb;
    self->observers[self->count].ctx = ctx;
    self->count++;
    return WINK_OK;
}

void subject_notify(const subject_t *self, uint32_t event_id,
                    const void *data)
{
    ASSERT(self != NULL);

    for (uint8_t i = 0; i < self->count; i++) {
        if (self->observers[i].cb != NULL) {
            self->observers[i].cb(self->observers[i].ctx,
                                  event_id, data);
        }
    }
}
```

### 线程安全注意事项

1. `subscribe` / `unsubscribe` 必须加互斥锁保护观察者列表
2. `notify` 遍历过程中如果观察者列表可能被修改，也需要加锁
3. 回调函数内部**不要**调用 `subscribe` / `unsubscribe`，否则会死锁
4. 如果在 ISR 中触发 `notify`，不能使用互斥锁——应改用消息队列将通知投递到任务上下文处理
5. 回调执行时间应尽量短，避免阻塞其他观察者的通知

---

## 模式五：单例（Singleton）

### 适用场景

- 全局配置管理
- 总线仲裁（如 SPI / I2C 总线互斥访问）
- 系统状态监控

### 实现方式

```c
/* 在 system_config.c 中 */
static system_config_t s_instance;
static bool s_initialized = false;

wink_status_t system_config_init(const config_params_t *params)
{
    if (s_initialized) {
        return WINK_ERR_ALREADY_INIT;
    }

    /* 初始化 s_instance ... */
    s_initialized = true;
    return WINK_OK;
}

system_config_t *system_config_get_instance(void)
{
    ASSERT(s_initialized);
    return &s_instance;
}
```

### 多线程注意事项

- 避免延迟初始化（懒加载），在启动阶段完成初始化
- 如果确实需要延迟初始化，必须加锁保护

---

## 模式六：适配器（Adapter）

### 适用场景

- 集成第三方库或遗留代码
- 包装不兼容的接口
- 统一不同硬件的软件接口（但不用于器件抽象）

### 实现方式

```c
/* 旧传感器 API（假设来自第三方库） */
uint16_t legacy_sensor_read_adc(void);

/* 新系统需要的接口 */
static wink_status_t adapted_read(void *self, float *value)
{
    (void)self;  /* 未使用 */
    uint16_t raw = legacy_sensor_read_adc();
    *value = (float)raw * SCALE_FACTOR / DIVISOR;
    return WINK_OK;
}

/* 静态适配表（编译期绑定） */
typedef wink_status_t (*sensor_read_fn)(void *self, float *value);

static const sensor_read_fn s_legacy_adapter = adapted_read;
```

---

## 反模式黑名单

以下是在静态分发范式下应绝对避免的反模式：

| 反模式 | 危害 | 正确做法 |
|--------|------|----------|
| **上帝模块** | 一个 .c 文件做所有事，跨层访问 | 应用 SRP，按职责拆分模块 |
| **意大利面条式依赖** | 每个模块都引用其他所有模块 | 应用 DIP，通过抽象解耦 |
| **基本类型偏执** | 传递 10 个原始整数而非结构体 | 将相关数据组合为有意义的类型 |
| **复制粘贴复用** | 复制代码而非提取共享函数 | 应用 DRY，提取公共函数 |
| **魔法 Switch** | 无限增长的巨型 switch 语句 | 应用 OCP，使用表驱动分发 |
| **器件 ops 虚表** | 在 DAL 结构体中放函数指针表 | 使用命名 API + 编译期绑定 |
| **container_of 向下转型** | 通过基类指针强转派生类指针 | 静态分发不需要转型，类型在编译期已知 |

---

## 模式选择指南

| 场景 | 推荐模式 |
|------|---------|
| 行为随模式/阶段变化 | 状态机 |
| 多个模块需要事件通知 | 观察者 |
| 算法因配置而异（纯软件） | 策略模式（仅限形态4） |
| 全局共享资源，仅一个实例 | 单例 |
| 包装不兼容的第三方接口 | 适配器 |
| 扩展行为而不修改代码 | OCP + 表驱动分发 |
| 命令/协议帧解析 | 表驱动分发 |

---

> **源出（溯源）**：基于 zhaoming `design-patterns.md` 进行范式转换，
> 适配本项目静态分发约束，移除运行期多态相关内容（多层继承、
> container_of、器件 ops 虚表）。
