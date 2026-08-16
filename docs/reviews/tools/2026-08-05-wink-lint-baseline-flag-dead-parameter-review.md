# 2026-08-05 `wink lint --baseline` 死参数评审与修复方案

| 项 | 内容 |
|----|------|
| 评审对象 | `python wink-tools/wink.py lint --baseline <file>` 参数：CLI 已注册但从未生效 |
| 评审日期 | 2026-08-05 |
| 触发来源 | 评审 ADR-0057 前置计划 `00.5-pal-adc-subsystem-plan.md` 时，按"不把未验证能力当既成事实"原则对 `--baseline` 做闭环实测 |
| 评审方法 | ① `--help` 核对参数；② 生成 JSON baseline 并检查结构；③ 带/不带 `--baseline` 对比输出与退出码；④ 反向 grep + 读源码定位未接线点；⑤ 给出最小修复与测试方案 |
| 影响范围 | `wink-tools/tools/cli/commands/lint.py`（参数注册）、`wink-tools/tools/lint/cli.py`（handle 主流程）、`wink-tools/tools/lint/engine/models.py`（fingerprint 已就绪）；以及所有把 `--baseline` 当防线写进文档/计划的地方 |
| 严重度 | **中**：功能缺失但不崩溃；危险在于给人"已冻结存量债务、CI 只拦新增"的虚假安全感，实际 CI 仍会因历史 error 失败或被人手动放行 |
| 结论 | 根因明确（参数注册了但 `handle_lint` 从不读取）；数据层已就绪（`Finding.fingerprint` 已计算并随 JSON 输出）；修复为约 40–60 行纯函数叠加，零架构风险，建议实现 |

---

## 1. 背景与问题

### 1.1 为什么需要 baseline

仓库当前存在历史 lint 债务（master 执行计划 §3 提到 `--pack dal` 约 114 个 error，部分规则疑似过宽待裁定）。团队希望：

> 先把**当前存量** finding 固化为一份"基线文件"，之后 CI 与本地开发用 `--baseline` 只报告基线之外的**新增**问题，从而在不被历史债阻塞的前提下，机械保证"新增代码零 lint error"。

这是 eslint/ruff/mypy 等工具的标准 baseline 模式，本身设计诉求合理。

### 1.2 实测现象

按直觉跑闭环：

```bash
# 1) 生成基线
python wink-tools/wink.py lint --pack layering --format json --output b.json

# 2) 带基线再跑——期望：已知 finding 被过滤，只剩新增
python wink-tools/wink.py lint --pack layering --baseline b.json
```

实测结果（2026-08-05）：

| 检查项 | 结果 |
|---|---|
| `--help` 列出 `--baseline BASELINE` | ✅ 存在 |
| `--format json --output b.json` 写出文件 | ✅ 可用，内容是 finding 列表，每项含 `fingerprint` |
| 带 `--baseline b.json` 后已知 finding 被过滤 | ❌ **完全没有过滤**，3 条原样报出 |
| 退出码因基线而改变 | ❌ 无变化 |
| 整个 lint 引擎 `grep -r baseline` | ❌ **零匹配**（仅 CLI 参数解析处出现） |

即：参数"看得见"，但"不干活"。

---

## 2. 根因分析

### 2.1 参数已注册，但处理链未接线

`wink-tools/tools/cli/commands/lint.py:31`：

```python
parser.add_argument("--baseline", default=None,
                    help="Optional baseline file for fingerprint diff")
```

但真正的处理函数 `wink-tools/tools/lint/cli.py::handle_lint` 的流水线是：

```text
findings = run_lint(root, cfg, packs=..., paths=..., today=..., strict=...)
  → --rule 过滤            (cli.py:52)
  → --report-allowlist 过滤 (cli.py:56)
  → format_text/json/sarif (cli.py:64)
  → exit_code_for(findings) (cli.py:80)  ← 退出码用的还是同一个 findings
```

