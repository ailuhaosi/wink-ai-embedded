# ESP32 Build Scripts → Python Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `generate_app_sources.ps1` and `build_esp32.ps1` into `wink-micro-os/tools/esp32/` as pure-Python (with a thin OS-specific activation helper), so `wink.py esp32` and IDF CMake configure no longer depend on PowerShell for business logic.

**Architecture:** New SDK-owned package `tools/esp32/` sits beside `codegen/` and `toolchain/`. Phase 1 ports source scanning; Phase 2 ports IDF runner + activation; Phase 3 deletes/thin-wraps `.ps1`, drops `scripts_dir` workspace dep for esp32, and updates docs/skills. Windows may still invoke `powershell` **only** to source an EIM profile and harvest env — never for scanning or argument plumbing.

**Tech Stack:** Python 3.10+ (stdlib), existing `tools.toolchain` providers for IDF discovery, CMake `execute_process` + `Python3_EXECUTABLE`, ESP-IDF `idf.py`.

**Related:** [toolchain bootstrap design](../../superpowers/specs/2026-07-13-wink-toolchain-bootstrap-design.md), ADR-0029 / ADR-0030, [preinstall.md](../../../../wink-tools/preinstall.md)

## Global Constraints

- **Do not auto-install ESP-IDF** (ADR-0030).
- **ESP32 still needs a real IDF shell** before `idf.py build` (reject bare `idf-exe` shim / `v1.0.3` banner — already fixed in `build_esp32.ps1`; preserve in Python port).
- **Prefer in-tree Source SDK** for esp32 (already in `wink.py`); Binary SDK without `targets/esp32` must fail clearly.
- **Scan rules must match current PS1 behavior:** recurse `*.c` under AppDir; exclude `test_*.c`; exclude BAL-migrated helper names from `samples/common`; emit `${CMAKE_CURRENT_LIST_DIR}/../../…` relative paths when under repo root.
- **App locations:** prefer `WINK_APP_DIR` / `wink-micro-app/<name>`; legacy `wink-micro-os/samples/<name>` only as fallback if still present.
- **Packaging:** `tools/esp32/` must ship in Source SDK tarball (already covered by packing entire `tools/`); verify Binary SDK also includes it if Binary consumers ever need esp32 helpers (Source is required for esp32 builds).
- **Progressive:** each phase must leave the tree buildable; no big-bang delete of `.ps1` until Phase 3.
- **UTF-8:** keep `PYTHONUTF8=1` / `PYTHONIOENCODING=utf-8` on Windows for IDF.

## 元数据

| 字段 | 内容 |
|------|------|
| **计划编号** | `PLAN-20260713-ESP32-TOOLS-PY` |
| **计划日期** | 2026-07-13 |
| **计划状态** | ✅ 已完成（2026-07-13） |
| **优先级** | 🟡 P1（解锁 macOS/Linux esp32 编排；Windows 体验也更稳） |
| **前置依赖** | Phase A toolchain bootstrap（已落地） |
| **目标目录** | `wink-micro-os/tools/esp32/` |

---

## Target layout

```text
wink-micro-os/tools/
  esp32/
    __init__.py
    generate_app_sources.py   # Phase 1
    activate.py               # Phase 2 (Win EIM / Posix export.sh)
    build.py                  # Phase 2 (strip env + idf.py)
  wink.py                     # call tools.esp32.* instead of .ps1
esp32_firmware/
  generate_app_sources.ps1    # Phase 1: thin shim → Python; Phase 3: delete or stub
  main/CMakeLists.txt         # Phase 1: execute_process → Python3
scripts/
  build_esp32.ps1             # Phase 2: thin shim → Python; Phase 3: delete
```

---

## Phase 1 — Migrate `generate_app_sources` (low risk)

**Outcome:** Scanning + `app_sources.cmake` generation is Python; CMake and `wink.py` both call it; `.ps1` becomes a 3-line shim (or CMake stops calling PS entirely).

### Task 1.1: Python scanner module + unit tests

