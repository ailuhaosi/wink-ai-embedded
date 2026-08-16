# 硬件拓扑与基础设施外设架构设计 — 技术设计

| 项 | 内容 |
|---|---|
| **创建日期** | 2026-08-03 |
| **文档状态** | **Draft / 待实施** |
| **文档层级** | 架构设计（`docs/tech-designs/`） |
| **关联 ADR** | [ADR-0046](../../decisions/core/0046-dal-driver-registry-ssot.md)（Accepted）；[ADR-0051](../../decisions/tools/0051-scannable-codegen-extension-roots.md)；[ADR-0040](../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md) |
| **关联规范** | [`wink-app-json-guide.md`](../../../wink-micro-os/docs/wink-app-json-guide.md)；[`08-channel-routing.md`](../../design/04-wasm-simulation/02-mechanisms/08-channel-routing.md)；[`07-peripheral-registry.md`](../../design/04-wasm-simulation/02-mechanisms/07-peripheral-registry.md) |
| **影响范围** | `wink-tools/tools/codegen/`（Codegen 引擎）、`wink-micro-os/pal/`（PAL 抽象服务）、`wink-micro-os/codegen/drivers/`（驱动描述）、`UniSim 3.0`（Wasm 仿真插件） |

---

## 1. 背景与核心概念界定

### 1.1 问题现状

在 Wink 系统当前的体系中，`wink-app.json` 主要描述 **直连 MCU 的业务外设**（如按键、LED、电机、OLED 屏、温湿度传感器等）。但在实际硬件电路板开发中，大量存在 **非业务功能/基础设施芯片（Infrastructure / Topology Chips）**。这些芯片包括：
- **IO 扩展芯片**（如 PCF8574, AW9523, 74HC595）；
- **信号选通/译码芯片**（如 74HC138 3-8 译码器, CD4051 模拟开关）；
- **总线多路复用开关**（如 TCA9548A 8 通道 I2C 开关）；
- **外置模拟与 PWM 资源扩展芯片**（如 ADS1115 16位 ADC, PCA9685 16路 PWM）；
- **物理层收发器 / 电平转换芯片**（如 MAX485 RS485 收发器, TXS0108E 电平转换器）。

如果缺乏统一的拓扑表达范式，开发者往往会在 DAL 驱动中混入底层选通控制（例如在 `dal_led.c` 里操作译码器地址引脚），这会严重打破 **“只替换物理量来源、DAL 代码 100% 同源”**（[ADR-0040](../../decisions/unisim/0040-arduino-semantic-sim-json-gate.md)）的架构铁律。

### 1.2 分类界定：业务外设 vs 基础设施外设

必须严格区分 **业务功能外设 (Functional Devices)** 与 **基础设施/拓扑外设 (Infrastructure Devices)**：

```text
                               ┌──────────────────────────────────────────────┐
                               │           Wink 芯片/外设分类体系            │
                               └──────────────────────┬───────────────────────┘
                                                      │
                       ┌──────────────────────────────┴──────────────────────────────┐
                       ▼                                                             ▼
         【业务功能外设 (Functional Devices)】                      【基础设施外设 (Infrastructure Devices)】
  - 向 App 暴露业务 Role API (如 set_speed, turn_on)          - 不暴露业务 Role API，纯粹为硬件拓扑/路由服务
  - 覆盖 7 大原生 Category:                                  - 覆盖 5 大拓扑/资源 Provider 范式:
    • input (按键/矩阵键盘)                                    • gpio_expander (IO扩展芯片, 如 PCF8574)
    • output (LED/蜂鸣器/继电器)                               • signal_mux (选通/译码器, 如 74HC138)
    • sensor (超声波/AHT20/MPU6050)                            • bus_mux (总线开关, 如 TCA9548A)
    • actuator (直流电机/舵机)                                 • resource_provider (外置 ADC/PWM, 如 PCA9685)
    • display (OLED/LCD)                                       • phy_transceiver (收发器/电平转换, 如 MAX485)
    • comm (串口/GPS)
    • storage (EEPROM/Flash/SD卡)
```

