# Wink-AI 嵌入式平台全局文档中心 (Documentation Hub)

欢迎来到 **Wink-AI 嵌入式开发与仿真系统 (WinkMicroOS)** 文档中心。本仓库采用**“SSOT 架构规范与过程管理隔离”**的大型开源工程文档标准，并全面实行 **“领域优先 (Domain First)”** 的 4 大正交领域（`core`, `tools`, `frontend`, `unisim`）归类架构。

---

## 🏛️ 文档体系结构总览

```text
docs/
├── README.md                           # 📖 全局文档中心入口 (本文件)
├── AGENTS.md                           # 🤖 AI Agent 专属检索指南与黑盒隔离铁律
│
├── design/                             # 🏛️ 【纯粹架构事实源】系统 7 大模块架构规范 (Active SSOT)
│   ├── 01-system-overall/              # 1. 系统总体架构与 MVP 路线
│   ├── 02-wink-micro-os/               # 2. C 内核抽象层规范 (DAL / PAL / BAL)
│   ├── 03-app-codegen/                 # 3. 应用层、Project Manifest 与 AI Codegen
│   ├── 04-wasm-simulation/             # 4. UniSim 仿真规范 (含 archive/)
│   ├── 05-frontend-workbench/          # 5. 前端工作台与 2D/3D 双视窗
│   ├── 06-build-toolchain/             # 6. 云编译与烧录工具链
│   └── 07-platform-governance/         # 7. 器件 Registry、故障注入与虚实一致性
│
├── decisions/                          # 📜 【架构决策记录】按领域拆分的 ADR 决策库 (0001- ~ 0063-)
│   ├── core/                           # C 内核决策 (PAL / DAL / BAL)
│   ├── tools/                          # CLI / Codegen / Lint 工具链决策
│   ├── frontend/                       # 前端交互与设备树 SSOT 决策
│   ├── unisim/                         # Wasm 仿真引擎与物理仿真决策
│   └── scripts/                        # list_adrs.py (ADR 状态与领域扫描 CLI)
│
├── tech-designs/                       # 💡 【技术方案 RFC】按领域拆分的详细提案
│   ├── core/                           # 嵌入式内核 (DAL / PAL / BAL) 方案
│   ├── tools/                          # CLI / Codegen / 云编译方案
│   ├── frontend/                       # 前端 / Canvas 3D 方案
│   └── unisim/                         # Wasm 仿真引擎方案
│
├── implementation-plans/               # 🚀 【阶段实施计划】按领域拆分的 Plan 开发步骤
│   ├── core/                           # C 内核实施计划 (active / archived)
│   ├── tools/                          # 工具链实施计划 (active / archived)
│   ├── frontend/                       # 前端实施计划 (active / archived)
│   ├── unisim/                         # Wasm 仿真引擎实施计划 (active / archived)
│   └── scripts/                        # list_plans.py (Plan 状态与领域扫描 CLI)
│
└── reviews/                            # 🔍 【架构评审与测试报告】按领域拆分的 Review 库
    ├── core/                           # C 内核评审与硬件 Smoke 报告
    ├── tools/                          # 工具链架构评审报告
    ├── frontend/                       # 前端评审与 Wokwi 对齐报告
    └── unisim/                         # 仿真引擎评审与 Deep Dive 报告
```

---

## 📋 快速导航与工具

### 1. 命令行查询工具 (CLI Tools)
* **查看实施计划状态（支持按领域筛选 `-d`）**：
  ```powershell
  python docs/implementation-plans/scripts/list_plans.py       # 显示活跃计划
  python docs/implementation-plans/scripts/list_plans.py -a    # 显示全部计划 (含归档)
  python docs/implementation-plans/scripts/list_plans.py -d unisim  # 查看仿真领域计划
  ```
* **查看 ADR 架构决策（支持按领域筛选 `-d`）**：
  ```powershell
  python docs/decisions/scripts/list_adrs.py -a
  python docs/decisions/scripts/list_adrs.py -d frontend
  ```

### 2. 文档贡献与治理口诀与回写契约

> 📌 **文档治理十六字口诀**：
> **架构改动改 design (SSOT)    │  重大选型开 decisions (ADR)**
> **方案分类进 tech-designs    │  计划结项归 domain archived**

#### 🔄 SSOT 闭环回写契约 (SSOT Back-write Contract)
为防止架构决策 (ADR) 与技术方案 (Tech-Designs) 随时间演进与 `docs/design/` (SSOT) 发生漂移，仓库执行以下硬性约束：
1. **ADR / RFC 头部标记**：所有 ADR 与 Tech-Design 的元数据表格中必须包含 `| **回写 SSOT 目标文档** |` 与 `| **SSOT 回写状态** | (Pending / Completed)`。
2. **结项归档闭环**：当 ADR 状态变更为 `Accepted` 或实施计划结项移入 `archived/` 时，作者必须将新架构/契约回写至 `docs/design/01~07/` 对应文件，并将状态标记为 `Completed`。
3. **自动化比对工具**：可运行 `python docs/scripts/check_ssot_sync.py` 查验是否有未闭环回写 SSOT 的 ADR 项。

---


