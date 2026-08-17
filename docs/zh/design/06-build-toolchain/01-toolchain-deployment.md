# 05. 一键真机编译与烧录上线管线 (Toolchain & Deployment)

低代码 AI 仿真平台的最终闭环是将网页端验证通过的逻辑，直接烧录部署到真实的硬件单片机上，实现“所见即所得”的开发交付。本文件详细解析了平台云端/本地交叉编译流水线、以及利用浏览器原生 WebSerial/WebUSB API 实现免驱动一键在线烧录固件的闭环设计。

---

## 1. 一键真机部署管线总体架构

从网页编排完毕到真机上电运行，整个自动烧录流水线的执行流程如下所示：

```text
  [ 网页低代码画布 ] ─── 1. 导出拓扑网表与应用逻辑 ───► [ 编译请求 API ]
                                                             │
                                                             ▼
                                                ┌──────────────────────────┐
                                                │  编译服务器 (Docker 容器) │
                                                │ - 检出目标 PAL 物理实现    │
                                                │ - 注入应用代码与映射关系   │
                                                │ - 调用 GCC 交叉编译器构建   │
                                                └────────────┬─────────────┘
                                                             │ 4. 返回二进制固件
                                                             ▼
  [ MCU 实体单片机 ] ◄─── 5. WebSerial / WebUSB 写入 ─── [ 浏览器 Web 客户端 ]
```

---

## 2. 云端交叉编译管线 (Dockerized Compilation Pipeline)

为了免除用户在本地配置复杂且易冲突的 MCU 交叉编译环境（如 ESP-IDF 链、ARM gcc 链、MinGW 等），平台提供云端 Docker 化自动编译服务。

### 2.1 编译服务器工作流步骤
1. **拓扑与逻辑接收**：编译接口接收前端导出的 `app_main.c` (App 业务代码) 以及由电路连接生成的 `device_tree.c` 与 `device_tree.h`。
2. **环境动态拉起与缓存挂载**：
   * 根据目标硬件平台（如 `-DTARGET_PLATFORM=esp32`），拉起对应的定制 Docker 镜像。
   * 挂载全局编译缓存目录。为了将原本需要几分钟的编译时间缩短至 **3~5秒**，编译器会强缓存 WinkMicroOS 的静态组件库（如预编译的 `libpal.a`），每次只对用户的 App 代码和设备树进行增量差分编译与静态链接。
3. **交叉编译执行**：
   * **ESP32**：调用 `xtensa-esp32-elf-gcc` 进行编译，并利用 `esptool.py` 打包工具将 bootloader、partition_table 和 app 固件合并为单个一键刷写的 `.bin` 文件。
   * **STM32**：调用 `arm-none-eabi-gcc` 编译，生成含有中断矢量及闪存扇区对齐的 `.hex` 或 `.bin` 二进制包。
4. **状态回传**：若编译成功，返回构建完成的文件下载流；若编译失败，提取 gcc 的编译 stdout/stderr 错误日志返回前端，在 Monaco 编辑器下显示红色波浪线与编译排错引导。

### 2.2 静态检查门禁（review P1-5 / Phase 6 Task 6-2）
编译前须过以下静态检查门禁，防止 AI-CodeGen 或驱动扩展破坏不变量：

* **栈深度门禁**（P-stack）：编译 App/BAL 代码时开启 `-Wstack-usage=1536 -Werror=stack-usage`（配置见 `wink-micro-os/CMakeLists.txt` `WINK_STACK_USAGE_LIMIT`）→ 任何单函数栈帧超 1536 字节的生成代码编译失败，要求 AI 优化。
* **递归检测门禁**（P-stack）：`clang-tidy -p build` 启用 `misc-no-recursion`（配置见 `wink-micro-os/.clang-tidy`）→ 0 告警。AI Codegen 及手动补充的 App 代码均不得包含递归调用链（含互递归 A→B→A）。需 clang-tidy ≥ 12。
* **VLA/alloca 禁令门禁**（P-stack）：`clang-tidy -p build` 启用 `clang-analyzer-security.insecureAPI.alloca` → 0 告警。禁止变长栈分配（`alloca`、VLA `int arr[n]`），嵌入式栈上不允许运行时可变分配。
* **大括号门禁**（review P1-2）：`clang-tidy -p build wink-micro-os/**/*.c`（规则 `readability-braces-around-statements`，配置见 `wink-micro-os/.clang-tidy`）→ 0 告警。
* **packed 禁令门禁**（review P1-5）：runtime/DAL POD 禁 `__attribute__((packed))` / `#pragma pack`：
  ```bash
  rg "__attribute__\s*\(\(packed\)\)|#pragma\s+pack" wink-micro-os/dal wink-micro-os/runtime
  ```
  → **0 命中**。`packed` 仅允许在未来的 `protocol/`、`storage/` 或显式白名单 wire header 下（这些目录尚未建立，本门禁为预防性）。
