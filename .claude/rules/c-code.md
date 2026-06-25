---
paths:
  - "**/*.c"
  - "**/*.h"
---

# C Coding Standards & API Conventions

Guidelines and constraints for writing or refactoring C code (`.c` and `.h` files) in WinkMicroOS.

## 1. Error Handling (`wink_status_t`)

All functions that can fail must return a status of type `wink_status_t` and follow the convention defined in [ADR-0001](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0001-error-code-sign-convention.md).
- **0 = Success (`WINK_OK`)**
- **Negative values = Errors** (e.g. `WINK_ERR_INVALID_ARG = -1`, `WINK_ERR_TIMEOUT = -2`)
- **Checking Returns**: Always use `if (status < 0)` or `if (status != WINK_OK)` to check for errors. Avoid writing `if (status)` to check for errors, as negative values evaluate to true in C.
- **Error Code Layout**:
  - `-1` to `-11`: Common recoverable errors.
  - `-20` to `-29`: Functional safety recoverable errors (e.g., `WINK_ERR_OVERCURRENT = -20`).
  - `-30` to `-49`: Fatal errors (e.g., `WINK_ERR_WATCHDOG = -30`).
  - `-99`: Non-recoverable panic (`WINK_ERR_PANIC`).

## 2. Device Abstraction Layer (DAL) Design Paradigm

WinkMicroOS intentionally deviates from traditional OOP dynamic dispatch (virtual tables, `container_of` macros) to ensure AI codegen friendliness and Wasm simulator execution performance, as decided in [ADR-0004](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0004-static-dispatch-vs-runtime-ops.md).
- **Compile-Time Static Dispatch**: Use compile-time static dispatch and named APIs (e.g., `dal_ultrasonic_read()`). Do NOT define or use `struct device_ops` or dynamic function pointers.
- **POD Structures**: Outer/device instances must be Plain Old Data (POD) structures representing state only. Do not nest function pointers.
- **Lowest-Layer Bypass**: Keep `#ifdef SIMULATION` logic as narrow as possible. Only bypass the lowest physical signal layers, keeping protocol parsing and error detection code shared across simulation and real target compilations.

## 3. Double-Target Compilation

Ensure C code compiles cleanly under two distinct target toolchains without changes, as described in [ADR-0002](file:///d:/workspaces/ai-coding/wink-ai/wink-ai-embedded/docs/design/decisions/0002-dual-target-compilation.md):
- **Wasm Target**: Emscripten toolchain (`emcc` targeting `wasm32`). Ensure compatibility with Asyncify semantics (e.g. cooperative multitasking via OSAL delays).
- **Physical Target**: ESP-IDF/xtensa compiler targeting ESP32. Avoid clang-specific features or compiler/stdlib behaviors that would break GCC xtensa builds.

## 4. Struct Layout & Serialization (review P1-5, Phase 6 Task 6-1)

Runtime/DAL structs are **in-memory state**, not wire/flash layouts. Never blur the two.

- **Natural alignment, no `packed`**: DAL/runtime POD structs MUST be naturally aligned — **禁止** `__attribute__((packed))` / `#pragma pack`. On ARM/Xtensa, packed/unaligned access degrades performance and can raise an Alignment Fault / HardFault. Let the compiler pad.
- **Member ordering**: order members by alignment requirement **descending** (`uint64_t`/`double` → `uint32_t`/`float`/pointer → `uint16_t` → `uint8_t`/`bool` last) to minimize tail padding and keep the layout legible.
- **Separate wire/flash structs**: structs crossing a process/target boundary (network frame, persistent record) must be **independently named and defined** — `xxx_wire_t` / `xxx_flash_record_t` — with explicit `version`, `endianness`, and `CRC` fields. Do NOT reuse a runtime POD as a wire layout.
- **No raw `memcpy` of runtime structs to wire/flash**: conversion MUST go through explicit `serialize`/`deserialize` functions that validate `version` / `endianness` / `CRC`. Treat a runtime struct's byte image as target/compiler-specific — never persist or transmit it verbatim.
