# Wasm 仿真端口构建配置（仅在 EMSCRIPTEN 环境生效）。
# 调用方（顶层 CMake）决定是否链接成 wink_simulator 可执行，本文件只声明源与依赖。
set(WASM_PAL_SOURCES
    pal_hal_wasm.c
    pal_osal_wasm.c)

set(WASM_ENTRY_SOURCE wasm_entry.c)

# 提供给顶层引用（顶层负责 link 成 wink_simulator）。
# 不在此 add_library，避免在非 emcc 环境构建失败。
