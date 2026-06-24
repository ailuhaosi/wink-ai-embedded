cmake_minimum_required(VERSION 3.15)
project(wink-micro-os C)

# 设置 C 标准为 C99
set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

# 定义目标编译平台变量，默认为 WASM 仿真环境
set(TARGET_PLATFORM "wasm" CACHE STRING "Target hardware platform: wasm, esp32, stm32")
message(STATUS "Configuring wink-micro-os for platform: ${TARGET_PLATFORM}")

# 通用全局宏定义
add_compile_definitions(PLATFORM_${TARGET_PLATFORM})
if(TARGET_PLATFORM STREQUAL "wasm")
    add_compile_definitions(SIMULATION=1)
endif()

# 收集子组件构建
add_subdirectory(pal)
add_subdirectory(dal)
add_subdirectory(trace)
add_subdirectory(runtime)

# 根据目标平台配置可执行程序或测试用例 (主要针对 WebAssembly / Wasm 仿真)
if(TARGET_PLATFORM STREQUAL "wasm" AND EMSCRIPTEN)
    add_executable(wink_simulator
        targets/wasm/pal_hal_wasm.c
        targets/wasm/pal_osal_wasm.c
        targets/wasm/wasm_entry.c)
    target_link_libraries(wink_simulator PRIVATE pal dal)
    target_link_options(wink_simulator PRIVATE
        "-s" "ASYNCIFY=1"
        "-s" "ASYNCIFY_IMPORTS=['js_sim_get_ultrasonic_distance']"
        "-s" "EXPORTED_FUNCTIONS=['_main','_trigger_wasm_interrupt']"
        "-s" "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        "-s" "MODULARIZE=1"
        "-s" "EXPORT_NAME='WasmSandbox'")
endif()

# ---- host 单元测试（非 wasm target 时启用）----
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(targets/host)      # host 一等 target，供 test 链接
    add_subdirectory(test)
endif()
