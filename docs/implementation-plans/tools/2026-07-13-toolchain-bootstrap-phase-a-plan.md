# Toolchain Bootstrap Phase A — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship command-front toolchain gating in `wink.py` (`ensure_for`): detect + hint + abort, with `doctor`/`setup`, zero hard-coded machine paths, and ESP-IDF never auto-installed.

**Architecture:** New pure-Python `tools/toolchain/` package (Providers + resolve/config/report). Every subcommand runs `ensure_for` before its handler. Complex SDKs (emsdk/IDF) are detect-only (user must pre-activate); host MinGW/cmake paths are resolved and prepended to process `PATH`.

**Tech Stack:** Python 3.10+, stdlib only for toolchain package; `unittest` (existing tools tests style) or `pytest` if already available; PowerShell for `build_esp32.ps1` / `python wink-tools/wink.py test`.

**Spec:** [2026-07-13-wink-toolchain-bootstrap-design.md](../../superpowers/specs/2026-07-13-wink-toolchain-bootstrap-design.md)

## Global Constraints

Copied from the approved design — every task inherits these:

- **Gate style:** command-front `ensure_for`; not doctor-only.
- **ESP-IDF:** `install()` forever raises `UnsupportedError`; never auto-install.
- **Activation:** phase A does **not** source `emsdk_env.*` or IDF `export.ps1` inside Python for host/wasm; IDF may probe EIM profile in a subprocess for detect+env capture only (§7.2).
- **Collect-all reporting:** never fail on first missing dep only.
- **Version floors:** Python ≥3.10, GCC ≥14 (Win MinGW triplet `w64-mingw32`), CMake ≥3.15, Emscripten ≥3.1.45, IDF `>=6.0,<7.0`.
- **Config priority:** capability env → workspace `.wink/tools.json` → `~/.wink/tools.json` → PATH/well-known.
- **esp32 profile:** Windows-only in phase A; do **not** prepend host gcc/cmake/emsdk to PATH when running esp32.
- **Config schema:** `version` must be `1`; other versions abort.
- **Fact fix:** Emscripten itself can report `6.0.1` (this machine does). Spec §7.1 note that “6.0.1 is only IDF” is wrong — floor stays ≥3.1.45; update `preinstall.md` wording accordingly in the docs task.

## 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260713-TOOLCHAIN-BOOTSTRAP-A` |
| **计划日期** | 2026-07-13 |
| **计划状态** | 📋 草稿（待执行确认） |
| **优先级** | 🔴 P0 |
| **关联设计** | [toolchain bootstrap spec](../../superpowers/specs/2026-07-13-wink-toolchain-bootstrap-design.md) |
| **关联 ADR** | 待写 ADR-0029（command-front gating）、ADR-0030（IDF never auto-install） |
| **前置依赖** | 无 |

---

## File structure (create / modify)

| Path | Role |
|------|------|
| `docs/decisions/tools/0029-toolchain-command-front-gating.md` | ADR: ensure_for |
| `docs/decisions/core/0030-esp-idf-never-auto-installed.md` | ADR: IDF policy |
| `wink-micro-os/tools/toolchain/__init__.py` | Public `ensure_for`, exports |
| `wink-micro-os/tools/toolchain/types.py` | `DetectResult`, `UnsupportedError`, `ReportItem` |
| `wink-micro-os/tools/toolchain/profiles.py` | Profile DAG + workspace deps |
| `wink-micro-os/tools/toolchain/config.py` | Load/save tools.json |
| `wink-micro-os/tools/toolchain/resolve.py` | Path resolution priority |
| `wink-micro-os/tools/toolchain/check.py` | `ensure_for` orchestration |
| `wink-micro-os/tools/toolchain/report.py` | stderr report + exit |
| `wink-micro-os/tools/toolchain/providers/*.py` | Per-capability providers |
| `wink-micro-os/tools/toolchain/platform/base.py`, `win.py` | Hint text helpers |
| `wink-micro-os/tools/toolchain/tools.json.example` | Example config |
| `wink-micro-os/tools/tests/test_toolchain_*.py` | Unit tests |
| `wink-micro-os/tools/wink.py` | Wire CLI + remove WinLibs hardcode |
| `scripts/build_esp32.ps1` | Env-driven IDF; no hard-coded paths |
| `python wink-tools/wink.py test` | PATH-based checks; no hard-coded emsdk/WinLibs |
| `.gitignore` | Add `.wink/` |
| `wink-micro-os/tools/preinstall.md`, `README.md` | Align with providers |
| `docs/design/06-build-toolchain/` | Short backport after ADRs Accepted |

