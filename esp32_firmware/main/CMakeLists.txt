idf_component_register(
    SRCS
        "app_main.c"
        "../../wink-micro-os/samples/avoidance_car/app_callbacks.c"
        "../../wink-micro-os/samples/avoidance_car/device_tree.c"
        "../../wink-micro-os/samples/avoidance_car/board_config.c"
    INCLUDE_DIRS
        "."
        "../../wink-micro-os/samples/avoidance_car"
    REQUIRES driver esp32
)
