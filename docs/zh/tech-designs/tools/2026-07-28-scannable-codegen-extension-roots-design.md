# 可扫描代码生成扩展根目录设计

| 项 | 内容 |
|---|---|
| **状态** | **Accepted** |
| **关联 ADR** | ADR-0046、ADR-0051 |

定义驱动机读描述文件（`drivers/*.yaml` 与 `roles/*.yaml`）的多级扫描与优先级覆盖机制（Builtin → OS → Env → App）。
