# Wink Tools Toolchain Bootstrap — Design Spec

| Field | Value |
|-------|-------|
| Status | Accepted for Phase A |
| Date | 2026-07-13 |
| Scope | `wink-micro-os/tools/` — cross-platform toolchain detect / hint / (later) install |
| Related | [tools/preinstall.md](../../../wink-tools/preinstall.md), [tools/README.md](../../README.md), [ADR-0028](../../decisions/core/0028-host-binary-abi-toolchain-contract.md) |

> **Document note:** This is a superpowers drafting spec. Upon acceptance it will be
> formalized to `docs/tech-designs/unisim/2026-07-20-co-simulation-plugin-contract.md` with a
> companion implementation plan under `docs/implementation-plans/`. Two
> governance decisions — "ESP-IDF is never auto-installed" and "command-front
> gating (`ensure_for`) over doctor-only / docker-first" — will be recorded as
> ADRs before Phase A code lands, and backported to the `06-build-toolchain/`
> design spec.

---

## 1. Goals

Make `wink.py` a reliable, relocatable toolchain front-door for:

1. **In-repo developers** (phase A): fail fast with actionable install/config guidance.
2. **SDK consumers** (phase B): optionally auto-install *safe* dependencies into a user-chosen location.

**Success criteria (phase A):**

- Running `build` / `wasm` / `esp32` / `gen` / `test` / `web` never proceeds into cmake/idf when a required tool is missing.
- Missing-tool messages list: what to install, how to verify, which env vars / `wink setup --set` to use.
- All machine-local absolute paths removed from `wink.py`, `scripts/build_esp32.ps1`, and `python wink-tools/wink.py test` business logic.
- User can point tools at custom locations via config + CLI + env overrides.
- ESP-IDF is never auto-installed (see §15).
- macOS/Linux host/wasm providers work in phase A; only the esp32 profile stays Windows-only in phase A (see §5.3).

---

## 2. Non-goals

- Auto-installing ESP-IDF or Espressif toolchains (forever unsupported — see §15).
- Shipping a full Docker-based replace-the-host-toolchain workflow (may be considered separately later).
- Silently downloading large SDKs during a normal `build` (phase B installs are explicit / confirmed).
- Replacing `wink-workspace.json` (workspace directory layout); toolchain config stays in its own files (see §6.1).
- Simulating `emsdk_env` activation or IDF `export.ps1` inside `wink.py` (phase A detects and requires user pre-activation — see §7.1, §7.2).

---

## 3. Approach

**Command-gated bootstrap (Approach 1):** every `wink.py` subcommand runs `ensure_for(command)` before its handler. Dependencies are modeled as capabilities with Providers. Resolution is shared; install is pluggable and mostly deferred to phase B.

**Phase A philosophy: detect and report, do not simulate.** When a complex SDK (emsdk, IDF) needs shell activation, the provider verifies the activation is already in effect and tells the user how to activate it; it does **not** attempt to source vendor activation scripts itself, which would require per-shell (PowerShell/cmd/bash) workarounds and would fight whatever shell the user is already running. Phase B can layer in opt-in auto-activation once phase A field data shows it is safe.

Rejected alternatives:

- **Doctor-only (no gate on build)** — too easy to hit late cmake/idf failures with cryptic error output.
- **Docker-first** — conflicts with local IDF flash/serial workflows and current scripts; revisitable later.
- **Provider-driven activation in phase A** — sourcing `emsdk_env.ps1`/IDF profile from Python is shell-fragile and risks silent PATH drift.

---

## 4. Architecture

New package under `wink-micro-os/tools/toolchain/`:

```text
wink.py
  └─ ensure_for(command)
        └─ toolchain/
             ├── __init__.py
             ├── profiles.py       # command → dependency DAG (§5)
             ├── resolve.py        # path resolution by priority (§6)
             ├── check.py          # version / availability probes (§7)
             ├── report.py         # structured missing-dep report + exit (§8)
             ├── config.py         # ~/.wink/tools.json + workspace .wink/tools.json (§6)
             ├── providers/
             │     ├── base.py            # Provider ABC
             │     ├── python_pkgs.py     # Jinja2 (import probe)
             │     ├── cmake.py
             │     ├── gcc.py             # mingw triplet validation (§7.3)
             │     ├── make.py            # mingw32-make (win) / make / gmake (posix)
             │     ├── emsdk.py           # detect pre-activated shell only (§7.1)
             │     ├── idf.py             # detect via EIM profile / idf.py on PATH (§7.2)
             │     ├── node.py
             │     └── powershell.py      # Windows-only; required by esp32 profile
             └── platform/
                   ├── base.py
                   └── win.py            # Windows-specific hint text + install commands
                   # mac.py / linux.py deferred to phase B; POSIX providers work cross-platform in phase A (§5.3)
```

`tools/toolchain/` is pure Python with no binary dependencies. It ships inside **both** Source and Binary SDK tarballs so all consumers get `wink doctor` / `wink setup` (see §14).

### 4.1 Runtime flow (phase A)

