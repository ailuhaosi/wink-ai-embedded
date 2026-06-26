idf_component_register(
    SRCS
        "app_main.c"
        "../../wink-micro-os/samples/avoidance_car/app_main.c"
        "../../wink-micro-os/samples/avoidance_car/device_tree.c"
    INCLUDE_DIRS
        "."
        "../../wink-micro-os/samples/avoidance_car"
    REQUIRES driver esp32
)
