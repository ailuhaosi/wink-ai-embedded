# Wink-AI 嵌入式平台全局文档中心 (Documentation Hub)

> 🌐 **多语言导航 / Language**：[🇨🇳 中文文档入口 (zh/)](zh/README.md) ｜ [🇺🇸 English Docs Hub (en/)](en/README.md)

欢迎来到 **Wink-AI 嵌入式开发与仿真系统 (WinkMicroOS)** 文档中心。本仓库采用**“双语架构事实源 (Bilingual SSOT) + 单份过程管理工件 (Single-Copy SDD Artifacts)”**的现代化多语言文档治理体系，并全面实行 **“领域优先 (Domain First)”** 的 4 大正交领域（`core`, `tools`, `frontend`, `unisim`）归类架构。

---

## 🏛️ 文档体系结构总览

```text
docs/
├── README.md                           # 📖 全局文档中心入口 (本文件)
├── AGENTS.md                           # 🤖 AI Agent 专属检索指南与黑盒隔离铁律
├── I18N_IMPLEMENTATION_PLAN.md         # 📌 多语言实施与演进计划
│
├── i18n/                               # 🌐 【全局术语与本地化中心】
│   ├── GLOSSARY.md                     # 人类可读权威术语表与 Doxygen 规范
│   └── glossary.yaml                   # 机器可读 Canonical 与 Forbidden 词条
│
├── zh/                                 # 🇨🇳 【中文长效 SSOT 根目录】
│   ├── README.md                       # 中文文档总览
│   ├── design/                         # 系统 7 大模块架构规范 (00 ~ 07)
│   ├── tech-designs/                   # 核心技术方案与 RFC
│   └── product/                        # 产品与市场分析文档
│
├── en/                                 # 🇺🇸 【英文长效 SSOT 根目录】
│   ├── README.md                       # English Documentation Overview
│   ├── design/                         # System 7-Module Architecture Specs (00 ~ 07)
│   ├── tech-designs/                   # Core Technical RFCs
│   └── product/                        # Product & Market Analysis
│
├── decisions/                          # 📜 【单份维护 · SDD 决策流】ADR 决策库 (0001- ~ 0063-)
│   ├── core/                           # C 内核决策 (PAL / DAL / BAL)
│   ├── tools/                          # CLI / Codegen / Lint 工具链决策
│   ├── frontend/                       # 前端交互与设备树 SSOT 决策
│   ├── unisim/                         # Wasm 仿真引擎与物理仿真决策
│   └── scripts/list_adrs.py            # ADR 状态与领域扫描 CLI
│
├── implementation-plans/               # 🚀 【单份维护 · SDD 执行流】实施计划库
│   ├── core/                           # C 内核实施计划 (active / archived)
│   ├── tools/                          # 工具链实施计划 (active / archived)
│   ├── frontend/                       # 前端实施计划 (active / archived)
│   ├── unisim/                         # 仿真引擎实施计划 (active / archived)
│   └── scripts/list_plans.py           # Plan 状态与领域扫描 CLI
│
├── reviews/                            # 🔍 【单份维护 · SDD 验证流】评审与冒烟报告
│   ├── core/                           # C 内核评审与硬件 Smoke 报告
│   ├── tools/                          # 工具链架构评审报告
│   ├── frontend/                       # 前端评审与 Wokwi 对齐报告
│   └── unisim/                         # 仿真引擎评审与 Deep Dive 报告
│
└── scripts/                            # 🛠️ 【自动化治理工具库】
    ├── run_all_checks.py               # 一键运行全量文档检查
    ├── verify_doc_contracts.py         # 黑盒隔离与契约自动扫描
    ├── check_ssot_sync.py              # ADR 闭环回写 SSOT 检查
    ├── check_i18n_sync.py              # zh/ 与 en/ 双语同步覆盖率检查
    ├── lint_i18n_glossary.py           # 术语合规性检查 (基于 glossary.yaml)
    └── doc_link_governance.py          # 全局超链接健康度检查
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
* **一键运行文档与 i18n 全套检查**：
  ```powershell
  python docs/scripts/run_all_checks.py
  ```

### 2. 文档贡献与治理口诀与回写契约

> 📌 **文档治理口诀**：
> **架构改动改 design (SSOT)    │  重大选型开 decisions (ADR)**
> **方案分类进 tech-designs    │  计划结项归 domain archived**
> **中文首发进 zh/design       │  英文同步 en/design**

#### 🔄 SSOT 闭环回写契约 (SSOT Back-write Contract)
为防止架构决策 (ADR) 与技术方案 (Tech-Designs) 随时间演进与 `docs/{zh,en}/design/` (SSOT) 发生漂移，仓库执行以下硬性约束：
1. **ADR / RFC 头部标记**：所有 ADR 与 Tech-Design 的元数据表格中必须包含 `| **回写 SSOT 目标文档** |` 与 `| **SSOT 回写状态** | (Pending / Completed)`。
2. **结项归档闭环**：当 ADR 状态变更为 `Accepted` 或实施计划结项移入 `archived/` 时，作者必须将新架构/契约回写至 `docs/{zh,en}/design/00~07/` 对应文件，并将状态标记为 `Completed`。
3. **自动化比对工具**：可运行 `python docs/scripts/check_ssot_sync.py` 查验是否有未闭环回写 SSOT 的 ADR 项。
