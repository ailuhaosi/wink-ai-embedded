# Tools Unify Under wink-micro-os Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans (or execute directly when user already approved).

**Goal:** Move monorepo-root `tools/` into `wink-micro-os/tools/` with `codegen/` + `lint/` layout; CLI lives in SDK.

**Architecture:** SDK-owned toolchain; workspace siblings (frontend/esp32) via env / `wink-workspace.json` / `SDK/../…`.

## Target layout

```
wink-micro-os/tools/
  wink.py
  README.md
  codegen/          # device tree + config_h.py + pt_state.py
  lint/             # check_*.py
```

## Tasks

1. Move `tools/codegen/` → `wink-micro-os/tools/codegen/`
2. Move/rename OS scripts: `codegen_config.py` → `codegen/config_h.py`; `app_codegen.py` → `codegen/pt_state.py`; `check_*.py` → `lint/`
3. Move `wink.py`; fix `SDK_ROOT` / workspace root resolution; fix `test` invocation
4. Update CMake / `python wink-tools/wink.py test` / esp32 / wink-micro-app path defaults
5. Root `tools/`: removed after cutover (no shim)
6. Update living docs (README, 02/03 design, CHANGELOG); verify golden tests

## Status

**Executed 2026-07-12** — layout landed; golden tests OK. Root `tools/` deleted.