**Files:**
- Create: `wink-micro-os/tools/esp32/__init__.py`
- Create: `wink-micro-os/tools/esp32/generate_app_sources.py`
- Create: `wink-micro-os/tools/tests/test_esp32_generate_app_sources.py`

**Interfaces:**
```python
def generate(
    *,
    app_dir: Path | None = None,
    app_name: str | None = None,
    esp32_firmware_dir: Path,
    repo_root: Path | None = None,
) -> Path:
    """Write esp32_firmware/main/app_sources.cmake; return its path."""

def main(argv: list[str] | None = None) -> int: ...
```

CLI (argparse), compatible with current PS1 flags:

```text
python -m tools.esp32.generate_app_sources --app-dir PATH
python -m tools.esp32.generate_app_sources --app-name devkitc_smoke
```

Behavior to preserve from `esp32_firmware/generate_app_sources.ps1`:

1. Resolve `app_dir` from `--app-dir` or `--app-name` (default `devkitc_smoke`).
2. Collect recursive `*.c` under app_dir, exclude `test_*.c`.
3. Optionally include `wink-micro-os/samples/common/src/*.c` minus BAL-migrated names (`wink_blink_helper.c`, `wink_button_helper.c`, `wink_telemetry_helper.c`, … — copy exact list from current PS1).
4. Prefer paths of form ``${CMAKE_CURRENT_LIST_DIR}/../../<rel-from-repo-root>`` when files are under `repo_root`; else absolute POSIX-style paths.
5. Write `main/app_sources.cmake` with `WINK_APP_NAME`, `WINK_APP_DIR`, `WINK_APP_SOURCES`, and any common-include vars the PS1 already emits.
6. Print a short success summary (App name + file count) to stdout; non-zero exit on missing app dir.

- [ ] **Step 1: Write failing tests** with a temp fake app dir (2 `.c` + 1 `test_foo.c`) and assert output cmake lists the two sources, not the test file; assert BAL names filtered if present under common.

- [ ] **Step 2: Run** `$env:PYTHONPATH="wink-micro-os"; python -m unittest tools.tests.test_esp32_generate_app_sources -v` → FAIL

- [ ] **Step 3: Implement `generate_app_sources.py`** by porting PS1 logic literally (do not “improve” path rules in the same PR).

- [ ] **Step 4: Run tests → PASS; golden check** against a real app:

```powershell
$env:PYTHONPATH = "wink-micro-os"
python -m tools.esp32.generate_app_sources --app-dir (Resolve-Path wink-micro-app/devkitc_smoke)
# Compare main/app_sources.cmake to previous PS1 output (same SOURCES set)
```

- [ ] **Step 5: Commit** `feat(tools): add Python esp32 generate_app_sources`

### Task 1.2: Wire CMake + wink.py + thin PS1 shim

**Files:**
- Modify: `esp32_firmware/main/CMakeLists.txt` (replace powershell `execute_process`)
- Modify: `wink-micro-os/tools/wink.py` `handle_esp32` (call Python module)
- Modify: `esp32_firmware/generate_app_sources.ps1` → thin wrapper that invokes Python (compat for docs/skills)
- Modify: comment headers in `main/CMakeLists.txt` that still say `.ps1`

**CMake sketch** (use env/`WINK_SDK_PATH` already set by firmware CMake):

```cmake
# Prefer Python3 from IDF env; fall back to `python` on PATH.
find_package(Python3 COMPONENTS Interpreter)  # may already be available later; if not:
# use $ENV{IDF_PYTHON_ENV_PATH}/Scripts/python.exe on Windows when set
set(_WINK_GEN "${WINK_SDK_PATH}/tools/esp32/generate_app_sources.py")
execute_process(
  COMMAND "${Python3_EXECUTABLE}" "${_WINK_GEN}"
          --app-dir "${WINK_APP_DIR}"   # or --app-name
          --esp32-firmware-dir "${COMPONENT_DIR}/.."
  WORKING_DIRECTORY "${COMPONENT_DIR}/.."
  RESULT_VARIABLE GEN_SCRIPT_RESULT
)
```