```text
parse args → load workspace config (wink-workspace.json) → load toolchain config (§6.1)
  → ensure_for(cmd):
      1. expand profile DAG → ordered capability list + optional caps
      2. for each cap: resolve (§6) → check (§7); collect ALL results (never early-exit)
      3. for each required cap that failed OR optional cap that failed (warning only):
         build a ReportItem
  → all required caps OK:
        inject profile-specific env (§9) into os.environ → run handler
  → one or more required caps failed:
        render all failures (§8) → sys.exit(1)
```

Key invariants:

- **Collect-all reporting:** every missing/broken capability is surfaced in one run; never "fix one, hit the next".
- **Single probe per invocation:** each capability is probed at most once; results cached in-process for the life of the `wink.py` call.
- **Profile-scoped env injection:** env modifications are scoped to the command being run (see §9).

### 4.2 New and modified CLI

| Command | Behavior |
|---------|----------|
| `wink doctor` | Probe all profiles; print a status table grouped by profile; non-zero exit if any required capability for the "full" matrix is red. Optional `--format json` for CI (phase B; phase A always text). |
| `wink setup` (no args) | Print the **currently resolved** toolchain paths (after env/config/PATH resolution) — the "where is wink actually finding gcc?" view. |
| `wink setup --set <key>=<path>` | Write user config (`~/.wink/tools.json`) or workspace config with `--workspace`. Immediately validates the path with the capability's provider (see §10.2). |
| `wink setup --install <id>` | Phase B only; phase A prints "not yet implemented" + manual hint. |

Global flag on `wink.py` itself:

| Flag | Behavior |
|------|----------|
| `--skip-toolchain-check` | Bypass `ensure_for` gating. **Prominently warned** on stderr at start of run; intended for CI/emergency use only. Documented as an escape hatch, not the normal path. |

Existing subcommands (`gen`, `build`, `esp32`, `web`, `test`) retain their current flags and behavior; `ensure_for` is a transparent precondition.

---

## 5. Dependency model

### 5.1 Two kinds of prerequisites

Wink distinguishes two categories that the existing code already treats differently, but the current documentation and error paths muddle them together:

| Category | Meaning | Resolution mechanism | Examples |
|----------|---------|---------------------|----------|
| **Capabilities** | External binaries/SDKs installed on the host machine | Provider-based detect (§7), with config/env overrides | `python`, `jinja2`, `gcc`, `cmake`, `make`, `emsdk`, `idf`, `node`, `powershell` |
| **Workspace paths** | In-repo or SDK sibling directories that must exist for a command to run | Existing `resolve_*_dir()` functions (env → `wink-workspace.json` → monorepo defaults) | `esp32_firmware`, `scripts/` (for `build_esp32.ps1`), `embedded-frontend`, `sdk_dir` |

Phase A keeps these as separate mechanisms:

- **Capabilities** are the new domain of `toolchain/providers/`. They appear in the dependency matrix and are checked by `ensure_for`.
- **Workspace paths** continue to be resolved by `resolve_sdk_dir()` / `resolve_frontend_dir()` / `resolve_esp32_dir()` / `resolve_scripts_dir()` in `wink.py`. They are **not** modeled as Providers. When required and missing, they are collected by `ensure_for` into the same report but rendered under a separate "Workspace layout" section so users can distinguish "I don't have X installed" from "I'm in the wrong directory / WINK_FOO_PATH is mis-set".

### 5.2 Profiles as a DAG

Profiles compose via dependency to avoid duplicating capability lists. `profiles.py` defines:

```python
PROFILES = {
    "codegen":  ["python", "jinja2"],
    "host":     ["codegen", "gcc", "cmake", "make"],
    "wasm":     ["host", "emsdk"],                # node is optional (smoke tests)
    "test":     ["host"],                         # emsdk optional (wasm smoke if present)
    "esp32":    ["python", "powershell", "idf"],  # does NOT include host/wasm tools (§9)
    "web":      ["node"],
}

# Directory-layout requirements per command (checked via existing resolve_* functions)
WORKSPACE_DEPS = {
    "esp32": ["esp32_dir", "scripts_dir"],     # esp32_firmware/ and build_esp32.ps1 must exist
    "web":   ["frontend_dir"],
    # gen / build host/wasm / test work without sibling dirs (pure SDK build),
    # so they have no required workspace deps.
}

# Optional capabilities (warn only, do not block)
OPTIONAL_CAPS = {
    "test": ["emsdk", "node"],  # wasm smoke + node stub tests only if present
    "wasm": ["node"],           # node used for smoke; build itself does not require it
}
```

`ensure_for(cmd)` recursively expands the DAG (deduplicating), adds workspace deps and optional caps, then probes every listed item.

### 5.3 Command matrix

| Command | Expanded capabilities (required) | Optional (warn) | Required workspace paths |
|---------|-----------------------------------|-----------------|--------------------------|
| `gen` | python, jinja2 | — | — |
| `build host` | python, jinja2, gcc, cmake, make | — | — |
| `build wasm` | python, jinja2, gcc, cmake, make, emsdk | node | — |
| `test` | python, jinja2, gcc, cmake, make | emsdk, node | — |
| `esp32` | python, powershell, idf | — | `esp32_dir`, `scripts_dir` |
| `web` | node | — | `frontend_dir` |
| `doctor` | (probe everything; report only — never blocks) | — | (probe all; report layout) |

