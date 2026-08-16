# ADR-0040：Arduino 语义仿真 JSON 门禁决策

| 项 | 内容 |
|---|---|
| 状态 | **Accepted（已接受）** |
| 日期 | 2026-07-19 |
| 影响范围 | `wink-micro-os/frameworks/arduino/`、Codegen 工具链、Wasm 仿真层及 CI 脚本 |
| 关联 ADR | [ADR-0003 仿真可信度边界](./0003-simulation-fidelity-boundary.md)、[ADR-0035 Arduino沙箱](../core/0035-arduino-compat-polymorphism-sandbox.md)、[ADR-0036 C++裁剪](../core/0036-cpp-subset-compilation-policy.md) |

---

## 背景（Context）

在引入 Arduino 兼容层后，WinkMicroOS 的用户 Sketch 代码（`.ino`）需要在浏览器仿真环境（Wasm UniSim）中运行。对于数字引脚电平变化（如 LED Blink），进行引脚级的 GPIO 信号（Pin-level）仿真即可满足。然而，对于超声波测距、舵机角度等具有复杂物理现象的设备，直接仿真微秒级引脚脉宽（如 `pulseIn`）在 Wasm 单线程与浏览器时钟限制下极具挑战，需要使用基于 DAL Bypass 的语义级仿真（Semantic Simulation）。

为了维持系统的整洁、安全与一致性，我们面临以下技术诉求：
1. **单一事实源（SSOT）**：外设的引脚配置、通道划分和设备标识必须仅在一处（即 `wink-app.json`）声明，不能在 Sketch 代码 and JSON 中重复定义。
2. **越权使用与配置错误检测**：如果 Sketch 使用了未声明的外设或错误修改了被 DAL 设备占用的引脚，仿真层不能默默返回合理的“假值”（例如固定的 25cm 或 90° 舵机角度），必须实施 **Fail-Fast** 机制。
3. **零成本抽象隔离**：C++ 编写的 Arduino Façade wrapper 不能向底层泄露任何 vtable 或动态内存，不能让内核适配兼容层。

---

## 决策结论（Decision）

为了解决上述问题，确立 **“JSON 是语义仿真入场券；无 JSON，仅留 Pin-level”** 的底层设计决策：

### 1. 门禁划分与路径分类
* **有 JSON 声明的外设**：支持完整的语义仿真路径（DAL Bypass）。例如 `front_radar.read()` 直接通过 UniSim 映射获取障碍物距离。
* **无 JSON 或未声明的外设**：**不支持语义仿真**。相应的 API 调用必须触发 Fail-Loud 行为，防止因返回伪数据造成开发误导。引脚级（Pin-level）的普通 GPIO 读写（LED 闪烁等）仍无条件支持。

### 2. 隐式 GPIO Claim 与 Late-binding Hijack 检测
* 在 Sketch 的 `pinMode(pin, mode)` 内部，隐式调用 `pal_resource_claim(PAL_RESOURCE_GPIO_PIN, pin, "arduino_compat")`。
* 若返回 `WINK_ERR_BUSY`（说明该引脚已被 `wink-app.json` 声明的某个 DAL 设备，如 `front_radar` 的 echo 引脚所占有），则视作 Sketch “晚绑定越权抢占”，立即输出 WARN 日志；在严格模式（`WINK_SIM_STRICT=1`）下，直接触发 `pal_panic`。
* 只有未被独占的引脚，才被允许作为 `arduino_compat` 独占分配以进行引脚级读写。

### 3. C++ 零成本 wrapper 与符号重定向
* 使用零 heap、零 vtable、完全 inline 的 C++ 包装类（如 `WinkUltrasonic`、`WinkRcServo`）向 Sketch 提供面向对象接口，内部持有一个指向 Codegen 静态分配的 `dal_*_t` 的引用。航模与工业伺服分门面（ADR-0050），禁止泛称 `WinkServo`。
* 为了避免 Sketch 中的包装类对象与 device_tree 中同名的 C global struct 发生符号冲突，Codegen 将使用预处理器宏进行定向重定向，例如：
  ```cpp
  extern WinkUltrasonic arduino_front_radar;
  #define front_radar arduino_front_radar
  ```
  在 Sketch 中写 `front_radar.read()` 会无缝转换为访问包装类对象，而底层静态分配与连接维持纯 C 不变。

### 4. Raw `pulseIn` 仿真 Stub 化
* 在 `SIMULATION` 构建宏下，如果对普通未声明引脚调用了 raw `pulseIn()`，由于其存在严重的 CPU 挂起风险且无真实回波仿真，一律立即超时返回 `0` 并且发出 `pal_log_warn` 警告；在严格模式下直接 panic。

### 5. 符号审计守护
* 在 CI 校验中增设链接后静态审计，扫描生成的二进制符号表，严禁任何 C++ 异常回溯（如 `__cxa_throw`）或标准 STL 命名空间符号溢出到内核。

---

## 后果与约束（Consequences & Constraints）

### 正面后果
* **完美的 SSOT 体验**：开发者无需在 Sketch 中 hard-code 任何物理引脚，只需直接使用 codegen 导出的变量即可，彻底解决引脚配置不同步的问题。
* **高度诚实的仿真反馈**：配置缺失时，系统 Fail-Loud 暴露问题，从而消除了“虚假成功”的现象，降低了设备实地测试时的故障率。
* **隔离依然成立**：C 语言内核对 C++ Sandboxing 无感知，维持零开销的静态分发底座。

### 约束
* **第三方库局限性**：依赖原生 busy-wait（如 `pulseIn` 循环）的未修改第三方声纳库在仿真端无法运行，必须替换为 Wink 提供的包装层或声明 JSON。

