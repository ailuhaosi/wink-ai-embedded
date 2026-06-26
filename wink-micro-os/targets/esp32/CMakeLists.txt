# ESP32 真机端口（ESP-IDF 组件模式）。
# host/wasm 构建不包含本目录。

if(TARGET_PLATFORM STREQUAL "esp32")
    if(ESP_PLATFORM)
        # ESP-IDF 环境：注册为 IDF 组件
        idf_component_register(
            SRCS
                pal_hal_esp32.c
                pal_osal_esp32.c
                pal_resource_esp32.c
                pal_hal_esp32_rmt.c
            INCLUDE_DIRS
                ../../pal/include
                ../../dal/include
                ../../runtime/include
                ../../trace/include
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
        )
    endif()
    message(STATUS "esp32 target configured (ESP-IDF integration)")
endif()
