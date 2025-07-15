cmake_minimum_required(VERSION 3.19)
project(QtDemo LANGUAGES CXX)

find_package(Qt6 6.5 REQUIRED COMPONENTS Core Widgets Protobuf WebSockets Network)


qt_standard_project_setup()

qt_add_executable(untitled
    WIN32 MACOSX_BUNDLE
    main.cpp
    mainwindow.cpp
    mainwindow.h
    mainwindow.ui
    client.cpp
    client.h
    t4/v1/service.pb.cc
    t4/v1/service.pb.h
    t4/v1/account/account.pb.cc
    t4/v1/account/account.pb.h
    t4/v1/auth/auth.pb.cc
    t4/v1/auth/auth.pb.h
    t4/v1/common/enums.pb.cc
    t4/v1/common/enums.pb.h
    t4/v1/common/price.pb.cc
    t4/v1/common/price.pb.h
    t4/v1/market/market.pb.cc
    t4/v1/market/market.pb.h
    t4/v1/orderrouting/orderrouting.pb.cc
    t4/v1/orderrouting/orderrouting.pb.h

)
target_include_directories(untitled PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}      # ✅ So includes like 't4/v1/...' work
)


target_link_libraries(untitled
    PRIVATE
        Qt::Core
        Qt::Widgets
        Qt::Protobuf
        Qt::WebSockets       # ✅ this is the correct module name
        Qt::Network
)

include(GNUInstallDirs)

install(TARGETS untitled
    BUNDLE  DESTINATION .
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
)

qt_generate_deploy_app_script(
    TARGET untitled
    OUTPUT_SCRIPT deploy_script
    NO_UNSUPPORTED_PLATFORM_ERROR
)
install(SCRIPT ${deploy_script})

set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)