* **PAL 失败型 API 状态化门禁**（review P1-1）：
  ```bash
  rg "bool pal_(gpio_init|gpio_enable_interrupt|gpio_disable_interrupt|pwm_init|pwm_set_duty|i2c_transfer|mutex_lock|mutex_unlock)" wink-micro-os
  ```
  → 0 命中（无残留 bool 签名混合态）。

### 2.3 SDK Binary 钉版本与 manifest

Dual-Mode SDK Phase 2 引入 Binary SDK 变体（`wink-micro-os-sdk-binary-vX.Y.Z.tar.gz`），不交付实现源码。对外 Job 与对内 Job 的分发策略：

| Job 类型 | SDK 变体 | 验证方式 |
|----------|----------|----------|
| 对外（商业分发） | Binary SDK | `SDK_MANIFEST.txt` 中 `content_sha256` 校验包完整性；`toolchain=` / `cflags=` 钉编译器与 flags |
| 对内（云端 / 调试） | Source SDK | 可本地重编，完整源码可调试 |

`SDK_MANIFEST.txt` 字段：

```text
mode=binary
targets=host
version=0.1.0
abi=1
toolchain=gcc (MinGW-w64) 14.2.0
cflags=-DWINK_MAX_SOFT_TIMERS=32 -DPAL_PWM_CHANNELS=16 -ffunction-sections -fdata-sections
content_sha256=<sha256 of sorted file contents>
files:
  <per-file sha256>  <path>
```

ABI 版本规则与工具链矩阵见 [ADR-0028](../../decisions/core/0028-host-binary-abi-toolchain-contract.md)。公开头签名或 POD 布局变更 → MAJOR + `ABI++`；仅 `.c` 行为修复 → PATCH。


---

## 2.4 本地工具链引导（`wink.py` 前置门控）

Phase A 起，`wink.py` 的所有面向用户子命令（`gen` / `build` / `esp32` / `test` / `web` / `doctor` / `setup`）在进入 handler 前统一由 `wink-tools/tools/toolchain/` 提供的 `ensure_for(profile)` 做**前置门控**。

- **策略：command-front `ensure_for`（非 doctor-only、非 docker-first）**
  - 每个子命令声明自己的 profile（`codegen` / `host` / `wasm` / `test` / `esp32` / `web`）。
  - `ensure_for` 展开 profile DAG → 通过 Provider detect 能力（Python、Jinja2、gcc、cmake、make、emsdk、idf、node、powershell）→ **collect-all** 一次性报出所有缺失/损坏项 → 全部通过后按 profile 注入 `PATH` / `IDF_PATH` / `PYTHONUTF8` 等环境变量。
  - 逃生舱：`--skip-toolchain-check` 全局旗标绕过门控，触发时 stderr 打印醒目 WARN；仅供 CI 应急/调试使用，不是正常路径。
  - 决议见 [ADR-0029](../../decisions/tools/0029-toolchain-command-front-gating.md)。

- **策略：ESP-IDF 永不自动安装**
  - `providers/idf.py.install()` **无条件**抛 `UnsupportedError`；`wink setup --install idf`（Phase B）走同一通道。
  - `doctor` 与门控失败报告在提到 IDF 时**必现**"`ESP-IDF is never auto-installed by Wink. Please install via Espressif IDF Manager (EIM) or see wink-tools/preinstall.md §3.`"文案，并附 `PYTHONUTF8=1` UTF-8 提示。
  - 用户可以用 `wink setup --set idf=<path> --set idf_tools=<path>` 让 Wink 识别非标准位置，但安装/驱动/许可确认永远由 EIM（或手动步骤）承担。
  - 决议见 [ADR-0030](../../decisions/core/0030-esp-idf-never-auto-installed.md)。

- **硬编码机器路径下架**：`wink.py` 顶部 WinLibs `PATH` 前置、`python wink-tools/wink.py test` 里的 emsdk 默认路径块统一删除，改为消费 `ensure_for` 注入后的环境或 EIM profile 回退。`scripts/build_esp32.ps1` 与 `esp32_firmware/generate_app_sources.ps1` 已迁移至 `wink-tools/tools/esp32/{activate,build,generate_app_sources}.py`；`wink.py esp32` 通过 `ensure_for` 注入 IDF env 后交由 Python 入口驱动，旧 PS1 已替换为 fail-fast stub。esp32 profile 不再要求 `powershell` capability（`activate.py` 在 Windows 上按需调用 System32 powershell.exe 采集 EIM profile，非 Windows 由 `IdfProvider.detect()` 返回明确错误）。IDF Provider 只保留少量 EIM 已知探测模式（如 `C:\Espressif\tools\Microsoft.v*.PowerShell_profile.ps1`）作为发现路径，不作为业务路径。

