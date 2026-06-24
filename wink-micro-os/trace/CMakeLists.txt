# trace (Golden Trace) —— 一等 peer 层 STATIC 库。
# 被 runtime/dal/app 消费（横切基础服务）。零动态分配。
add_library(wink_trace STATIC
    src/wink_trace.c)

target_include_directories(wink_trace PUBLIC include)
target_link_libraries(wink_trace PUBLIC pal)   # wink_status.h 等
