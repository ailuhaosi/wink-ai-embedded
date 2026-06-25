# ESP32 真机端口（仅在 ESP-IDF 环境作为 component 参与构建）。
# host/wasm 构建不包含本目录。
if(TARGET_PLATFORM STREQUAL "esp32")
    # ESP-IDF 组件化时由顶层 idf.py 接管；此处仅声明源占位。
    set(ESP32_PAL_SOURCES
        pal_hal_esp32.c
        pal_osal_esp32.c
        pal_resource_esp32.c)
    message(STATUS "esp32 target skeleton active (ESP-IDF integration pending)")
endif()