> ⚠️ **分类边界澄清**：
> `EEPROM`（如 AT24C02）、`NOR Flash`（如 W25Q64）直接提供数据读写接口（`dal_eeprom_read/write`），属于标准的 **`storage`（存储类）** 业务外设，**不属于** 基础设施外设。

---

## 2. `wink-app.json` 5 大 Schema 建模范式

为同时兼顾 **`*_pin` 格式识别契约** 和 **强类型依赖解算**，系统定义以下 5 种 Schema 建模范式：

### 2.1 范式一：Virtual Pin 模式（适合并发 GPIO 扩展芯片）

适用于扩展出独立逻辑 GPIO 引脚的芯片（PCF8574, AW9523, 74HC595, 74HC165）。

* **Schema 契约**：终端外设保留 `*_pin` 结尾的字段，其值为字符串 `"provider_id:pin_name"`。

```json
{
  "app_name": "gpio_expander_demo",
  "board": "esp32_devkitc",
  "devices": {
    "io_expander": {
      "type": "pcf8574",
      "category": "infrastructure",
      "i2c_bus": 0,
      "i2c_addr": 32
    },
    "status_led": {
      "type": "led",
      "gpio_pin": "io_expander:P0",
      "active_high": true
    },
    "user_button": {
      "type": "button",
      "gpio_pin": "io_expander:P1",
      "active_low": true
    }
  }
}
```

### 2.2 范式二：Parent-Channel 选通模式（适合 3-8 译码器 / 模拟开关）

适用于通过地址线/使能线复用选通特定通道的芯片（74HC138, 74HC154, CD4051）。

* **Schema 契约**：终端外设使用 `"parent"` 指向选通器件 ID，并使用 `"channel"` 指定通道索引（整数）。

```json
{
  "app_name": "decoder_demo",
  "board": "esp32_devkitc",
  "devices": {
    "sel_decoder": {
      "type": "decoder_3to8",
      "category": "infrastructure",
      "a0_pin": 14,
      "a1_pin": 15,
      "a2_pin": 16,
      "enable_pin": 17
    },
    "channel_led_3": {
      "type": "led",
      "parent": "sel_decoder",
      "channel": 3,
      "active_high": true
    }
  }
}
```

### 2.3 范式三：Virtual Bus 模式（适合 I2C/SPI 总线开关）

适用于解决同地址从机设备冲突或片选路数的拓扑开关（TCA9548A, PCA9544）。

* **Schema 契约**：终端外设的 `"i2c_bus"` 或 `"spi_bus"` 指定为 `"bus_switch_id:channel_name"`。

```json
{
  "app_name": "multi_imu_demo",
  "board": "esp32_devkitc",
  "devices": {
    "i2c_switch": {
      "type": "tca9548a",
      "category": "infrastructure",
      "i2c_bus": 0,
      "i2c_addr": 112
    },
    "imu_front": {
      "type": "mpu6050",
      "i2c_bus": "i2c_switch:ch0",
      "i2c_addr": 104
    },
    "imu_back": {
      "type": "mpu6050",
      "i2c_bus": "i2c_switch:ch1",
      "i2c_addr": 104
    }
  }
}
```

### 2.4 范式四：Virtual Resource Provider 模式（适合外置 ADC/PWM）

适用于扩展 PWM 通道（PCA9685）或高精度 ADC 通道（ADS1115）。

* **Schema 契约**：终端外设的 `"pwm_channel"` 或 `"adc_channel"` 赋值为 `"provider_id:channel_name"`。

```json
{
  "app_name": "pca9685_servo_demo",
  "board": "esp32_devkitc",
  "devices": {
    "pca9685_pwm": {
      "type": "pca9685",
      "category": "infrastructure",
      "i2c_bus": 0,
      "i2c_addr": 64
    },
    "arm_servo_1": {
      "type": "rc_servo",
      "pwm_channel": "pca9685_pwm:ch0"
    }
  }
}
```

### 2.5 范式五：PHY 属性注入模式（适合 RS485 / 电平收发器）

对于物理层收发器（如 MAX485），不独立建立设备节点，而是将其方向引脚（DIR/RE/DE）作为通信外设的物理层扩展属性。