通读 `handle_lint` 全文，**没有任何一处读取 `getattr(args, "baseline", None)`**。参数被 argparse 解析后就被丢弃，既不加载文件，也不做差集，也不影响退出码。

### 2.2 数据层其实已经准备好

这不是"从 0 到 1"的缺失，而是"差最后一公里"：

- `engine/models.py:16-21` 已实现 `_compute_fingerprint`：
  ```text
  fingerprint = sha1(f"{rule_id}|{path}|{line}|{normalize(snippet)}")
  ```
- `Finding.__post_init__`（`models.py:39-45`）在未显式传入时自动计算 fingerprint；
- `engine/report.py:_finding_to_dict` 已把 `fingerprint` 写进 JSON 输出。

也就是说，**生成基线所需的全部数据都已经落到了 `b.json` 里**，只差"读回 fingerprint 集合并做差集"这一步。

### 2.3 为什么这种 bug 能长期存在

- `--baseline` 是可选参数，不传时行为完全正常，不影响任何现有用例；
- 没有针对它的测试（`wink-tools/tools/tests/` 下无 baseline 相关用例），CI 不覆盖；
- `--help` 文本让它"看起来能用"，使用者若不做闭环对比很难发现无效。

这是典型的"接口承诺 ≠ 实现"的死参数问题，且属于**静默失败**类——不报错、不崩溃，最危险。

---

## 3. 修复方案

### 3.1 设计目标与语义

对齐主流 lint baseline 语义：

1. 基线文件就是一次 `--format json` 的产物（**不另造格式**），loader 读其中的 `fingerprint` 集合；
2. 带 `--baseline` 时，**基线内的 finding 既不显示、也不导致非零退出**；只有基线之外的新增 finding 显示并使退出码非零；
3. 过�| 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 过滤作用域 | **同时影响显示和退出码** | 否则"看不见但仍失败"，违背 baseline 初衷 |
| 2 | 基线文件格式 | **直接吃 `--format json` 输出**（list-of-dict，取 `fingerprint`） | 零额外生成步骤；天然工作流；同时容忍 list-of-string |
| 3 | 重新生成基线时带 `--baseline --output 同一文件` | **报错拒绝**（§3.3 守卫） | 否则过滤后写回会让基线持续缩水（经典坑）；文档同时注明"更新基线勿带 --baseline" |
| 4 | 指纹含 line+snippet，代码位移会"重新报出"旧债 | **接受，文档说明**（P1 预留双重指纹） | 与 eslint baseline 行为一致；动过的代码本就该重新审视。P1 可拓展 `sha1(rule_id\|path\|snippet)` 模糊指纹 |
| 5 | 与 allowlist 关系 | **互补、不特殊处理** | allowlist=带 reason/until 的定向豁免；baseline=批量冻结存量；同时命中都抑制，互不干扰 |
| 6 | 已修复债务在基线里留"僵尸指纹" | **不做 prune** | 匹配不上即静默躺着，无害；想清理就重跑一次全量基线（YAGNI） |
| 7 | **[新] JSON 写盘确定性** | **按 `(path, line, rule_id, fp)` 严格升序** | 避免多开发者在不同环境生成 JSON 时因 Python dict/数组顺序不一致造成 Git 冲突 |
| 8 | **[新] 跨平台与 CWD 锚定** | **强转为 Repo-Root 相对 POSIX 路径** | 消除 Windows `\` 与 Linux `/` 指纹差异，避免在不同子目录下执行 CLI 产生路径错位 |

### 3.5 架构师补充方案（P0/P1 演进设计）

1. **Repo-Root 路径归一化（P0）**：
   `tools/lint/engine/baseline.py` 中解析路径时，强制转化为相对于 Repo 根目录（自动寻找 `.git` 或 `wink-tools`）的 POSIX 路径（`Path(p).resolve().relative_to(repo_root).as_posix()`），确保跨平台、跨工作目录（CWD）绝对兼容。
2. **确定性 JSON 序列化（P0）**：
   写盘 JSON 或读取基线时，Finding 列表强制执行字典序排序：
   ```python
   sorted_findings = sorted(findings, key=lambda f: (f.path, f.line, f.rule_id, f.fingerprint))
   ```
3. **模糊双重指纹预留（P1 Roadmap）**：
   未来引入 `fuzzy_fingerprint = sha1(f"{rule_id}|{path}|{normalize(snippet)}")`，当绝对指纹未命中但模糊指纹唯一匹配时自动抑制，抵抗 C 源码头部插入 `#include` 导致的行号偏移。
