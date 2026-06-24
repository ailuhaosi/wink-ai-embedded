# wink-micro-os host unit tests (PC gcc, no ESP-IDF, no Emscripten)
# 范式迁移自 chigo-micro/project/embedded/sim/test/CMakeLists.txt

set(UNITY_DIR ${CMAKE_CURRENT_SOURCE_DIR}/unity)

set(HOST_PAL_OBJECT $<TARGET_OBJECTS:pal_host>)

# Unity 是 vendor 代码，豁免严格警告（vendor 的无害 warning 不应阻塞测试构建）
set_source_files_properties(${UNITY_DIR}/unity.c PROPERTIES COMPILE_FLAGS "-w")

# 通用 host 测试：仅链 pal(INTERFACE,仅头) + Unity。
# Plan 3 起会在此扩展链接 targets/host；Plan 4 扩展 add_wink_test_sim。
function(add_wink_test name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
    target_link_libraries(${name} PRIVATE pal)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_test(test_smoke test_smoke.c)

add_wink_test(test_trace test_trace.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c)

# 链接 targets/host（完整 PAL）的测试
function(add_wink_host_test name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${HOST_PAL_OBJECT}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_host_test(test_runtime test_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/src/wink_runtime.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../trace/src/wink_trace.c)

add_wink_host_test(test_host_pal test_host_pal.c)

set(DAL_SRCS
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_ultrasonic.c
    ${CMAKE_CURRENT_SOURCE_DIR}/../dal/src/dal_servo.c)

add_wink_host_test(test_dal_servo test_dal_servo.c ${DAL_SRCS})

add_wink_host_test(test_dal_ultrasonic test_dal_ultrasonic.c ${DAL_SRCS})

# 仿真分支（-DSIMULATION）测试：验证 ADR-0003 决策2 两端同源在仿真侧确被走到。
function(add_wink_test_sim name src)
    add_executable(${name}
        ${src}
        ${UNITY_DIR}/unity.c
        ${CMAKE_CURRENT_SOURCE_DIR}/stubs/js_sim_host_stub.c
        ${HOST_PAL_OBJECT}
        ${DAL_SRCS}
        ${ARGN})
    target_include_directories(${name} PRIVATE
        ${UNITY_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/stubs
        ${CMAKE_CURRENT_SOURCE_DIR}/../pal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../dal/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../targets/wasm     # wasm_bridge.h（dal SIMULATION 分支引用）
        ${CMAKE_CURRENT_SOURCE_DIR}/../trace/include
        ${CMAKE_CURRENT_SOURCE_DIR}/../runtime/include)
    target_compile_definitions(${name} PRIVATE SIMULATION=1)
    target_compile_options(${name} PRIVATE -Wall -Wextra -Werror -Wno-unused-parameter)
    add_test(NAME ${name} COMMAND ${name})
endfunction()

add_wink_test_sim(test_dal_ultrasonic_sim test_dal_ultrasonic_sim.c)

add_custom_target(check
    COMMAND ${CMAKE_CTEST_COMMAND} --output-on-failure
    WORKING_DIRECTORY ${CMAKE_BINARY_DIR}
)