**PYTHONPATH:** set `ENV{PYTHONPATH}` to `${WINK_SDK_PATH}` for the `execute_process` if using `-m tools.esp32…`, **or** invoke the `.py` file by absolute path (simpler for CMake — recommended in Phase 1).

**wink.py:**

```python
run_cmd([sys.executable, str(sdk_dir / "tools/esp32/generate_app_sources.py"),
         "--app-dir", str(app_dir),
         "--esp32-firmware-dir", str(esp32_dir)])
```

**PS1 shim:**

```powershell
$py = if ($env:IDF_PYTHON_ENV_PATH) { Join-Path $env:IDF_PYTHON_ENV_PATH "Scripts\python.exe" } else { "python" }
& $py "$PSScriptRoot\..\wink-micro-os\tools\esp32\generate_app_sources.py" @args
# Better: resolve via WINK_SDK_PATH
```

- [ ] **Step 1: Update CMake + wink.py + shim**

- [ ] **Step 2: Smoke**

```powershell
python wink-micro-os/tools/wink.py esp32 --app wink-micro-app/devkitc_smoke build
# Expect: Python generator runs; IDF configure succeeds; no powershell -File generate_app_sources.ps1 in the primary path (shim OK if still used by CMake until CMake lands)
```

- [ ] **Step 3: Commit** `refactor(esp32): drive app_sources generation from Python`

### Phase 1 exit criteria

- [ ] Unit tests green without IDF installed
- [ ] `wink.py esp32 … build` green on Windows (existing machine)
- [ ] Direct `idf.py -C esp32_firmware build` still regenerates sources at configure via Python
- [ ] PS1 shim still works for one release (skills/docs not yet rewritten)

---

## Phase 2 — Migrate `build_esp32` + activation

**Outcome:** `tools/esp32/build.py` replaces `scripts/build_esp32.ps1` orchestration; Windows EIM activation isolated in `activate.py`; `wink.py` no longer requires `scripts_dir` for esp32 (optional keep shim).

### Task 2.1: `activate.py` — harvest IDF env without owning install

**Files:**
- Create: `wink-micro-os/tools/esp32/activate.py`
- Create: `wink-micro-os/tools/tests/test_esp32_activate.py` (heavy mocking)

**Interfaces:**
```python
@dataclass
class IdfEnv:
    idf_path: Path
    environ: dict[str, str]  # full env dict suitable for subprocess

def is_shell_ready(environ: Mapping[str, str] | None = None) -> bool:
    """True iff `idf.py --version` output matches ESP-IDF v\\d (not shim v1.0.3)."""

def activate(environ: dict[str, str] | None = None) -> IdfEnv:
    """
    1) If is_shell_ready(environ): return IdfEnv from current env
    2) Windows: find EIM Microsoft.v6*.PowerShell_profile.ps1, run powershell
       to source it and dump KEY=VALUE lines; merge into environ
    3) Else if IDF_PATH set: run export.ps1 (Win) or . ./export.sh (posix) via shell
    4) Else raise with message pointing to wink doctor / preinstall §3
    """
```

Reuse knowledge from current `scripts/build_esp32.ps1` + `toolchain/providers/idf.py` (EIM glob, ESP-IDF banner check). Prefer **calling** shared helpers rather than duplicating version parsing — e.g. import banner check logic or move a tiny `idf_shell.py` shared by provider and activate (only if DRY is clean; otherwise copy the banner regex once and comment the twin).

- [ ] **Step 1: Tests** — mock subprocess: shim-only → not ready; after fake EIM dump with `ESP-IDF v6.0.1` + IDF_PATH → ready

- [ ] **Step 2–4: Implement + green**

- [ ] **Step 5: Commit** `feat(tools): add esp32 IDF activate helper`

### Task 2.2: `build.py` — strip contamination + run idf.py

