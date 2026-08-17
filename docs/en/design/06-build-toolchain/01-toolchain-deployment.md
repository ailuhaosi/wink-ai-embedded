# 05. 一键真机编译与烧录上线管线 (Toolchain & Deployment)

<!-- i18n-meta
source: docs/zh/design/06-build-toolchain/01-toolchain-deployment.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

The final closed loop of the low-code AI simulation platform is directly flashing and deploying verified logic onto physical microcontrollers. This document details the cloud/local cross-compilation pipeline and driverless browser flashing via WebSerial/WebUSB APIs.

---

## 1. 一键真机部署管线总体架构

```text
  [ Web Low-Code Canvas ] ─── 1. Export Netlist & Application Logic ───► [ Build Request API ]
                                                                             │
                                                                             ▼
                                                                ┌──────────────────────────┐
                                                                │ Build Server (Docker)    │
                                                                │ - Check out Target PAL   │
                                                                │ - Inject Code & Pin Maps │
                                                                │ - Execute GCC Toolchain  │
                                                                └────────────┬─────────────┘
                                                                             │ 4. Return Binary Firmware
                                                                             ▼
  [ Physical Target MCU ] ◄─── 5. WebSerial / WebUSB Flashing ─── [ Browser Web Client ]
```

---

## 2. 云端交叉编译管线 (Dockerized Compilation Pipeline)

To spare users from installing conflicting MCU toolchains locally (ESP-IDF, ARM GCC, MinGW), the platform provides containerized cloud build services.

### 2.1 编译服务器工作流步骤
1. **Receive Topology & Code**: Receives `app_main.c` along with generated `device_tree.c` and `device_tree.h`.
2. **Dynamic Container Spawning & Cache Mounting**: Spawns tailored Docker images with mounted global build caches. Precompiled `libpal.a` reduces compilation duration to **3–5 seconds**.
3. **Cross-Compilation Execution**:
   - **ESP32**: Compiles with `xtensa-esp32-elf-gcc` and uses `esptool.py` to merge bootloader, partition table, and app binaries into a unified `.bin` artifact.
   - **STM32**: Invokes `arm-none-eabi-gcc` producing `.hex` or `.bin` binaries.
4. **Status Streaming**: Streams completed binary downloads or returns GCC stdout/stderr compilation logs mapped to Monaco editor lines.

### 2.2 静态检查门禁（review P1-5 / Phase 6 Task 6-2）
Pre-compilation quality gates:
- **Stack Depth Gate**: Compiles with `-Wstack-usage=1536 -Werror=stack-usage`. Single frames exceeding 1536 bytes fail compilation.
- **Recursion Detection Gate**: `clang-tidy` enforces `misc-no-recursion` with zero tolerance.
- **VLA / Alloca Ban Gate**: `clang-analyzer-security.insecureAPI.alloca` rejects variable-length stack allocations.
- **Braces Gate**: `readability-braces-around-statements` ensures consistent control blocks.
- **Packed Struct Ban Gate**: Prohibits packed attributes in runtime/DAL:
  ```bash
  rg "__attribute__\s*\(\(packed\)\)|#pragma\s+pack" wink-micro-os/dal wink-micro-os/runtime
  ```
- **PAL Fallible Return Code Gate**:
  ```bash
  rg "bool pal_(gpio_init|gpio_enable_interrupt|gpio_disable_interrupt|pwm_init|pwm_set_duty|i2c_transfer|mutex_lock|mutex_unlock)" wink-micro-os
  ```

### 2.3 SDK Binary 钉版本与 manifest

Dual-Mode SDK Phase 2 introduces Binary SDK variants (`wink-micro-os-sdk-binary-vX.Y.Z.tar.gz`):

| Job 类型 | SDK 变体 | 验证方式 |
|---|---|---|
| External Commercial | Binary SDK | `SDK_MANIFEST.txt` validates package integrity via `content_sha256`; locks `toolchain=` and `cflags=` |
| Internal Cloud / Debug | Source SDK | Recompiles locally from source |

`SDK_MANIFEST.txt` schema:

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

---

## 2.4 本地工具链引导（`wink.py` 前置门控）

All `wink.py` commands (`gen`, `build`, `esp32`, `test`, `web`, `doctor`, `setup`) pass through command-front gating provided by `tools/toolchain/ensure_for(profile)`:
- **Command-Front `ensure_for`**: Validates prerequisites and injects environment variables (`PATH`, `IDF_PATH`, `PYTHONUTF8`).
- **ESP-IDF Never Auto-Installed**: Explicitly prompts users to install via Espressif IDF Manager (EIM) per [ADR-0030](../../decisions/core/0030-esp-idf-never-auto-installed.md).
- **Zero Hardcoded Paths**: Dynamic detection replaces absolute paths.

---

## 3. WebSerial 浏览器串口免驱烧录机制

Chromium's **WebSerial API** allows driverless browser-based flashing for microcontrollers with USB-to-UART bridges (ESP32, RP2040).

### 3.1 核心优势
- **Zero Driver Installation**: No external USB-UART drivers required.
- **Sandbox Security**: Browser permissions maintain security without host filesystem compromise.

### 3.2 串口闪存写入时序流程 (以 ESP32 ROM 引导为例)
1. **Device Connection**:
   ```typescript
   const port = await navigator.serial.requestPort();
   await port.open({ baudRate: 115200 });
   ```
2. **Hardware Reset to ROM Bootloader (DTR/RTS Toggling)**:
   ```typescript
   await port.setSignals({ dataTerminalReady: false, readyToSend: true });
   await port.setSignals({ dataTerminalReady: true, readyToSend: true });
   await delay(100);
   await port.setSignals({ dataTerminalReady: false, readyToSend: false });
   ```
3. **Syncing & Baudrate Escalation**: Handshakes via `0x08` frames, increasing baudrate to `921600`.
4. **SLIP Packetized Flashing**: Streams 4KB sector aligned binary chunks with MD5 verification.
5. **Reboot Execution**: Sends `FLASH_DEFLATE` and releases RTS/DTR lines to boot the target application.

---

## 4. Future：WebUSB 浏览器 USB DFU 烧录机制

For microcontrollers supporting native USB OTG (STM32F4, RP2040), future milestones will incorporate the **WebUSB API** for direct DFU firmware transfer.

### 4.1 DFU (Device Firmware Upgrade) 原理
- **Step 1**: Device boots into DFU descriptor mode by holding the BOOT button.
- **Step 2**: Web client filters for STMicroelectronics DFU devices (`vendorId: 0x0483`).
- **Step 3**: Issues `device.controlTransferOut` requests (`DFU_DNLOAD` / `DFU_GETSTATUS`) streaming firmware bytes to Flash.
- **Step 4**: Issues `DFU_MANIFEST` command to reset the MCU and execute downloaded firmware.
