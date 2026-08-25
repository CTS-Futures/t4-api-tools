# CPPDemo — Qt6 Widgets + WebSockets demo client for the T4 API.
#
# Cross-toolchain build (no Visual Studio IDE required). Works under:
#   - MSYS2 / MinGW-w64 (UCRT64): gcc + Ninja + Qt6/protobuf from pacman   -> preset "mingw"
#   - MSVC command-line (Build Tools, no IDE): cl + Ninja + Qt msvc + vcpkg -> preset "msvc"
#
# The wire-format protobuf sources are REGENERATED at build time from the
# canonical repo-root proto/ tree, so the build matches whatever protobuf
# runtime the active toolchain provides (the committed *.pb.cc are pinned to
# protobuf 29.3 via an #error and are intentionally NOT compiled here).

cmake_minimum_required(VERSION 3.20)
project(CPPDemo LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Qt code generators: moc (Q_OBJECT), uic (.ui), rcc (.qrc).
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTOUIC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Core Gui Widgets WebSockets Network)

# Prefer the protobuf CMake config package (ships protobuf_generate + the
# imported target). Fall back to module mode, which also defines both.
find_package(Protobuf CONFIG QUIET)
if(NOT Protobuf_FOUND)
  find_package(Protobuf REQUIRED)
endif()

# --- Regenerate protobuf from the canonical repo-root .proto sources -------
# tools/Cpp/CPPDemo -> ../../../proto is the repo-root proto/ import root.
set(PROTO_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../../../proto)
set(PROTO_FILES
  ${PROTO_ROOT}/t4/v1/service.proto
  ${PROTO_ROOT}/t4/v1/auth/auth.proto
  ${PROTO_ROOT}/t4/v1/account/account.proto
  ${PROTO_ROOT}/t4/v1/market/market.proto
  ${PROTO_ROOT}/t4/v1/orderrouting/orderrouting.proto
  ${PROTO_ROOT}/t4/v1/common/enums.proto
  ${PROTO_ROOT}/t4/v1/common/price.proto)

set(GEN_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)
file(MAKE_DIRECTORY ${GEN_DIR})

add_library(t4proto STATIC ${PROTO_FILES})
target_link_libraries(t4proto PUBLIC protobuf::libprotobuf)
# Generated headers are included as "t4/v1/service.pb.h", so GEN_DIR is the base.
target_include_directories(t4proto PUBLIC ${GEN_DIR})
protobuf_generate(
  TARGET t4proto
  IMPORT_DIRS ${PROTO_ROOT}
  PROTOC_OUT_DIR ${GEN_DIR})

# --- Chart decoder (dependency-free static lib in the sibling t4-cpp-api) ----
# Fetching is done with Qt's own QNetworkAccessManager, so the decoder's
# libcurl-based HTTP client stays off; we only need the core decode library.
set(T4DECODER_BUILD_TESTS  OFF CACHE BOOL "" FORCE)
set(T4DECODER_BUILD_SMOKE  OFF CACHE BOOL "" FORCE)
set(T4DECODER_BUILD_CLIENT OFF CACHE BOOL "" FORCE)
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../t4-cpp-api
                 ${CMAKE_CURRENT_BINARY_DIR}/t4decoder)

# --- Application -----------------------------------------------------------
add_executable(CPPDemo
  main.cpp
  MainWindow.cpp
  Client.cpp
  ChartWidget.cpp
  ContractPickerDialog.cpp
  ExpiryPickerDialog.cpp
  cppdemo.cpp
  cppdemo.qrc)

target_link_libraries(CPPDemo PRIVATE
  t4proto
  t4decoder
  Qt6::Core
  Qt6::Gui
  Qt6::Widgets
  Qt6::WebSockets
  Qt6::Network)

# Client::loadConfig opens "config/config.json" relative to the working dir;
# copy the config tree next to the executable so it runs from the build dir.
# The dir holds live credentials and is typically uncommitted, so this is only
# wired up when it exists (re-run cmake after creating it). See config.sample.json.
if(EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/config)
  add_custom_command(TARGET CPPDemo POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_directory
            ${CMAKE_CURRENT_SOURCE_DIR}/config $<TARGET_FILE_DIR:CPPDemo>/config)
endif()