**Files:**
- Create: `wink-micro-os/tools/esp32/build.py`
- Modify: `wink-micro-os/tools/wink.py` `handle_esp32`
- Create: `scripts/build_esp32.ps1` thin shim → Python (keep path for old docs)
- Test: `wink-micro-os/tools/tests/test_esp32_build.py` (mock `activate` + `subprocess`)

**Interfaces:**
```python
def run_idf(
    *,
    esp32_firmware_dir: Path,
    idf_args: list[str],
    cwd: Path | None = None,
) -> int:
    """Activate if needed, strip MSYS/EMSDK, set UTF-8, run idf.py -C <fw> ..."""
```

Preserve from PS1:

1. Clear `MSYSTEM`, `MSYS`, `MINGW_*`, `EMSDK`, `EMSDK_NODE`, `EMSDK_PYTHON`
2. `PYTHONUTF8=1`, `PYTHONIOENCODING=utf-8`
3. `activate()` then `idf.py -C esp32_firmware @args`
4. Return idf exit code

**wink.py `handle_esp32`:** after generate_app_sources, call:

```python
from tools.esp32.build import run_idf
rc = run_idf(esp32_firmware_dir=esp32_dir, idf_args=idf_args)
sys.exit(rc)  # or raise on non-zero
```

Stop requiring `resolve_scripts_dir(required=True)` for esp32 once Python path works; keep optional shim resolution only if `--legacy-ps1` (YAGNI — prefer hard cutover to Python with shim file left for humans).

- [ ] **Step 1: Implement build.py + wink wiring + PS1 shim**

- [ ] **Step 2: Smoke on Windows**

```powershell
Remove-Item Env:WINK_SDK_PATH -EA SilentlyContinue
python wink-micro-os/tools/wink.py esp32 --app wink-micro-app/devkitc_smoke build
# Expect: Activating via EIM (or already ready); idf build OK; no click error
```

- [ ] **Step 3: Optional Posix dry-run** (if IDF present): same command; else assert `activate()` error message mentions export.sh / preinstall

- [ ] **Step 4: Commit** `feat(tools): replace build_esp32.ps1 with Python runner`

### Task 2.3: Soften esp32 profile PowerShell requirement

**Files:**
- Modify: `wink-micro-os/tools/toolchain/profiles.py` — esp32 required caps: drop `powershell` **or** make it optional on non-Windows
- Modify: `wink-micro-os/tools/toolchain/providers/powershell.py` / `idf.py` hints
- Modify: `WORKSPACE_DEPS["esp32"]` — remove `scripts_dir` after wink no longer needs it

Recommended Phase 2 profile:

```python
"esp32": ["python", "idf"],  # powershell only needed if activate falls back to EIM on Win
```

On Windows, `activate.py` may still shell out to `powershell.exe` (System32) without declaring it a profile capability — document that. Alternatively keep `powershell` required on `nt` only via provider that always PASSes on Win System32.

- [ ] **Step 1: Adjust profiles + tests (`test_toolchain_profiles.py`, ensure esp32 tests)**

- [ ] **Step 2: Commit** `refactor(toolchain): esp32 profile no longer requires scripts_dir`

### Phase 2 exit criteria

- [ ] Cold PowerShell (no prior EIM): `wink.py esp32 … build` still works (Python activate sources EIM)
- [ ] Already-activated IDF shell: no double-activation noise; `is_shell_ready` short-circuits
- [ ] `scripts/build_esp32.ps1` shim delegates to Python
- [ ] Unit tests mock activation; no network / no real IDF required for CI unit job

---

## Phase 3 — Remove legacy PS1; docs & skills

**Outcome:** Single Python path; docs/skills/preinstall updated; dead `scripts_dir` references cleaned.

### Task 3.1: Delete or stub legacy scripts

**Files:**
- Delete or replace with fail-fast stub:
  - `esp32_firmware/generate_app_sources.ps1`
  - `scripts/build_esp32.ps1`
