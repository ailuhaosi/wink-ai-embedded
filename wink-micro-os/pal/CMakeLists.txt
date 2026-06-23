# PAL (Platform Abstraction Layer) Component CMake
add_library(pal STATIC)

# 暴露包含路径给其他组件使用
target_include_directories(pal PUBLIC include)

# 声明 PAL 层需要导出的头文件（主要为底层实现做桩）
target_sources(pal PRIVATE
    include/pal_hal.h
    include/pal_osal.h
)
