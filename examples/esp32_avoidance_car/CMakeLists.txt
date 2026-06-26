# ESP-IDF 示例项目：avoidance_car
# 使用方法：
#   1. 安装 ESP-IDF v5.x (https://docs.espressif.com/projects/esp-idf/zh_CN/latest/esp32/get-started/)
#   2. 执行 `export.ps1` (Windows) 或 `. ./export.sh` (Linux/macOS)
#   3. 执行 `idf.py set-target esp32`
#   4. 执行 `idf.py build`
#   5. 执行 `idf.py -p COMx flash monitor` 烧录并监控

cmake_minimum_required(VERSION 3.16)

include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(esp32_avoidance_car)