4. **债务防腐齿轮机制 Ratchet Policy（P1 Roadmap）**：
   在 CI 门禁中支持 `--ratchet` 参数，比对 `suppressed_count` 与基线条目数，基线债务只许减少不许增加，防止基线沦为垃圾堆。

### 3.6 测试方案

**单元测试**（`test_lint_baseline.py`，直接调纯函数）：
- `subtract_baseline`：命中指纹被剔除、未命中保留、空 baseline 原样返回；
- `load_baseline_fingerprints`：读标准 list-of-dict 拿到 fingerprint 集合；读 list-of-string 也可；坏 JSON / 缺字段给出清晰错误；
- 跨平台与路径归一化：path 用 POSIX 形式，构造的 Finding 在 Windows/Linux 及不同 CWD 下指纹完全一致。

**CLI 集成测试**（参照 `test_lint_cli.py::TestLintCliSmoke` 的 subprocess 模式）：
1. 对一个含已知 finding 的 pack 跑 `--format json --output b.json`；
2. 再跑 `--baseline b.json`，断言该已知 finding 不再出现在 stdout、退出码为 0；
3. 构造一个不在基线内的新 finding（或临时加一个违规文件），断言它仍被报出、退出码为 1；
4. `--baseline b.json --output b.json` 断言退出码 2 并拒绝覆写。

---

## 4. 修复后的标准工作流

```bash
# 固化当前存量债务（注意：不带 --baseline）
python wink-tools/wink.py lint \
    --pack layering --pack api --pack drivers --pack dal --pack abi --pack user_surface \
    --format json --output lint-baseline.json

# 日常 / CI：只拦新增（基线内的存量问题被静默）
python wink-tools/wink.py lint \
    --pack layering --pack api --pack drivers --pack dal --pack abi --pack user_surface \
    --baseline lint-baseline.json

# 债务清理后刷新基线（同样不带 --baseline，全量重写）
python wink-tools/wink.py lint ... --format json --output lint-baseline.json
```

---

## 5. 不在本次范围

- **不做** baseline 自动 prune / sync / 过期管理（通过全量重刷覆盖）；
- **不做** baseline 与 allowlist 合并（二者语义不同，保持正交）；
- **不**改任何 C 代码、ADR-0057 或外设计划本身——这是纯工具修复。
- 工具修复并合入后，再把 `00.5-pal-adc-subsystem-plan.md` T11 从"`--baseline` 不可用"改回"用 baseline 冻结存量"，并同步 master 执行计划 §3。

---

## 6. 验收标准

- [ ] `--baseline f.json` 真正过滤掉基线内 finding，且退出码随之改变（新增=1，无新增=0）；
- [ ] 过滤同时作用于 text/json/sarif 三种格式；
- [ ] `--baseline` 与 `--output` 同一文件时退出码 2 并给出明确提示；
- [ ] stderr 有 suppressed 计数（可观测）；
- [ ] 基线 JSON 写盘满足确定性排序（按 `path -> line -> rule_id -> fp`）与 POSIX 路径归一化；
- [ ] 新增单元测试 + CLI 集成测试覆盖 §3.6 全部场景，全绿；
- [ ] `--help` 文案注明指纹漂移与"更新基线勿带 --baseline"；
- [ ] 不引入对 Finding 模型 / runner / checker 的改动。
 六个语义决策（避免做成半吊子）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 1 | 过滤作用域 | **同时影响显示和退出码** | 否则"看不见但仍失败"，违背 baseline 初衷 |
