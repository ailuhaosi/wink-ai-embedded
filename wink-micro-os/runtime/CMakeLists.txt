# runtime (OS 运行时) —— STATIC 库，回调注入主循环。
add_library(wink_runtime STATIC
    src/wink_runtime.c)

target_include_directories(wink_runtime PUBLIC include)
target_link_libraries(wink_runtime PUBLIC pal wink_trace)   # pal: OSAL; wink_trace: fault 上报
