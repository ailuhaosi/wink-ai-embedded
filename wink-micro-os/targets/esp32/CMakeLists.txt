# ESP32 真机端口（ESP-IDF 组件模式）。
# host/wasm 构建不包含本目录。

# 引用核心源文件列表（DRY，避免重复硬编码）
if(NOT WINK_MICRO_OS_ROOT)
    set(WINK_MICRO_OS_ROOT ${CMAKE_CURRENT_LIST_DIR}/../..)
endif()
include(${WINK_MICRO_OS_ROOT}/core_sources.cmake)

# IDF 组件上下文判定：ESP_PLATFORM 由 ESP-IDF 在组件处理时定义，是"当前正作为 IDF 组件被构建"
# 的可靠信号。原门控 if(TARGET_PLATFORM STREQUAL "esp32") 依赖调用方在根 CMakeLists 设置
# TARGET_PLATFORM，但 IDF 组件在独立作用域内处理，未必继承该 cache 变量，导致组件静默不注册
# （现象：组件不出现在 Components 列表、app_main 找不到 wink 头文件）。改用 ESP_PLATFORM 判定。
if(ESP_PLATFORM)
    # ESP-IDF 环境：注册为 IDF 组件
    idf_component_register(
        SRCS
            # ESP32 PAL 实现
            pal_hal_esp32.c
            pal_osal_esp32.c
            pal_resource_esp32.c
            pal_hal_esp32_rmt.c
            ${WINK_MICRO_OS_ROOT}/pal/src/pal_pwm_router.c
            # 核心共享源文件（来自 core_sources.cmake）
            ${WINK_CORE_SOURCES}
        INCLUDE_DIRS
            ${WINK_CORE_INCLUDE_DIRS}
        REQUIRES
            # ESP-IDF v6.x: driver was split into fine-grained components
            # v5.x uses 'driver' monolith; v6.x requires esp_driver_*
            driver
            esp_driver_gpio
            esp_driver_rmt
            esp_driver_ledc
            esp_driver_i2c
            esp_timer
            esp_system
    )
    # 输出组件库目标
    set(ESP32_PAL_LIB ${COMPONENT_LIB} CACHE INTERNAL "")
    message(STATUS "wink esp32 target registered as IDF component")
elseif(TARGET_PLATFORM STREQUAL "esp32")
    # 非 ESP-IDF 环境：仅声明源文件（供静态分析）
    set(ESP32_PAL_SOURCES
        pal_hal_esp32.c
        pal_osal_esp32.c
        pal_resource_esp32.c
        pal_hal_esp32_rmt.c
        ${WINK_MICRO_OS_ROOT}/pal/src/pal_pwm_router.c
        ${WINK_CORE_SOURCES}
    )
    message(STATUS "wink esp32 target configured (static analysis)")
endif()