| 2 | 基线文件格式 | **直接吃 `--format json` 输出**（list-of-dict，取 `fingerprint`） | 零额外生成步骤；天然工作流；同时容忍 list-of-string |
| 3 | 重新生成基线时带 `--baseline --output 同一文件` | **报错拒绝**（§3.3 守卫） | 否则过滤后写回会让基线持续缩水（经典坑）；文档同时注明"更新基线勿带 --baseline" |
| 4 | 指纹含 line+snippet，代码位移会"重新报出"旧债 | **接受，文档说明** | 与 eslint baseline 行为一致；动过的代码本就该重新审视。暂不做"去行号稳定指纹"（YAGNI） |
| 5 | 与 allowlist 关系 | **互补、不特殊处理** | allowlist=带 reason/until 的定向豁免；baseline=批量冻结存量；同时命中都抑制，互不干扰 |
| 6 | 已修复债务在基线里留"僵尸指纹" | **不做 prune** | 匹配不上即静默躺着，无害；想清理就重跑一次全量基线（YAGNI） |

### 3.5 测试方案

**单元测试**（`test_lint_baseline.py`，直接调纯函数）：
- `subtract_baseline`：命中指纹被剔除、未命中保留、空 baseline 原样返回；
- `load_baseline_fingerprints`：读标准 list-of-dict 拿到 fingerprint 集合；读 list-of-string 也可；坏 JSON / 缺字段给出清晰错误；
- 跨平台：path 用 posix 形式，构造的 Finding 在 Windows/Linux 指纹一致。

**CLI 集成测试**（参照 `test_lint_cli.py::TestLintCliSmoke` 的 subprocess 模式）：
1. 对一个含已知 finding 的 pack 跑 `--format json --output b.json`；
2. 再跑 `--baseline b.json`，断言该已知 finding 不再出现在 stdout、退出码为 0；
3. 构造一个不在基线内的新 finding（或临时加一个违规文件），断言它仍被报出、退出码为 1；
4. `--baseline b.json --output b.json` 断言退出码 2 并拒绝覆写。

---

## 4. 修复后的标准工作流

```bash
# 固化当前存量债务（注意：不带 --baseline）
python wink-tools/wink.py lint \
    --pack layering --pack api --pack drivers --pack dal --pack abi --pack user_surface \
    --format json --output lint-baseline.json

# 日常 / CI：只拦新增（基线内的存量问题被静默）
python wink-tools/wink.py lint \
    --pack layering --pack api --pack drivers --pack dal --pack abi --pack user_surface \
    --baseline lint-baseline.json

# 债务清理后刷新基线（同样不带 --baseline，全量重写）
python wink-tools/wink.py lint ... --format json --output lint-baseline.json
```

---

## 5. 不在本次范围

- **不做**"按 rule+path、忽略行号"的稳定指纹（等真有大量位移噪音再评估）；
- **不做** baseline 自动 prune / sync / 过期管理；
- **不做** baseline 与 allowlist 合并（二者语义不同，保持正交）；
- **不**改任何 C 代码、ADR-0057 或外设计划本身——这是纯工具修复。
- 工具修复并合入后，再把 `00.5-pal-adc-subsystem-plan.md` T11 从"`--baseline` 不可用"改回"用 baseline 冻结存量"，并同步 master 执行计划 §3。

---

## 6. 验收标准

- [ ] `--baseline f.json` 真正过滤掉基线内 finding，且退出码随之改变（新增=1，无新增=0）；
- [ ] 过滤同时作用于 text/json/sarif 三种格式；
- [ ] `--baseline` 与 `--output` 同一文件时退出码 2 并给出明确提示；
- [ ] stderr 有 suppressed 计数（可观测）；
- [ ] 新增单元测试 + CLI 集成测试覆盖 §3.5 全部场景，全绿；
- [ ] `--help` 文案注明指纹漂移与"更新基线勿带 --baseline"；
- [ ] 不引入对 Finding 模型 / runner / checker 的改动。
