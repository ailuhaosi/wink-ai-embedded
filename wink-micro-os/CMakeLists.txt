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
        targets/wasm/pal_resource_wasm.c
        targets/wasm/wasm_entry.c)
    target_link_libraries(wink_simulator PRIVATE pal dal)
    target_link_options(wink_simulator PRIVATE
        "-s" "ASYNCIFY=1"
        "-s" "ASYNCIFY_IMPORTS=['js_pal_delay_ms','js_pal_delay_us']"
        "-s" "EXPORTED_FUNCTIONS=['_main','_trigger_wasm_interrupt']"
        "-s" "EXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
        "-s" "MODULARIZE=1"
        "-s" "EXPORT_NAME='WasmSandbox'"
        "-s" "STACK_OVERFLOW_CHECK=2"      # dev/debug：栈溢出 abort，避免静默线性内存越界（亦为中断重入早期报警，见 plan Phase 1 Task 1-5）
        "-s" "ASSERTIONS=1"                # dev/debug：带运行时开销/体积代价，生产 profile 调优留作后续
        "-s" "ASYNCIFY_STACK_SIZE=65536")  # 起步值；最终须实测最深 AI 生成调用链（plan Task 1-4 清单第 6 项）
endif()

# ---- host 单元测试（非 wasm target 时启用）----
if(NOT TARGET_PLATFORM STREQUAL "wasm")
    enable_testing()
    add_subdirectory(targets/host)      # host 一等 target，供 test 链接

    # §6.1 约束3：标准 App 注入接口。未指定则默认 samples/avoidance_car。
    if(NOT DEFINED WINK_APP_DIR)
        set(WINK_APP_DIR ${CMAKE_CURRENT_SOURCE_DIR}/samples/avoidance_car)
    endif()
    message(STATUS "WINK_APP_DIR = ${WINK_APP_DIR}")
    add_subdirectory(${WINK_APP_DIR} ${CMAKE_BINARY_DIR}/app_build)

    # Phase 2：OLED Dashboard 示例（额外 e2e target，不改默认 App）
    add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/samples/oled_dashboard
                     ${CMAKE_BINARY_DIR}/oled_dashboard_build)

    add_subdirectory(test)
endif()