**Stable capability IDs:** `python`, `jinja2`, `gcc`, `cmake`, `make`, `emsdk`, `idf`, `node`, `powershell`.

**Platform coverage in phase A:**

| Capability | Windows | macOS | Linux |
|------------|---------|-------|-------|
| python, jinja2, cmake, gcc, make, node | ✅ | ✅ (native `make`/`gmake`) | ✅ (native `make`) |
| emsdk | ✅ (pre-activated shell) | ✅ | ✅ |
| powershell | ✅ | ⚠️ possible (PowerShell 7+) but build_esp32.ps1 paths are Windows-only | same |
| idf (esp32 profile) | ✅ (EIM profile detection) | ⛔ phase A — profile reports clear "esp32 builds require Windows in phase A; see preinstall.md" | same |

Only the **esp32 profile** is Windows-only in phase A (because `build_esp32.ps1` relies on Windows EIM install paths). All host/wasm/codegen/web capabilities must detect correctly on macOS/Linux in phase A — they are implemented using `shutil.which` + `subprocess` which are cross-platform already.

---

## 6. Configuration and path resolution

### 6.1 Config file separation (important)

Two distinct config files serve distinct purposes:

| File | Scope | Purpose | Committed? |
|------|-------|---------|------------|
| `wink-workspace.json` (workspace root) | Project layout | `sdk_dir`, `frontend_dir`, `esp32_dir`, `scripts_dir` — where the sibling directories live | Can be committed in templates; often machine-local |
| `<ws>/.wink/tools.json` | Workspace-scope toolchain | Machine-local paths to gcc/cmake/emsdk/idf/node/python etc. | **Never committed** (absolute machine paths) |
| `~/.wink/tools.json` | User-global toolchain | Same keys; user's default tool locations across all workspaces | N/A (user-home) |

Rule of thumb: "where is the code?" → `wink-workspace.json`; "where are the tools?" → `tools.json`.

Resolution of **workspace paths** stays in `wink.py` `resolve_*_dir()` functions (env → `wink-workspace.json` → defaults), unchanged by phase A. Resolution of **toolchain capabilities** is the new `toolchain/resolve.py` module, described next.

### 6.2 Capability resolution priority (high → low)

For each capability, the resolved binary/SDK root is chosen from the first-success source:

1. **Capability-specific env var** (see table below) if set and the path it points to passes the capability's probe.
2. **Workspace config** `<cwd-or-app-ws>/.wink/tools.json` → `paths.<cap>`.
3. **User config** `~/.wink/tools.json` → `paths.<cap>`.
4. **PATH lookup** via `shutil.which()` and provider-specific well-known locations (e.g. `C:\Espressif\tools\...` for IDF; see provider defaults in §7).

Capability-specific env vars:

| Capability | Env var | Meaning |
|------------|---------|---------|
| python | `WINK_PYTHON` (rarely needed — defaults to `sys.executable`) | Python interpreter to invoke for codegen/test |
| gcc | `WINK_GCC_PREFIX` (directory containing `gcc`) | Explicit MinGW/host gcc bin dir |
| cmake | — (falls back to PATH) | — |
| make | — (falls back to PATH; `mingw32-make` on win, `make`/`gmake` on posix) | — |
| emsdk | `EMSDK` | Emscripten SDK root (must be pre-activated — §7.1) |
| idf | `IDF_PATH` (and `IDF_TOOLS_PATH`) | IDF install root (see §7.2) |
| node | — (falls back to PATH) | — |
| powershell | — (on Windows always `powershell.exe` in System32) | — |
| jinja2 | — (imported via the resolved python) | — |

Additionally `WINK_TOOLS_HOME` points at a root for phase B auto-installs (default: `~/.wink/tools` or platform-equivalent).

### 6.3 Config schema (`version: 1`)

```json
{
  "version": 1,
  "tools_home": "D:/software/wink-tools",
  "paths": {
    "gcc": "C:/.../mingw64/bin",
    "cmake": "C:/Program Files/CMake/bin",
    "emsdk": "D:/software/embedded/emsdk",
    "idf": "D:/software/embedded/esp/v6.0.1/esp-idf",
    "idf_tools": "C:/Espressif/tools",
    "node": null
  }
}
```

- `version`: schema version. If a file is encountered with `version` ≠ `1`, `wink.py` aborts with "Unsupported tools.json version; delete the file or upgrade wink" — no silent ignore.
- `tools_home`: default root for phase B auto-installs; user-customizable.
- `paths.*`: for most capabilities this is a **bin directory**; for emsdk/idf this is the **SDK root**. Each provider interprets its key (documented per-provider in `providers/*.py` docstrings).
- `null` / missing key → fall through to next priority level.

A `tools/toolchain/tools.json.example` ships in-repo. Workspace `.wink/` is gitignored (absolute machine paths must never be committed).

### 6.4 Config merging rules

- If both workspace and user config set the same key, workspace wins (matches priority in §6.2).
- Env vars always win over files.
- Writing via `wink setup --set` merges into the existing file (does not overwrite unrelated keys).

---

## 7. Provider detection contracts

Every provider implements three methods:

```python
class Provider(ABC):
    def detect(self, ctx: ResolveContext) -> DetectResult: ...
    def hint(self, ctx: ResolveContext) -> str: ...            # OS-specific install/activate guidance
    def install(self, ctx: ResolveContext) -> None: ...        # phase A: raises Unsupported for most; idf: forever
```

`DetectResult` carries: `found: bool`, `path: Path | None`, `version: str | None`, `reason: str | None` (why detection failed, for the report).

All subprocess probes use `timeout=10` seconds. A probe that times out is treated as `found=False` with reason "binary timed out — may be a broken wrapper or non-interactive installer; please verify manually".

### 7.1 emsdk (Emscripten)

**Phase A stance: detect a pre-activated shell only.**

Rationale: `emsdk_env.ps1`/`emsdk_env.bat`/`emsdk_env.sh` set more than just `PATH` — they also pin `EMSDK_NODE` (critical: some `emcc` versions will not work with system Node), `EMSDK_PYTHON`, and prepend the *currently activated version's* `upstream/emscripten` directory (not the emsdk root). Simulating this reliably across PowerShell/cmd/WSL/git-bash in phase A is fragile and risks silently using the wrong Node, producing hard-to-diagnose build failures.

Detection steps (in order):

1. If `EMSDK` env is set **and** `emcc --version` succeeds in the current `os.environ` **and** `emcmake --version` succeeds → PASS, record version.
2. If `EMSDK` is set but `emcc` is not on PATH → FAIL with reason "EMSDK is set but emcc is not on PATH — run the emsdk activation script for your shell (see preinstall.md §2)".
3. If `EMSDK` is not set → FAIL with reason "emsdk not activated — set EMSDK and run the activation script (see preinstall.md §2)".

Version floor: **Emscripten ≥ 3.1.45** (lower bound aligned with ADR-0028; upper bound not set in phase A; report records discovered version for diagnostics). Do **not** parse for 6.x — preinstall.md mentions "6.0.1" which is ESP-IDF's version, not Emscripten's; Emscripten itself is currently in the 3.x/4.x line.

Phase B may add `install()` that invokes `emsdk install latest && emsdk activate latest` into `tools_home/emsdk`, followed by printing the activation line the user must run in their shell (or spawning a subshell, TBD).

### 7.2 idf (ESP-IDF)

**Phase A stance: detect + hint; install is forever unsupported (see §15).**

Critical: the provider **must not** hardcode sub-tool paths (cmake 4.0.3, ninja 1.12.1, xtensa-esp-elf esp-15.2.0, openocd, etc.). Those versions vary by install date and IDF patch release; hardcoding them recreates the exact problem this spec is eliminating. The IDF toolchain is managed by Espressif's own tooling (EIM profile or `export.ps1`), which resolves sub-tool paths internally.

Detection steps (Windows phase A):

1. If `idf.py --version` succeeds already on PATH (user has activated an IDF shell):
   - Validate version is `>=6.0,<7.0` (preinstall.md: "本仓锁定 v6.0.1").
   - Verify `IDF_PATH` env points to an existing directory containing `tools/idf.py`.
   - PASS.
2. Else scan for an **Espressif IDF PowerShell profile** at `C:\Espressif\tools\Microsoft.v*.PowerShell_profile.ps1` (EIM install):
   - Pick the profile matching the supported major version (v6.x).
   - In a subprocess, source the profile, run `idf.py --version`, capture env changes, verify version.
   - On success: record `IDF_PATH`, `IDF_TOOLS_PATH`, `IDF_PYTHON_ENV_PATH` from the subprocess env, plus the profile path — these are what we will inject at build time (§9).
   - PASS.
3. Else check `IDF_PATH` / `IDF_TOOLS_PATH` env without profile — if set but `idf.py` not on PATH, FAIL with "IDF_PATH is set but idf.py is not on PATH — source the IDF export script or activate via EIM profile; see preinstall.md §3".
4. Else FAIL with "ESP-IDF v6.x not detected — install via Espressif-IDE Manager (EIM) or manual install; Wink will never auto-install IDF (see preinstall.md §3)".

For macOS/Linux in later phases: equivalent probe looks for `~/esp/esp-idf/export.sh` or `idf.py` on PATH.

The provider's resolved data is consumed by **rewriting** `scripts/build_esp32.ps1` (see §12): the ps1 script must stop hardcoding paths and instead *trust* env vars already set by `wink.py`, using the EIM profile or falling back to `export.ps1` when they are not set. The script continues to do its critical job — strip MSYS/MinGW/EMSDK from PATH ([[memory:esp-idf-build-from-git-bash]]) and set `PYTHONUTF8=1` (see §9), but no longer owns IDF path discovery.

### 7.3 gcc

