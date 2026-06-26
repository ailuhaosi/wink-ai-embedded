# ESP32 真机端口（ESP-IDF 组件模式）。
# host/wasm 构建不包含本目录。

# 引用核心源文件列表（DRY，避免重复硬编码）
if(NOT WINK_MICRO_OS_ROOT)
    set(WINK_MICRO_OS_ROOT ${CMAKE_CURRENT_LIST_DIR}/../..)
endif()
include(${WINK_MICRO_OS_ROOT}/core_sources.cmake)

if(TARGET_PLATFORM STREQUAL "esp32")
    if(ESP_PLATFORM)
        # ESP-IDF 环境：注册为 IDF 组件
        idf_component_register(
            SRCS
                # ESP32 PAL 实现
                pal_hal_esp32.c
                pal_osal_esp32.c
                pal_resource_esp32.c
                pal_hal_esp32_rmt.c
                # 核心共享源文件（来自 core_sources.cmake）
                ${WINK_CORE_SOURCES}
            INCLUDE_DIRS
                ${WINK_CORE_INCLUDE_DIRS}
            REQUIRES
                driver
        )
        # 输出组件库目标
        set(ESP32_PAL_LIB ${COMPONENT_LIB} CACHE INTERNAL "")
    else()
        # 非 ESP-IDF 环境：仅声明源文件（供静态分析）
        set(ESP32_PAL_SOURCES
            pal_hal_esp32.c
            pal_osal_esp32.c
            pal_resource_esp32.c
            pal_hal_esp32_rmt.c
            ${WINK_CORE_SOURCES}
        )
    endif()
    message(STATUS "esp32 target configured (ESP-IDF integration)")
endif()