---

### Task 1: Governance ADRs (0029 + 0030)

**Files:**
- Create: `docs/decisions/tools/0029-toolchain-command-front-gating.md`
- Create: `docs/decisions/core/0030-esp-idf-never-auto-installed.md`
- Modify (after Accepted): `docs/design/06-build-toolchain/01-toolchain-deployment.md` — add a short “local wink.py gating” subsection linking both ADRs

**Interfaces:**
- Produces: Accepted ADR policy text that Task 6+ hint strings must quote for IDF (“never auto-installed”)

- [ ] **Step 1: Write ADR-0029** using the same table style as ADR-0001 / ADR-0028. Status **Proposed** → user accepts → flip to **Accepted**. Cover: Context (late cmake failures, hard-coded paths), Options (doctor-only / docker-first / command-front), Decision (command-front `ensure_for`), Consequences (every new subcommand must call it; `--skip-toolchain-check` escape hatch).

- [ ] **Step 2: Write ADR-0030** — forever no IDF auto-install; rationale (size, EIM conflict, drivers, licensing); Consequences (`idf.Provider.install` always `UnsupportedError`; report must state policy).

- [ ] **Step 3: Get user Acceptance** on both ADRs (do not merge Phase A code without this).

- [ ] **Step 4: Backport** one paragraph + links into `docs/design/06-build-toolchain/01-toolchain-deployment.md`.

- [ ] **Step 5: Commit**

```bash
git add docs/decisions/tools/0029-toolchain-command-front-gating.md \
        docs/decisions/core/0030-esp-idf-never-auto-installed.md \
        docs/design/06-build-toolchain/01-toolchain-deployment.md
git commit -m "$(cat <<'EOF'
docs(adr): accept command-front toolchain gating and no IDF auto-install

Record ADR-0029/0030 and backport to 06-build-toolchain living docs.
EOF
)"
```

---

### Task 2: Core types + Provider ABC

**Files:**
- Create: `wink-micro-os/tools/toolchain/types.py`
- Create: `wink-micro-os/tools/toolchain/providers/base.py`
- Create: `wink-micro-os/tools/toolchain/__init__.py` (minimal exports)
- Test: `wink-micro-os/tools/tests/test_toolchain_types.py`

**Interfaces:**
- Produces:
  - `@dataclass DetectResult(found: bool, path: Path | None, version: str | None, reason: str | None, source: str | None)`
  - `class UnsupportedError(Exception)`
  - `class Provider(ABC)` with `id: str`, `detect(ctx) -> DetectResult`, `hint(ctx) -> str`, `install(ctx) -> None` (default raises `UnsupportedError`)
  - `PROBE_TIMEOUT_SEC = 10`

- [ ] **Step 1: Write failing test** asserting `Provider` cannot be instantiated and default `install` raises `UnsupportedError`.