- Resolve via priority order (§6.2); on PATH use `shutil.which("gcc")`.
- On Windows, after finding `gcc`, run `gcc -dumpmachine` and verify the output triplet contains `w64-mingw32` (e.g. `x86_64-w64-mingw32`). Non-mingw gcc (Strawberry Perl's, MSYS2's default, Cygwin, Go's gcc wrapper) is reported as "found but is not a MinGW-w64 GCC — adjust PATH order or set WINK_GCC_PREFIX; see preinstall.md §1". This avoids hard-to-debug "linker can't find -lmingwex" failures from misidentified gcc.
- Version floor: **GCC ≥ 14** (ADR-0028 toolchain matrix; aligns with WinLibs UCRT POSIX builds).
- On Linux/macOS: native host gcc (or clang masquerading as gcc) is accepted; triplet check is Windows-only.

### 7.4 cmake

- `cmake --version` parse.
- Version floor: **CMake ≥ 3.15** (current CMakeLists.txt minimum).
- PATH-only resolution (no custom env var in phase A; user can still put `cmake` in `paths.cmake` pointing at bin dir).

### 7.5 make

Cross-platform naming:

- Windows: find `mingw32-make.exe` (matches MinGW Makefiles generator used in `wink.py:317`).
- Linux/macOS: find `make`, then `gmake`.
- Single capability id `make`; the provider hides the platform name difference.

### 7.6 python

- Defaults to `sys.executable` (the interpreter running `wink.py`), since codegen and tests run in-process or via `subprocess.run([sys.executable, ...])`.
- If user sets `WINK_PYTHON` or config `paths.python`, verify `--version` and use that interpreter instead.
- Version floor: **Python ≥ 3.10** (code uses `Path | None` syntax per preinstall.md).

### 7.7 jinja2

- A Python-package capability, not a binary. Provider runs `<resolved-python> -c "import jinja2; print(jinja2.__version__)"`.
- No version floor in phase A (any 3.x works); record version for diagnostics.

### 7.8 node

- `node --version` parse (strip leading `v`).
- Optional for `test`/`wasm` (smoke/stub tests); required for `web`.
- No version floor in phase A; any Node that can run Vite works.

### 7.9 powershell

- Windows: always `powershell.exe` (Windows PowerShell 5.1) in `System32`, not PowerShell 7 (`pwsh.exe`). EIM installs the `Microsoft.v6.0.1.PowerShell_profile.ps1` for Windows PowerShell.
- Non-Windows: report "esp32 builds require Windows PowerShell 5.1 + EIM in phase A".

---

## 8. Missing-dependency report contract

When one or more required capabilities (or required workspace paths) fail, `report.py` renders a grouped report to **stderr** and exits with code `1`. The report includes:

### 8.1 Grouping

1. **Required tool capabilities (blocking)** — one block per failed capability
2. **Required workspace paths (blocking)** — missing sibling directories or bad env config
3. **Optional tools (warnings, non-blocking)** — e.g. emsdk missing when running `test` (wasm smoke skipped), node missing when running `wasm`
4. **Summary line** — e.g. "3 errors, 1 warning"

### 8.2 Per-item content

For every failed required item the report lists:

1. Capability/path id + minimum version (if applicable) + currently-detected version/path (if partially found)
2. **Why it failed** (probe output summary, e.g. "`gcc -dumpmachine` returned `x86_64-msys-*` — not MinGW-w64")
3. Recommended install steps for the current OS (phase A: manual; phase B: may mention `wink setup --install`)
4. Env var(s) and/or `wink setup --set <key>=<path>` to pin a custom location
5. A copy-pasteable verification command (e.g. `emcc --version`, `. $env:EMSDK\emsdk_env.ps1`)

For ESP-IDF specifically the report must include verbatim:

> **ESP-IDF is never auto-installed by Wink.** Please install via Espressif-IDE Manager (EIM) or follow the manual steps in `tools/preinstall.md §3`. After install, ensure you can run `idf.py --version` in a PowerShell window, or set `IDF_PATH` / `IDF_TOOLS_PATH` and source the export/profile script.

Also include the UTF-8 note from preinstall.md: set `PYTHONUTF8=1` to avoid GBK crashes on Chinese Windows.

### 8.3 Example

```
[wink] 3 errors, 1 warning — toolchain check failed

── Required tools ─────────────────────────────────────────
✗ cmake (≥3.15)
  Reason: `cmake --version` exited with code 1 (not found on PATH)
  Install (Windows): winget install Kitware.CMake
  Or pin path:  wink setup --set cmake=C:/Program Files/CMake/bin
  Verify:       cmake --version

✗ emsdk (≥3.1.45)
  Reason: EMSDK is set but emcc is not on PATH — shell not activated
  Activate (PowerShell):  $env:EMSDK="D:/software/embedded/emsdk"; . "$env:EMSDK/emsdk_env.ps1"
  Verify:                 emcc --version

── Required workspace paths ───────────────────────────────
✗ esp32_dir
  Reason: WINK_ESP32_PATH not set, no esp32_firmware/ next to SDK
  Fix:  set WINK_ESP32_PATH or run from a monorepo / workspace with esp32_firmware/

── Optional (warnings only) ───────────────────────────────
! node not found — wasm smoke tests will be skipped; install node to run them

── Note ───────────────────────────────────────────────────
ESP-IDF is never auto-installed by Wink. See tools/preinstall.md §3.
Set $env:PYTHONUTF8=1 before running esp32 builds on Chinese Windows.
```

---

## 9. Process env injection after successful resolve

After all required checks pass, `ensure_for` modifies `os.environ` for the duration of the subprocess calls the handler will make. Injections are **profile-specific** to avoid cross-contaminating toolchains:

### 9.1 Profile env matrix

| Profile | Env mutations |
|---------|---------------|
| `codegen`, `host`, `test` | Prepend resolved `gcc/bin`, `cmake/bin`, `make/bin` to `PATH`. Set `PYTHONPATH` to SDK root (already done today for tests). |
| `wasm` | Same as host. **Do not** prepend/modify anything emsdk-related — emsdk must already be active in the parent shell (§7.1); we only verify that `emcc`/`emcmake` work in the inherited env. (If phase B later adds auto-activation, this is where sourced env would be injected.) |
| `esp32` | Set `IDF_PATH`, `IDF_TOOLS_PATH`, `IDF_PYTHON_ENV_PATH`, `ESP_IDF_VERSION` (from provider detection — §7.2). Set `PYTHONUTF8=1` and `PYTHONIOENCODING=utf-8` unconditionally on Windows ([memory:esp-idf-install-state]). **Do NOT prepend host gcc/cmake/make/emsdk to PATH** — IDF ships its own cmake/ninja/python/xtensa toolchain; host MinGW on PATH will break IDF builds. |
| `web` | Prepend `node` bin dir to PATH if resolved from a non-PATH location. |

### 9.2 Rules

- Capability bin dirs are **prepended** (not appended) so that Wink-resolved tools win over unrelated binaries further down PATH (e.g. Strawberry Perl gcc).
- Modifications are to `os.environ` in the current Python process; subprocess calls inherit them naturally.
- `wink.py` **must delete** the existing hardcoded WinLibs path prepend at lines 25–28. That mechanism is entirely superseded by the provider + env injection.
- `scripts/build_esp32.ps1` is refactored (§12) to consume env vars set by `wink.py` instead of hardcoding its own paths. It continues to strip MSYS/MINGW/EMSDK env (its existing safety job).
- In-process codegen calls (which use `sys.executable`) and CMake subprocess calls all share the same post-injection env.

---

## 10. `wink setup` semantics

### 10.1 Writing config

- `wink setup --set key=value` validates `key` is one of the stable capability IDs (or `tools_home`, or a workspace-path key like `sdk_dir`/`frontend_dir`/`esp32_dir`/`scripts_dir`).
- With `--workspace`, writes to `<workspace>/.wink/tools.json` (workspace root resolved the same way as `wink-workspace.json` discovery).
- Without `--workspace`, writes to `~/.wink/tools.json`.
- File is created with `"version": 1` if it does not exist; merges with existing keys otherwise.

### 10.2 Immediate validation

After writing, the corresponding provider's `detect()` is run against the new value. If detection fails (path does not exist, binary is wrong, triplet mismatch, etc.), the change is **not written** and an error is printed explaining why. This prevents "save a bad path, discover it next build" loops.

For workspace-path keys (`sdk_dir` etc.), the corresponding `resolve_*_dir()` with `required=True` semantics is used to validate (directory must exist and contain expected markers, e.g. `sdk_dir` must contain `CMakeLists.txt` and `pal/`).

### 10.3 Reading config (no-arg `wink setup`)

`wink setup` with no arguments prints a YAML-like view of the fully resolved toolchain — after all env/config/PATH priority has been applied. This is the "what is Wink actually using" view and is invaluable when filing issues.

```
$ wink setup
Wink toolchain resolution:
  python   : C:\Users\...\AppData\Local\Programs\Python\Python312\python.exe   (3.12.4)    [PATH]
  jinja2   : 3.1.4                                                                         [python-import]
  gcc      : C:\...\WinLibs\...\mingw64\bin\gcc.exe   (14.2.0, x86_64-w64-mingw32)  [config:user]
  cmake    : C:\Program Files\CMake\bin\cmake.exe    (3.31.2)                      [env:PATH]
  make     : C:\...\WinLibs\...\mingw64\bin\mingw32-make.exe                      [config:user]
  emsdk    : D:\software\embedded\emsdk                              (4.0.5)      [env:EMSDK, activated]
  idf      : not detected (esp32 builds unavailable)                              [—]
  node     : C:\Program Files\nodejs\node.exe         (20.15.0)                    [PATH]

Config files:
  user   : C:\Users\77174\.wink\tools.json
  workspace : D:\workspaces\ai-coding\wink-ai\wink-ai-embedded\.wink\tools.json (not present)
```

---

## 11. Caching and performance

- **In-process cache:** within a single `wink.py` invocation, probe each capability at most once. The cache key is the capability id; there is no TTL because the process environment does not change mid-run.
- **No on-disk cache in phase A:** the probe cost is ~10 × 50ms subprocess forks (<500ms typical), which is negligible compared to a cmake configure. Phase B may add a `~/.wink/cache.json` with PATH-hash invalidation and a 5-minute TTL if profiling shows it is needed, but YAGNI until then.

---

## 12. Refactoring of existing scripts (phase A deliverables)

These are required to actually honor the contract; without them the new providers coexist with stale hardcoded paths and one side will lie.

### 12.1 `wink-micro-os/tools/wink.py`

- Delete lines 25–28 (hardcoded WinLibs `mingw_bin` prepend).
- Import `toolchain` package; call `ensure_for(cmd_name)` in `main()` after `parse_args` and before `args.handler(args)`.
- Remove any ad-hoc "is this tool present?" checks that duplicate provider logic.
- Inject resolved SDK/sibling dirs into `os.environ` (already done today at lines 203–215; keep, but workspace-path missing reports route through `ensure_for`'s workspace section).

### 12.2 `scripts/build_esp32.ps1`

- **Remove all hardcoded absolute paths** (lines 21–43 in the current file: `IDF_TOOLS_PATH`, `IDF_PATH`, `IDF_PYTHON_ENV_PATH`, `ESP_IDF_VERSION`, `ESP_ROM_ELF_DIR`, `OPENOCD_SCRIPTS`, `ESP_CLANG_LIBS_PATH`, and the rebuilt `$env:PATH`).
- Replace with:
  1. Honor env vars that `wink.py` already set (`IDF_PATH`, `IDF_TOOLS_PATH`, `IDF_PYTHON_ENV_PATH`, `ESP_IDF_VERSION`) when present.
  2. If env vars are missing, fall back to sourcing the EIM PowerShell profile (discovered via `C:\Espressif\tools\Microsoft.v<maj>.*.PowerShell_profile.ps1`) or to dot-sourcing `$IDF_PATH/export.ps1` if `IDF_PATH` is set but tools are not on PATH.
  3. Strip MSYS/MINGW/EMSDK env (lines 16–19 — **keep this**, it is the MSYS contamination guard per [[memory:esp-idf-build-from-git-bash]]).
  4. Set `PYTHONUTF8=1` + `PYTHONIOENCODING=utf-8` unconditionally (line 15 — keep; belt-and-suspenders with wink.py injection).
  5. Call `idf.py -C esp32_firmware @IdfArgs` (line 46 — keep).
- After this refactor the script is usable both from `wink.py esp32` and directly from PowerShell when the user has activated an IDF shell (no regression).

### 12.3 `python wink-tools/wink.py test`

- Remove the hardcoded WinLibs path prepend (section 1, analogous to `wink.py`).
- Remove the hardcoded emsdk default path `D:\software\embedded\emsdk` (section 5.5).
- Strategy: the script should either (a) delegate toolchain discovery to `python tools/wink.py test --dry-run` (or a new `wink toolchain env` command that prints resolved env), or (b) do its own minimal check that `gcc`/`cmake` are on PATH and are MinGW, failing fast with a pointer to `wink doctor` if not.
- Recommended approach for phase A: option (b) — keep `python wink-tools/wink.py test` self-contained (it is used in quick local sanity checks and CI) but replace hardcoded paths with a minimal PATH-based check + a "run `wink doctor` for diagnostics" message. Emscripten activation check: fail `-WithWasm` pass with a clear message if `emcc` is not on PATH, rather than defaulting to a hardcoded path.
- Lint passes (sections 6–9) already use relative paths and are unaffected.

---

## 13. Testing

| Kind | What |
|------|------|
| Unit | Resolve priority: env > workspace > user > PATH (for each capability, plus for workspace-path keys). |
| Unit | Collect-all behavior: multiple missing capabilities produce one report listing all; not just the first. |
| Unit | Version parsing for each provider using real `--version` output fixtures (gcc 14.x, cmake 3.x/4.x, emcc 3.x/4.x, python 3.10–3.13, node v2x, idf.py v6.0.x). |
| Unit | Windows gcc triplet rejection (Strawberry, MSYS, Cygwin triplets → fail with specific reason). |
| Unit | `make` provider resolves `mingw32-make` on Windows, `make`/`gmake` on POSIX. |
| Unit | Config schema version mismatch: `version: 2` → abort with clear message. |
| Unit | `wink setup --set` validation: bad path → no write, error message contains reason. |
| Unit | `idf.install()` raises `UnsupportedError`; message says manual install only and includes the "never auto-install" sentence. |
| Unit | Provider subprocess with a hanging fake binary → timeout within ≤12 seconds, reports "timed out". |
| Unit | Profile DAG expansion does not double-inject dependencies (e.g. `wasm` → `host` → `codegen`; python only probed once). |
| Unit | PATH prepend order: Wink-resolved gcc/bin appears before inherited PATH entries. |
| Unit | Esp32 profile env does NOT include host gcc/make/emsdk PATH entries (isolation). |
| Integration | Mock `shutil.which` / `subprocess.run` so `build host` with a missing cmake never invokes real cmake; exits with code 1 and report mentions cmake. |
| Integration | With all tools present and emsdk activated (CI), `wink build wasm --app <sample>` proceeds to cmake configure. |
| Docs | `preinstall.md` §1–3 install commands and verification steps stay aligned with provider hint text (enforced by a lint check or by generating hint text from a single shared source). |

Tests go under `wink-micro-os/tools/tests/test_toolchain*.py`, runnable via `pytest` or via `python -m unittest` without requiring any of the probed tools to be installed (extensive mocking).

---

## 14. SDK packaging

- `tools/toolchain/` is pure Python (no binaries, no compiled extensions). It is **included in both Source and Binary SDK tarballs**.
- `pack_sdk_source.py` and `pack_sdk_binary.py` must be verified (and if necessary updated) to include the new `tools/toolchain/` package in their tarballs.
- Binary SDK consumers therefore get the same `wink doctor` / `wink setup` experience as in-repo developers; ADR-0028's toolchain matrix (MinGW ≥14, Emscripten ≥3.1.x) is enforced by the providers at consumer build time, preventing the silent ABI drift that motivates the ADR.
- `tools/toolchain/tools.json.example` is shipped but an explicit consumer `tools.json` is not (config is always user-local).

---

## 15. Policy: ESP-IDF is never auto-installed

This is a permanent policy, not a phase-A limitation:

- `providers/idf.py`'s `install()` method **always** raises `UnsupportedError`. There is no phase B plan to change this.
- Rationale: IDF installs are multi-GB, have licensed Espressif toolchain components, require driver/serial configuration, and are deeply opinionated about install layout (EIM-managed, or `~/esp/` for manual installs). Auto-installing IDF would conflict with Espressif's own tools, surprise users on metered connections, and create a hard-to-support fork-state between Wink-managed and EIM-managed installs.
- `wink doctor` and the missing-dependency report (§8) always state this explicitly. If users have IDF installed in a non-standard location they can point at it with `wink setup --set idf=<path> --set idf_tools=<path>` and (on Windows) with the EIM profile path.

---

## 16. Phased delivery

### Phase A — detect + hint + gate (this spec's first implementation)

- Implement `toolchain/` package (§4) with all providers listed in §7; Windows-first but POSIX providers work for host/wasm (§5.3).
- Wire `ensure_for` into `wink.py`; remove the hardcoded WinLibs path prepend.
- Implement `wink doctor` / `wink setup` (no-arg print + `--set` with validation).
- Refactor `scripts/build_esp32.ps1` to consume injected env / source EIM profile (§12.2).
- Refactor `python wink-tools/wink.py test` to remove hardcoded paths (§12.3).
- Unit tests per §13 (mocking-heavy; no tools required to run the test suite).
- Verify `tools/toolchain/` is included by SDK pack scripts (§14).
- Update `preinstall.md` to align install commands and env var names with provider hints; update `tools/README.md` to document `doctor` / `setup`.
- Add `.wink/` to `.gitignore` (workspace root).
- Add two ADRs (see §17) before code merges.

### Phase B — selective auto-install (separate spec later)

| Capability | Auto-install | Method |
|------------|--------------|--------|
| Jinja2 | Yes | `pip install --user` or tools venv under `tools_home` |
| cmake | Yes (Win) | `winget install Kitware.CMake`; on posix defer to system package manager |
| gcc (WinLibs) | Yes (Win) | `winget install BrechtSanders.WinLibs.POSIX.UCRT`; on posix defer to system |
| emsdk | Yes | Official `emsdk` git clone into `tools_home/emsdk` + install + activate; user still must run activation in their own shell for first use |
| idf | **Never** | See §15 |
| node | Optional | Only needed for `web`; prompt, do not silently install |

Rules:

- Install only via explicit `wink setup --install <id>` or interactive confirmation.
- Default `build` / `esp32` remain detect-only (no surprise multi-GB downloads in CI).
- Auto-installs target `tools_home` (default `~/.wink/tools`), not system directories, unless user overrides with a system path.

---

## 17. Open decisions and governance

| Topic | Decision |
|-------|----------|
| Audience | Both; phase A in-repo, phase B SDK consumers |
| Gate style | Command-front `ensure_for` (not doctor-only) — will be recorded as ADR |
| Config UX | Env > workspace/user JSON + `wink doctor` / `wink setup` |
| Workspace vs toolchain config | Separate files with distinct purposes (§6.1) |
| ESP-IDF auto-install | Forever unsupported (§15) — will be recorded as ADR |
| Provider activation | Phase A detect-only; no emsdk/IDF activation simulation (§7.1, §7.2) |
| Custom locations | Supported via `tools_home` + `paths.*` + env |
| macOS/Linux scope | Host/wasm providers work in phase A; esp32 stays Windows-only (§5.3) |
| `wink setup --check` alias | Dropped; no-arg `wink setup` prints resolved config instead |
| On-disk probe cache | Deferred (YAGNI phase A) |
| `--format json` for doctor | Phase B |

Two ADRs will be written and Accepted before Phase A code is merged:

1. **"Toolchain gating is command-front, not doctor-only or docker-first"** — alternatives considered, rationale, consequences (any new subcommand must call `ensure_for`).
2. **"ESP-IDF is never auto-installed by Wink tooling"** — rationale (size, licensing, EIM conflict, driver concerns), permanent policy.

On Acceptance, both ADRs backport to `docs/design/06-build-toolchain/` as the living design spec.

---

## 18. Out-of-scope follow-ups

- Cloud/CI image that pre-bakes emsdk + IDF (would consume provider contracts but is a separate deliverable).
- Migrating `burn-firmware-esp32` skill to call `wink doctor` first (tracked separately).
- Binary-SDK consumer path specifics beyond using the same `ensure_for` (e.g., IDE plugin integrations).
- `wink toolchain env` — emit resolved env as shell-sourceable snippets (`export`/`set` syntax) for users who want to activate toolchains without running `wink.py build`. Desirable but YAGNI phase A.
- `wink update` — check for newer Wink SDK versions (separate product concern).