- Prefer **delete** if Phase 1–2 shims existed ≥1 release; else keep stub that prints “use python -m tools.esp32…” and exit 1

- [ ] **Step 1: Remove shims after grep shows no remaining callers**

```powershell
rg "generate_app_sources\.ps1|build_esp32\.ps1" -g "!docs/**" -g "!**/CHANGELOG*"
```

- [ ] **Step 2: Commit** `chore(esp32): remove PowerShell build shims`

### Task 3.2: Documentation & skill updates

**Files:**
- `wink-micro-os/tools/README.md` — layout table + esp32 section
- `wink-micro-os/tools/preinstall.md` — §3 call chain Python; drop scripts_dir requirement
- `esp32_firmware/README.md` / `README.zh_CN.md`
- `.claude/skills/burn-firmware-esp32/SKILL.md` — call `wink.py esp32` or `python -m tools.esp32…`
- `docs/design/06-build-toolchain/01-toolchain-deployment.md` — note Python runners
- Design spec / ADR-0029 wording if it still says “build_esp32.ps1 is Windows-only forever” — amend consequences: orchestration is cross-platform; EIM remains Windows-centric

- [ ] **Step 1: Update docs**

- [ ] **Step 2: Commit** `docs(esp32): document Python generate/build tools`

### Task 3.3: Final acceptance matrix

| Check | Command / expectation |
|-------|------------------------|
| Unit | `python -m unittest discover -s wink-micro-os/tools/tests -p "test_esp32*.py" -v` |
| Toolchain still green | `test_toolchain*.py` |
| Win generate | `python -m tools.esp32.generate_app_sources --app-dir wink-micro-app/devkitc_smoke` |
| Win build cold | new PowerShell → `wink.py esp32 --app wink-micro-app/devkitc_smoke build` |
| Win build hot | EIM already sourced → same, no false “not ready” |
| CMake path | `idf.py -C esp32_firmware build -DWINK_APP_DIR=…` regenerates via Python |
| Pack | Source tarball contains `tools/esp32/*.py` |
| Neg | Unset IDF → clear doctor/activate message, no `click` mystery |

- [ ] **Step 1: Run matrix; fix gaps**

- [ ] **Step 2: Mark plan ✅ in metadata**

---

## Spec coverage / non-goals

| In scope | Out of scope |
|----------|--------------|
| Python generate + build under `tools/esp32/` | Auto-install IDF |
| CMake configure uses Python | Docker IDF images |
| Thin then delete PS1 | Full macOS IDF CI in this plan (smoke only if machine has IDF) |
| Drop esp32 `scripts_dir` workspace dep | Rewriting `python wink-tools/wink.py test` to Python |

---

## Risk register

| Risk | Mitigation |
|------|------------|
| CMake `find_package(Python3)` fails in IDF script mode | Invoke absolute path to `python` / `IDF_PYTHON_ENV_PATH` Scripts\python.exe; avoid find_package in script-mode sections |
| Path rule drift vs PS1 | Phase 1 golden compare SOURCES set before deleting PS1 |
| Double activation slow | `is_shell_ready` short-circuit; cache nothing on disk |
| Skills still call PS1 | Phase 3 explicit skill update checklist |
| `wink-micro-app` vs `samples/` path | Generator accepts `--app-dir`; document samples fallback |

---

## Suggested commit series (summary)

1. `feat(tools): add Python esp32 generate_app_sources`
2. `refactor(esp32): drive app_sources generation from Python`
3. `feat(tools): add esp32 IDF activate helper`
4. `feat(tools): replace build_esp32.ps1 with Python runner`
5. `refactor(toolchain): esp32 profile drop scripts_dir`
6. `chore(esp32): remove PowerShell build shims`
7. `docs(esp32): document Python generate/build tools`

---

## Execution handoff

Plan saved to `docs/implementation-plans/tools/2026-07-13-esp32-tools-python-migration-plan.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one subagent per task, review between phases  
2. **Inline Execution** — same session, stop after each phase exit criteria  

Which approach, and should Phase 1 start now?