- **SDK 打包对齐**：`tools/toolchain/` 为纯 Python 包，`pack_sdk_source.py` / `pack_sdk_binary.py` 都会把它打入 tarball，Source/Binary 消费者获得完全一致的 `wink doctor` / `wink setup` 体验，与 [ADR-0028](../../decisions/core/0028-host-binary-abi-toolchain-contract.md) 的工具链矩阵校验联动执行。

详细 Provider 契约、报告格式、`wink setup` 语义、profile-scoped 环境注入规则见 [Toolchain Bootstrap Design Spec](../../superpowers/specs/2026-07-13-wink-toolchain-bootstrap-design.md) 与后续 `docs/tech-designs/` 归档。


---

## 3. WebSerial 浏览器串口免驱烧录机制

针对目前主流的带有 USB-to-UART 桥接芯片的微控制器（如 ESP32、RP2040、NodeMCU 等），平台直接调用 Chromium 浏览器内核提供的 **WebSerial API** 进行烧录。

### 3.1 核心优势
*   **零驱动安装**：用户无需在本机下载各种 USB 转串口驱动程序，也无需安装专门的烧录客户端软件。
*   **沙箱安全**：所有操作均通过浏览器用户显式授权，遵循浏览器沙箱安全策略，不危害主机文件系统。

### 3.2 串口闪存写入时序流程 (以 ESP32 ROM 引导为例)
Web 烧录前端利用 TS 重新实现了 Espressif 官方的串口通信握手协议，主要阶段如下：

1. **设备请求与连接**：
   ```typescript
   // 请求串口授权
   const port = await navigator.serial.requestPort();
   await port.open({ baudRate: 115200 }); // 初始握手波特率
   ```
2. **硬件复位进入 Bootloader (DTR/RTS 切换)**：
   微控制器复位需要通过控制串口的 DTR 和 RTS 控制线以特定的电平波形拉低 RST 和 IO0 引脚，使芯片强制重启进入 internal ROM Bootloader：
   ```typescript
   await port.setSignals({ dataTerminalReady: false, readyToSend: true }); // 拉低 IO0
   await port.setSignals({ dataTerminalReady: true, readyToSend: true });  // 拉低 EN (Reset)
   await delay(100);
   await port.setSignals({ dataTerminalReady: false, readyToSend: false }); // 释放 EN，启动进入 ROM
   ```
3. **握手与参数协商 (Syncing)**：
   发送 `0x08` 同步帧，接收芯片返回的 `0x08` 应答。协商通信波特率，将波特率从 `115200` 快速提升至 `921600`（或更高），以加快下载速度。
4. **闪存擦除与写入 (Write Flash)**：
   数据传输协议采用 **SLIP (Serial Line Internet Protocol)** 封包格式。
   * 将云端编译回传的二进制数据按照 4KB 扇区对齐分包。
   * 循环发送 `FLASH_DATA` 指令包，附带分包 MD5 校验，直到进度达到 100%。
5. **重启运行**：
   发送 `FLASH_DEFLATE` 结束烧录指令，拉低 EN 引脚并重新释放（DTR/RTS 控制线释放），芯片重启执行刚刚下载的新固件。

---

## 4. Future：WebUSB 浏览器 USB DFU 烧录机制

对于原生支持 USB OTG、无需串口芯片直连 DFU 模式的芯片（如 STM32F4、RP2040 原生 USB），后续阶段可采用 **WebUSB API** 对接 USB 端点进行固件投递。该能力不属于 MVP 主路径。

### 4.1 DFU (Device Firmware Upgrade) 原理
*   **步骤 1**：用户用数据线连接板子并按住 Boot 键上电，芯片的 USB OTG 切换至 DFU 功能描述符状态。
*   **步骤 2**：Web 客户端请求 USB 设备过滤 `vendorId: 0x0483` (STMicroelectronics DFU 模式)。
*   **步骤 3**：调用 `device.controlTransferOut` 发送标准的 DFU 状态机切换请求（如 `DFU_DNLOAD` 和 `DFU_GETSTATUS`），向 Flash 对应地址直接下发固件字节。
*   **步骤 4**：发送 `DFU_MANIFEST` 完成命令，解除 DFU 连接状态，复位重启运行。

通过集成 WebSerial 和 WebUSB 这两大底层浏览器通信技术，Wink-AI 平台彻底打通了从**“云端低代码辅助设计 -> Wasm 沙箱零开销仿真 -> 浏览器直连物理真机部署”**的完整闭环，实现了极致流畅的物联网硬件开发体验。