```json
{
  "app_name": "modbus_demo",
  "board": "esp32_devkitc",
  "devices": {
    "modbus_sensor": {
      "type": "modbus_rtu",
      "uart_port": 1,
      "phy": "rs485",
      "dir_pin": 4
    }
  }
}
```

---

## 3. 嵌入式 C 固件侧架构与 Codegen 设计

### 3.1 Codegen 依赖拓扑排序 (Dependency DAG Sort)

为了保证 C 语言生成的初始化序列合法（基础设施器件必须在业务外设之前初始化完成），`app_codegen.py` 将构建 **有向无环图 (DAG)** 并进行拓扑排序：

```text
               拓扑解算与构建流程 (Codegen Pipeline)
               
  wink-app.json
       │
       ▼
 1. 扫描 devices 提取节点关系 (Extract Nodes & Edges)
    - Node: io_expander (In-degree = 0)
    - Node: sel_decoder (In-degree = 0)
    - Edge: status_led  -> io_expander (Depends on io_expander)
    - Edge: ch_led_3    -> sel_decoder (Depends on sel_decoder)
       │
       ▼
 2. 拓扑排序 (Topological Sort)
    Init Order: [io_expander, sel_decoder] ──> [status_led, ch_led_3]
       │
       ▼
 3. 生成 c_init 模板序列 (Render app_device_tree_init())
```

### 3.2 Codegen 描述文件 YAML 样例（遵循 Schema 1.1）

在 `wink-micro-os/codegen/drivers/` 目录下新增基础设施芯片描述：

#### `pcf8574.yaml` (GPIO 扩展器)
```yaml
codegen_schema: "1.1"
type: pcf8574
category: infrastructure
is_actuator: false
experimental: false

fields:
  i2c_bus:
    tier: advanced
    type: int
    required: true
    c: i2c_port
  i2c_addr:
    tier: advanced
    type: int
    default: 32
    hex: true
```

#### `decoder_3to8.yaml` (3-8 译码器)
```yaml
codegen_schema: "1.1"
type: decoder_3to8
category: infrastructure
is_actuator: false
experimental: false

fields:
  a0_pin:
    tier: advanced
    type: int
    required: true
  a1_pin:
    tier: advanced
    type: int
    required: true
  a2_pin:
    tier: advanced
    type: int
    required: true
  enable_pin:
    tier: advanced
    type: int
    default: -1
```

### 3.3 PAL 抽象服务层解算 (PAL Virtual Pin & Bus Resolver)

为保证 DAL 层代码（如 `dal_led.c`）零侵入、零修改，所有拓扑解算下沉到 PAL / HAL 层。

#### 1. PAL GPIO 句柄多态定义 (`wink-micro-os/pal/include/pal_gpio.h`)
```c
typedef enum {
    PAL_GPIO_KIND_NATIVE = 0,
    PAL_GPIO_KIND_VIRTUAL_PROVIDER,
    PAL_GPIO_KIND_MUX_CHANNEL
} pal_gpio_kind_t;

typedef struct {
    pal_gpio_kind_t kind;
    union {
        struct {
            uint8_t pin_num;
        } native;
        struct {
            void *provider_dev; // 指向 PCF8574 DAL/PAL 句柄
            uint8_t virtual_pin;
        } virtual_provider;
        struct {
            void *parent_mux;    // 指向 74HC138 DAL/PAL 句柄
            uint8_t channel;
        } mux_channel;
    } target;
} pal_gpio_handle_t;
```

#### 2. PAL GPIO 读写统一入口 (`wink-micro-os/pal/src/pal_gpio.c`)
```c
wink_status_t pal_gpio_write(pal_gpio_handle_t handle, bool level) {
    switch (handle.kind) {
        case PAL_GPIO_KIND_NATIVE:
            return hal_gpio_write_native(handle.target.native.pin_num, level);
            
        case PAL_GPIO_KIND_VIRTUAL_PROVIDER:
            // 调用 GPIO 扩展芯片的写接口
            return dal_pcf8574_write_pin(
                handle.target.virtual_provider.provider_dev,
                handle.target.virtual_provider.virtual_pin,
                level
            );
            
        case PAL_GPIO_KIND_MUX_CHANNEL:
            // 先选通 3-8 译码器通道，再切换使能
            dal_decoder_3to8_select_channel(
                handle.target.mux_channel.parent_mux,
                handle.target.mux_channel.channel
            );
            return WINK_OK;
            
        default:
            return WINK_ERR_INVALID_ARG;
    }
}
```

