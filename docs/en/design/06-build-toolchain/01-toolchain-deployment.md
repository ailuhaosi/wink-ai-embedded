# 06. One-Click Physical Compilation & Deployment Pipeline

<!-- i18n-meta
source: docs/zh/design/06-build-toolchain/01-toolchain-deployment.md
translated: 2026-08-17
glossary-version: v1.0
translator: AI-assisted
sync-status: up-to-date
-->

The final closed loop of the Low-Code AI Simulation platform is deploying logic verified in the web browser directly onto physical microcontrollers, achieving true "What You See Is What You Get" (WYSIWYG) hardware delivery. This specification details the cloud/local cross-compilation pipeline and driverless browser-based flashing using WebSerial and WebUSB.

---

## 1. Physical Deployment Architecture

From visual canvas wiring to physical MCU execution, the automated compilation and deployment pipeline proceeds as follows:

```text
  [ Web Low-Code Canvas ] ─── 1. Export Netlist & Business Logic ───► [ Compilation API ]
                                                                             │
                                                                             ▼
                                                                ┌──────────────────────────┐
                                                                │ Build Server (Container) │
                                                                │ - Target PAL binding     │
                                                                │ - Code & Manifest inject │
                                                                │ - GCC Cross-Compilation  │
                                                                └────────────┬─────────────┘
                                                                             │ 4. Return Binary
                                                                             ▼
  [ Target Physical MCU ] ◄─── 5. WebSerial / WebUSB Flashing ─── [ Browser Web Client ]
```

---

## 2. Dockerized Cloud Cross-Compilation Pipeline

To eliminate the friction of configuring complex, conflicting MCU toolchains locally (e.g., ESP-IDF, ARM GCC, MinGW), the platform provides a containerized automated build service.

### 2.1 Build Server Workflow
1. **Topology & Logic Ingestion**: Ingests exported `app_main.c` (application logic) and generated `device_tree.c` / `device_tree.h`.
2. **Dynamic Container Spin-up & Cache Mounting**:
   * Launches specialized Docker image according to target platform (e.g., `-DTARGET_PLATFORM=esp32`).
   * Mounts global build cache. Caches precompiled static libraries (e.g., `libpal.a`) to reduce compilation time down to **3~5 seconds** via differential linking.
3. **Cross-Compilation Execution**:
   * **ESP32**: Invokes `xtensa-esp32-elf-gcc` and bundles bootloader, partition table, and app firmware into a unified `.bin` via `esptool.py`.
   * **STM32**: Invokes `arm-none-eabi-gcc` to produce sector-aligned `.hex` or `.bin` binaries.
4. **Status & Diagnostics Feedback**: Returns compiled binary stream on success, or extracts formatted GCC stdout/stderr diagnostics with Monaco editor squiggly line annotations on failure.

### 2.2 Static Analysis Quality Gates
Before compilation, code must pass these static analysis guardrails:
* **Stack Usage Gate**: `-Wstack-usage=1536 -Werror=stack-usage`
* **Recursion Ban Gate**: `clang-tidy` with `misc-no-recursion` enabled
* **VLA/alloca Ban Gate**: `clang-analyzer-security.insecureAPI.alloca` enabled
* **Braces Enforcement Gate**: `readability-braces-around-statements` enabled
* **Packed Struct Ban Gate**: POD structs strictly forbid `__attribute__((packed))`

---

## 3. WebSerial Driverless In-Browser Flashing Mechanism

For mainstream microcontrollers equipped with USB-to-UART bridge chips (e.g., ESP32, RP2040, NodeMCU), the web client communicates directly via the Chromium **WebSerial API**.

### 3.1 Key Advantages
* **Zero Driver Installation**: Users do not need to install CP210x/CH34x drivers or specialized flashing desktop tools.
* **Sandbox Security**: All operations require explicit user device authorization, isolated within the browser security sandbox.

### 3.2 Serial Flashing Protocol Flow (ESP32 ROM Bootloader Example)
1. **Device Request & Connection** (`navigator.serial.requestPort()`)
2. **Hardware Reset into Bootloader** (DTR/RTS toggling)
3. **Handshake & Baud Rate Sync** (Syncing and negotiation up to 921600 baud)
4. **Flash Erase & Write** (SLIP packets with chunked MD5 validation)
5. **Reboot Execution** (Releasing DTR/RTS lines to boot new firmware)
