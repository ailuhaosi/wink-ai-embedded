# ⚡ 5 分钟快速上手指南 (Getting Started Guide)

本指南帮助新开发者和 AI Agent 快速搭建环境、拉起 `wink-micro-os` 本地 WebAssembly 仿真并运行第一个闭环 Demo。

---

## 1. 基础环境依赖 (Prerequisites)

在开始之前，请确保本地安装了以下工具链：

* **Node.js**: `>= 18.0.0`
* **Python**: `>= 3.9` (用于运行文档/计划校验脚本)
* **CMake & GCC / Clang**: (可选，用于本地交叉编译 MCU C 内核原生单元测试)
* **Emscripten (emsdk)**: (可选，用于重新编译 `wink-micro-os` 到 `wasm32`)

---

## 2. 5 分钟运行第一个 Wasm 仿真 Demo

### 步骤 1：安装依赖与构建
```bash
# 进入工作区
cd wink-ai-embedded

# 运行工具链测试或本地构建
python docs/implementation-plans/scripts/list_plans.py
```

### 步骤 2：加载示例 Manifest (`wink-app.json`)
平台基于单一事实源配置文件驱动外设拓扑。可以在 `examples/` 目录下找到标准的示例 Manifest：

```json
{
  "schemaVersion": 2,
  "name": "hello_blink",
  "target_board": "esp32_devkitc",
  "tick_ms": 10,
  "devices": [
    {
      "id": "led_1",
      "model": "gpio_led",
      "pin_map": { "pin": 2 }
    }
  ]
}
```

### 步骤 3：启动 Wasm 仿真与在线跟踪
* 在前端工作台载入导出的 Wasm 模块 (`wink_micro_os.wasm`)。
* 观察 Console 打印的 `SimTraceSpecV2` 事件流：
  ```text
  [TRACE] 00:00:00.010000 | GPIO_SET | pin: 2 | value: 1
  [TRACE] 00:00:00.510000 | GPIO_SET | pin: 2 | value: 0
  ```

---

## 3. 常见开发导引

* **修改 C 内核 DAL/PAL** ➔ 参见 [02-wink-micro-os 设计规范](../02-wink-micro-os/README.md)
* **查看 Wasm Bridge ABI 契约** ➔ 参见 [04-wasm-simulation 设计规范](../04-wasm-simulation/00-README.md)
* **AI 检索提示** ➔ 请参阅 [docs/AGENTS.md](../../AGENTS.md)