---

## 4. UniSim 3.0 WASM 仿真同源对接

遵循 [`08-channel-routing.md`](../../design/04-wasm-simulation/02-mechanisms/08-channel-routing.md) 提出的 4 通道（Pin, Bus, PWM, Analog, Buffer）旁路铁律：

```text
 ┌─────────────────────────────────────────────────────────────┐
 │                      Wasm 固件运行环境                      │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                 Wasm-JS Bridge (10-wasm-js-bridge-abi)
                                │
        ┌───────────────────────┴───────────────────────┐
        ▼                                               ▼
  【通道 1：PinArbiter】                          【通道 2：BusRouter】
  - 拦截 74HC138 地址脚翻转                      - 拦截 TCA9548A I2C 写操作
  - 触发 DecoderPlugin 逻辑分发                   - 切换 I2CBus 下属虚拟从机
        │                                               │
        └───────────────────────┬───────────────────────┘
                                ▼
                   UniSim Workbench 物理世界 3D / UI 视图
```

1. **通道 1 (Pin-Level)**：
   - 当 Wasm 固件调用 `pal_gpio_write` 翻转 A0/A1/A2 地址脚时，写操作通过 Bridge 进入 `PinArbiter`。
   - `PinArbiter` 唤醒 `DecoderPlugin`，计算出 `channel = (A2<<2)|(A1<<1)|A0`，将选通高电平路由给对应绑定的虚拟 LED/传感器。
2. **通道 2 (Bus Protocol)**：
   - `TCA9548APlugin` 在 JS 侧拦截对 I2CSwitch 地址的 `pal_i2c_transfer` 事务。
   - 当收到选通通道字节后，动态将后续发往该总线的包转发到指定的子从机队列（Sub-Slave Queue）。

---

## 5. 分阶段实施路线图 (Implementation Roadmap)

### Phase 1: Codegen 依赖排序与字符串 Pin 解析器 (已计划)

- **目标**：修改 `wink-tools/tools/codegen/app_codegen.py`。
- **任务**：
  1. 支持提取 `"provider:channel"` 格式与 `"parent"` 属性。
  2. 实现 DAG 拓扑排序算法，避免产生初始化循环依赖 (Circular Dependency)。
  3. 新增 Lint 检查规则 `check_infrastructure_dangling_references`（检查引脚是否引用了不存在的 provider）。

### Phase 2: 基础芯片 YAML 与 PAL Multi-Kind 接口落地

- **目标**：在 `wink-micro-os` 落地核心基础设施芯片与 PAL 适配。
- **任务**：
  1. 新增 `codegen/drivers/pcf8574.yaml`、`decoder_3to8.yaml` 和 `tca9548a.yaml`。
  2. 重构 `pal_gpio.h`，引入 `pal_gpio_handle_t` 多态联合体。
  3. 在 `wink-micro-app` 下新增冒烟工程 `infrastructure_smoke` 进行 Host 单元测试验证。

### Phase 3: UniSim 3.0 仿真侧插件与通道路由通导

- **目标**：在 UniSim WASM 仿真侧完成 JS 插件映射。
- **任务**：
  1. 在 `packages/unisim` 编写 `DecoderPlugin` 与 `I2CSwitchPlugin`。
  2. 验证 WASM 固件与 JS 仿真端在 `infrastructure_smoke` 工程下的状态同步。

---

## 6. 验收与门禁清单 (Verification Checklist)

实施完成后，须运行以下校验命令确保零中断：

```bash
# 1. 静态规则检查
python wink-tools/wink.py lint --pack drivers --pack layering --pack api

# 2. 检查扩展根驱动加载
python wink-tools/tools/codegen/list_drivers.py --check

# 3. 构建包含基础设施拓扑的 App (Host 平台)
python wink-tools/wink.py build host --app infrastructure_smoke

# 4. 构建 ESP32-S3 物理目标板
python wink-tools/wink.py build esp32 --app infrastructure_smoke
```

