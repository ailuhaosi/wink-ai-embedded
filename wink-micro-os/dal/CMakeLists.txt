# DAL (Device Abstraction Layer) Component CMake
add_library(dal STATIC)

# 暴露包含路径给其他组件使用
target_include_directories(dal PUBLIC include)

# DAL 依赖 PAL
target_link_libraries(dal PUBLIC pal)

# 声明 DAL 层的源文件
target_sources(dal PRIVATE
    include/dal_ultrasonic.h
    include/dal_servo.h
    include/dal_led.h
    include/dal_button.h
    include/dal_ssd1306.h
    src/dal_ultrasonic.c
    src/dal_servo.c
    src/dal_led.c
    src/dal_button.c
    src/dal_ssd1306.c
)