```python
# wink-micro-os/tools/tests/test_toolchain_types.py
import unittest
from pathlib import Path
import sys

SDK = Path(__file__).resolve().parents[1].parent  # wink-micro-os
sys.path.insert(0, str(SDK))

from tools.toolchain.providers.base import Provider  # noqa: E402
from tools.toolchain.types import DetectResult, UnsupportedError  # noqa: E402


class FakeCtx:
    pass


class TestProviderContract(unittest.TestCase):
    def test_install_default_unsupported(self):
        class P(Provider):
            id = "fake"
            def detect(self, ctx):
                return DetectResult(False, None, None, "x", None)
            def hint(self, ctx):
                return "hint"

        with self.assertRaises(UnsupportedError):
            P().install(FakeCtx())


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test — expect FAIL** (import error)

```powershell
$env:PYTHONPATH = "wink-micro-os"
python wink-micro-os/tools/tests/test_toolchain_types.py -v
```

- [ ] **Step 3: Implement `types.py` + `providers/base.py` + empty `__init__.py`**

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit** `feat(toolchain): add Provider ABC and DetectResult types`

---

### Task 3: Config load/save + schema version

**Files:**
- Create: `wink-micro-os/tools/toolchain/config.py`
- Test: `wink-micro-os/tools/tests/test_toolchain_config.py`

**Interfaces:**
- Consumes: none beyond stdlib
- Produces:
  - `load_tools_config(workspace_root: Path | None) -> ToolsConfig`
  - `ToolsConfig.version: int`, `.tools_home: Path | None`, `.paths: dict[str, str | None]`
  - `save_user_path(key: str, value: str) -> Path` / `save_workspace_path(workspace_root: Path, key: str, value: str) -> Path` (merge, create `version:1`)
  - `UnsupportedToolsJsonVersionError` when `version != 1`
  - User file: `Path.home() / ".wink" / "tools.json"`
  - Workspace file: `workspace_root / ".wink" / "tools.json"`

- [ ] **Step 1: Failing tests** — missing files → empty config; `version:2` raises; merge `--set` keeps unrelated keys.

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `config.py`** (JSON read/write, UTF-8, create parent dirs)

- [ ] **Step 4: Run — PASS**

- [ ] **Step 5: Commit** `feat(toolchain): add tools.json config load/save`

---

### Task 4: Resolve priority + profiles DAG

**Files:**
- Create: `wink-micro-os/tools/toolchain/resolve.py`
- Create: `wink-micro-os/tools/toolchain/profiles.py`
- Test: `wink-micro-os/tools/tests/test_toolchain_resolve.py`
- Test: `wink-micro-os/tools/tests/test_toolchain_profiles.py`

**Interfaces:**
- Produces:
  - `PROFILES`, `WORKSPACE_DEPS`, `OPTIONAL_CAPS` exactly as design §5.2
  - `expand_profile(name: str) -> list[str]` (deduped, codegen before host deps)
  - `ResolveContext` holding env snapshot, configs, workspace root, os name
  - `candidate_paths(cap_id: str, ctx: ResolveContext) -> list[tuple[str, Path]]` ordered by priority with source tags (`env:EMSDK`, `config:workspace`, `config:user`, `path`)

Env map (design §6.2): `WINK_GCC_PREFIX`→gcc, `EMSDK`→emsdk, `IDF_PATH`→idf, `WINK_PYTHON`→python, `WINK_TOOLS_HOME`→tools_home.

- [ ] **Step 1: Tests** — env beats workspace beats user; `expand_profile("wasm")` includes python once; `esp32` does not include `gcc`.

- [ ] **Step 2–4: Implement + green**

- [ ] **Step 5: Commit** `feat(toolchain): add profile DAG and path resolve priority`

---

### Task 5: Report renderer (collect-all)

**Files:**
- Create: `wink-micro-os/tools/toolchain/report.py`
- Test: `wink-micro-os/tools/tests/test_toolchain_report.py`

**Interfaces:**
- Produces:
  - `@dataclass ReportItem(kind: Literal["required_tool","required_workspace","optional"], id: str, ...)`
  - `render_report(items: list[ReportItem], file=sys.stderr) -> str`
  - Must include IDF never-auto-install sentence when any item id is `idf` or summary note always for esp32 failures (design §8.2)
  - `exit_for_report(items) -> NoReturn` → `sys.exit(1)` if any required failure else `sys.exit(0)` for doctor all-green

- [ ] **Step 1: Test** fixture with 2 required + 1 optional → output contains both `✗` lines and `!` warning; summary `2 errors, 1 warning`.

- [ ] **Step 2–4: Implement + green**

- [ ] **Step 5: Commit** `feat(toolchain): add collect-all missing-dep report`

---

### Task 6: Providers — python, jinja2, cmake, make, gcc

**Files:**
- Create: `providers/python_pkgs.py` (jinja2), `cmake.py`, `make.py`, `gcc.py`, and python capability in `python_pkgs.py` or `python_.py` named `python.py` carefully — use `python_interp.py` to avoid stdlib clash
- Create: `platform/base.py`, `platform/win.py` (hint strings only)
- Test: `test_toolchain_providers_host.py` with mocked `subprocess.run` / `shutil.which`

**Interfaces:**
- Each provider registered in `providers/__init__.py` as `REGISTRY: dict[str, Provider]`
- `gcc` on Windows: reject triplets without `w64-mingw32`
- `make`: `mingw32-make` on win; `make` then `gmake` on posix
- Floors: parse versions; fail with reason if below floor

- [ ] **Step 1: Write version-parse + triplet rejection tests with fixtures** (no real gcc required)

- [ ] **Step 2–4: Implement providers + green**

- [ ] **Step 5: Commit** `feat(toolchain): add host capability providers`

---

### Task 7: Providers — emsdk, idf, node, powershell

**Files:**
- Create: `providers/emsdk.py`, `idf.py`, `node.py`, `powershell.py`
- Test: `test_toolchain_providers_sdk.py`

**Interfaces:**
- `emsdk.detect`: PASS only if `EMSDK` set **and** `emcc`/`emcmake` `--version` succeed in current env; else FAIL with activate hint (do not source scripts)
- `idf.detect`: steps per design §7.2 (PATH idf.py → EIM profile subprocess capture → IDF_PATH alone fail reason → not found). **Do not hardcode** cmake/ninja/xtensa versioned paths.
- `idf.install`: always `raise UnsupportedError("ESP-IDF is never auto-installed by Wink. ...")`
- `powershell`: Windows System32 `powershell.exe`; non-Windows fail for esp32
- Version: emsdk ≥3.1.45; idf `>=6.0,<7.0`

- [ ] **Step 1: Tests** mock subprocess; assert `idf.install` message contains `never auto-installed`; hanging binary → timeout ≤12s

- [ ] **Step 2–4: Implement + green**

- [ ] **Step 5: Commit** `feat(toolchain): add emsdk/idf/node/powershell providers`

---

### Task 8: `ensure_for` orchestration + env injection

**Files:**
- Create: `wink-micro-os/tools/toolchain/check.py`
- Modify: `wink-micro-os/tools/toolchain/__init__.py` to export `ensure_for`
- Test: `test_toolchain_ensure.py`

**Interfaces:**
- Produces:
  ```python
  def ensure_for(
      command: str,
      *,
      workspace_root: Path,
      resolve_workspace_paths: Callable[..., dict[str, Path | None]],
      skip: bool = False,
  ) -> None:
      """Probe profile; inject env; or render report and sys.exit(1)."""
  ```
- Profile → env matrix exactly design §9.1 (esp32 must NOT prepend host gcc/cmake/emsdk)
- Workspace path failures go to `required_workspace` report section via existing resolve callbacks
- In-process probe cache keyed by capability id

- [ ] **Step 1: Tests** — missing cmake mocked → `SystemExit(1)` and report mentions cmake; esp32 injection env keys assert no WinLibs prepend; optional emsdk missing on `test` → warning only (no exit)

- [ ] **Step 2–4: Implement + green**

- [ ] **Step 5: Commit** `feat(toolchain): implement ensure_for gating and profile env injection`

---

### Task 9: Wire `wink.py` CLI (`doctor`, `setup`, `--skip-toolchain-check`)

**Files:**
- Modify: `wink-micro-os/tools/wink.py`
- Test: `test_toolchain_cli.py` (subprocess invoking wink.py with mocked PATH if feasible; or import handlers)

**Interfaces:**
- Delete WinLibs hardcode block (current lines 25–28)
- After `parse_args`, before `args.handler`:
  - if `--skip-toolchain-check`: print prominent stderr warning
  - else `ensure_for(...)` for commands that need it (`doctor`/`setup` have special behavior)
- Add subparsers `doctor`, `setup`
- `setup` no-args: print resolved table (design §10.3)
- `setup --set key=value` [--workspace]: validate via provider detect before write (design §10.2)
- `setup --install`: print phase-B message + `hint()`

- [ ] **Step 1: Manual checklist test script** documented in plan run section

```powershell
$env:PYTHONPATH = "wink-micro-os"
python wink-micro-os/tools/wink.py doctor
python wink-micro-os/tools/wink.py setup
# Expect: no WinLibs hardcode; doctor shows table
```

- [ ] **Step 2: Implement wiring**

- [ ] **Step 3: Run unit CLI tests + doctor on developer machine**

- [ ] **Step 4: Commit** `feat(wink): gate subcommands with ensure_for; add doctor/setup`

---

### Task 10: Refactor `scripts/build_esp32.ps1`

**Files:**
- Modify: `scripts/build_esp32.ps1`

**Interfaces:**
- Keep: strip MSYS/MINGW/EMSDK; `PYTHONUTF8`/`PYTHONIOENCODING`; `idf.py -C esp32_firmware`
- Remove: all absolute Espressif/IDF path hardcodes and rebuilt mega-PATH
- New logic:
  1. If `IDF_PATH` / `IDF_TOOLS_PATH` already set (from wink.py) → use them
  2. Else if EIM profile `C:\Espressif\tools\Microsoft.v6*.PowerShell_profile.ps1` exists → dot-source it
  3. Else if `IDF_PATH` set → `. "$env:IDF_PATH\export.ps1"`
  4. Else write error pointing to `wink doctor` / preinstall.md and `exit 1`

- [ ] **Step 1: Diff review** — zero absolute paths remain (`Select-String` for `C:\Espressif` versioned tool dirs should only appear as EIM profile glob discovery, not pinned cmake/ninja/xtensa versions)

- [ ] **Step 2: Implement**

- [ ] **Step 3: Smoke** (on machine with IDF):

```powershell
python wink-micro-os/tools/wink.py esp32 --app wink-micro-app/devkitc_smoke build
```

- [ ] **Step 4: Commit** `refactor(esp32): make build_esp32.ps1 env/EIM driven`

---

### Task 11: Refactor `python wink-tools/wink.py test`

**Files:**
- Modify: `python wink-tools/wink.py test`

**Interfaces:**
- Remove WinLibs absolute prepend
- Remove default `D:\software\embedded\emsdk`
- Host: require `gcc`/`cmake` on PATH; on failure print “run `python tools/wink.py doctor`”
- `-WithWasm`: require `emcc` on PATH; else FAIL that pass with activate message (no hardcoded fallback)

- [ ] **Step 1–3: Implement + run `python wink-tools/wink.py test` (without -WithWasm) green**

- [ ] **Step 4: Commit** `refactor(test): remove hardcoded toolchain paths from python wink-tools/wink.py test`

---

### Task 12: Packaging, gitignore, docs alignment

**Files:**
- Modify: `.gitignore` — add `.wink/`
- Create: `wink-micro-os/tools/toolchain/tools.json.example`
- Verify: `pack_sdk_source.py` already packs entire `tools/` → no change if `toolchain/` is under `tools/`; add a unit/assert in pack test or a one-line comment in pack script README if needed
- Modify: `wink-micro-os/tools/preinstall.md` — fix Emscripten version wording (floor ≥3.1.45; note current line may be 3.x/4.x/**6.x**); align env var names with providers; document `doctor`/`setup`
- Modify: `wink-micro-os/tools/README.md` — link preinstall + doctor/setup
- Modify: design spec Status → Accepted (or “Accepted for Phase A”)

- [ ] **Step 1: Implement docs + gitignore + example json**

- [ ] **Step 2: Verify**

```powershell
python wink-micro-os/tools/pack_sdk_source.py --out-dir wink-micro-os/dist
# tar -tzf ... | Select-String toolchain
```

- [ ] **Step 3: Commit** `docs(tools): document toolchain bootstrap; ignore .wink/`

---

### Task 13: Integration acceptance

**Files:** none new

- [ ] **Step 1: Negative gate**

```powershell
# Temporarily rename cmake on PATH or use a clean env without cmake
python wink-micro-os/tools/wink.py build host --app wink-micro-app/avoidance_car
# Expect: exit 1, report lists cmake, does not start cmake configure
```

- [ ] **Step 2: Positive host** (normal env): `build host` reaches cmake and succeeds for a sample app

- [ ] **Step 3: Wasm** (activated emsdk shell): `build wasm` works; without activation: clear activate message

- [ ] **Step 4: Esp32** (Windows + IDF): `esp32 … build` works; PATH must not prefer host MinGW over IDF tools

- [ ] **Step 5: Full toolchain unit suite**

```powershell
$env:PYTHONPATH = "wink-micro-os"
python -m unittest discover -s wink-micro-os/tools/tests -p "test_toolchain*.py" -v
```

- [ ] **Step 6: Final commit** only if fixes were needed; else mark plan ✅

---

## Spec coverage checklist (self-review)

| Spec section | Task |
|--------------|------|
| §4 architecture package | 2–8 |
| §4.2 doctor/setup/skip | 9 |
| §5 profiles/workspace split | 4, 8 |
| §5.3 macOS/Linux host providers | 6 (posix make/gcc); esp32 Windows-only in 7 |
| §6 config | 3 |
| §7 providers | 6–7 |
| §8 report | 5 |
| §9 env injection | 8 |
| §10 setup semantics | 9 |
| §12 script refactors | 10–11 |
| §13 tests | embedded in 2–8, 13 |
| §14 SDK pack | 12 |
| §15 IDF policy | 1, 7 |
| §16 Phase A list | all |
| §17 ADRs | 1 |

## Out of scope (do not implement in this plan)

- Phase B `--install` / winget / emsdk clone
- `doctor --format json`
- `wink toolchain env` shell snippets
- Non-Windows `esp32` builds

---

## Execution handoff

Plan saved to `docs/implementation-plans/tools/2026-07-13-toolchain-bootstrap-phase-a-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — same session with executing-plans checkpoints  

Which approach?

