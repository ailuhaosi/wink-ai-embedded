cmake_minimum_required(VERSION 3.16)
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(wink_esp32_firmware)

# 添加 wink-micro-os 组件
set(EXTRA_COMPONENT_DIRS "../wink-micro-os/targets/esp32")
