# README
- en: [English](./README.md)
- zh_CN: [简体中文](./README.zh_CN.md)

# Wink-Micro-OS ESP32 固件

将 `wink-micro-os/samples/` 下的业务应用编译为可烧录到 ESP32 的固件。

---

## 🎯 核心特性：业务代码零改固件

**业务代码放在 `wink-micro-os/samples/<AppName>/`，换 App / 增删源文件，`esp32_firmware/` 源码一行都不用改！**

由 `generate_app_sources.ps1` 脚本自动扫描并注入构建。

---

## 📜 generate_app_sources.ps1 — 自动扫描 App 源文件

### 作用

自动扫描 `wink-micro-os/samples/<AppName>/` 下的所有 `.c` 源文件（排除 host 端到端测试文件 `test_*.c`），生成 CMake 片段 `main/app_sources.cmake`，供构建系统自动引入。

**彻底消除：**
- 换 App 时手动改 `CMakeLists.txt` 路径
- 新增源文件时手动添加到 `SRCS` 列表
- 硬编码耦合业务目录结构

### 使用方式

**方式一：CMake 自动调用（推荐，完全无感）**
```powershell
# 直接 build 即可，脚本会在 configure 阶段自动运行
idf.py build
```

**方式二：手动指定 App**
```powershell
# 编译指定 App（零改源码）
idf.py build -DWINK_APP=devkitc_smoke
idf.py build -DWINK_APP=avoidance_car
idf.py build -DWINK_APP=oled_dashboard
```

**方式三：单独跑脚本（调试用）**
```powershell
# 生成默认 App (devkitc_smoke)
.\generate_app_sources.ps1

# 生成指定 App
.\generate_app_sources.ps1 -AppName avoidance_car
```

### 生成产物

脚本输出到 `main/app_sources.cmake`（**自动生成，请勿手动修改**）：
```cmake
set(WINK_APP_NAME "devkitc_smoke")
set(WINK_APP_DIR ".../wink-micro-os/samples/devkitc_smoke")
set(WINK_APP_SOURCES
    .../app_callbacks.c
    .../board_config.c
    .../device_tree.c
)
```

---

## 🚀 完整烧录流程

### 1. 进入固件目录并激活 ESP-IDF 环境（PowerShell）

```powershell
# 进入 esp32_firmware 目录
cd esp32_firmware

# 激活 EIM profile
. 'C:\Espressif\tools\Microsoft.v6.0.1.PowerShell_profile.ps1' *> $null

# 解决中文编码问题（必须）
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'

# 验证激活成功
idf.py --version
```

### 2. 编译固件

```powershell
# （可选）彻底清空 build 目录，从零重编
idf.py fullclean

# 编译默认 App (devkitc_smoke)
idf.py build

# 或编译指定 App（零改源码）
idf.py build -DWINK_APP=avoidance_car
```

### 3. 烧录 + 串口监视器

```powershell
# 将 COM3 替换为你的实际串口号
idf.py -p COM3 flash monitor
```

### 4. 退出监视器

按快捷键：`Ctrl + ]`

---

## 📋 可用 App 列表

| App 名称 | 说明 |
|---|---|
| `devkitc_smoke` | DevKitC 冒烟测试（GPIO / PWM / I2C / 双核 / 看门狗）|
| `avoidance_car` | 避障小车（超声波 + 舵机） |
| `oled_dashboard` | OLED 仪表盘（按键 + LED + SSD1306） |

---

## 💡 常见问题

### Q: 新增了一个 `.c` 源文件，需要改 CMakeLists.txt 吗？
**不需要。** 脚本会自动扫描到，重新 `idf.py build` 即可。

### Q: 编译报中文注释乱码错误？
已在 CMake 中配置 GCC UTF-8 编码标志（`-finput-charset=UTF-8`），正常不会遇到。如果仍有问题，请确保源文件保存为 UTF-8 编码。

### Q: 什么时候需要 `fullclean`？
- 换 App 后
- 修改了 CMake 脚本后
- 遇到奇怪的链接错误 / 构建问题时
- 日常改代码直接 `build` 即可，不需要 `fullclean`

### Q: `IDF_TARGET is not set, guessed 'esp32'` 是错误吗？
**不是。** 这是正常信息——ESP-IDF 从 `sdkconfig` 自动检测到编译目标为 `esp32`，可以忽略。

---

## 📐 架构说明

```
esp32_firmware/
├── CMakeLists.txt              # ESP-IDF 工程入口，EXTRA_COMPONENT_DIRS 引入 targets/esp32
├── generate_app_sources.ps1    # ✅ 自动扫描 samples App 源文件
├── sdkconfig                   # ESP32 默认配置（2MB flash）
└── main/
    ├── app_main.c              # FreeRTOS task 创建 + 栈/heap 监控
    ├── CMakeLists.txt          # 引入自动生成的 app_sources.cmake
    └── app_sources.cmake       # ⚙️ 脚本自动生成，请勿手动修改
```
