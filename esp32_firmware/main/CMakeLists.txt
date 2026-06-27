idf_component_register(
    SRCS
        "app_main.c"
        "../../wink-micro-os/samples/devkitc_smoke/app_callbacks.c"
        "../../wink-micro-os/samples/devkitc_smoke/device_tree.c"
        "../../wink-micro-os/samples/devkitc_smoke/board_config.c"
    INCLUDE_DIRS
        "."
        "../../wink-micro-os/samples/devkitc_smoke"
    REQUIRES driver esp32
)
