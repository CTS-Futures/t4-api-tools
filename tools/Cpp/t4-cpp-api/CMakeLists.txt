# t4decoder — dependency-free C++ port of the T4 chart-data decoder.
#
# Ports the Java original (com.t4login.* in t4-java-api), cross-checked against
# the Python (t4-pythonConversion-api) and JavaScript (t4-javascript-api) ports.
#
# Produces:
#   - t4decoder        : static library (the decoder; no Qt, no Boost, no protobuf)
#   - t4decoder_tests  : unit-test runner (built when T4DECODER_BUILD_TESTS=ON)
#   - t4decoder_smoke  : console tool that decodes a stream to CSV (Phase 6)
#
# The HTTP ChartClient (Phase 5) is the only piece that needs external deps
# (cpp-httplib + OpenSSL); it is gated behind T4DECODER_BUILD_CLIENT so the
# core library and tests build with nothing but a C++17 compiler.

cmake_minimum_required(VERSION 3.16)
project(t4decoder LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

option(T4DECODER_BUILD_TESTS  "Build unit tests"        ON)
option(T4DECODER_BUILD_SMOKE  "Build the smoke CLI"     ON)
option(T4DECODER_BUILD_CLIENT "Build the HTTP client"   OFF)

# --- Core library ----------------------------------------------------------
add_library(t4decoder STATIC
  src/big_int.cpp
  src/decimal.cpp
  src/encoding.cpp
  src/n_date_time.cpp
  src/price.cpp
  src/chart_format.cpp
  src/message_reader.cpp
  src/chart_data_stream_reader_aggr.cpp
  src/chart_data_stream_reader.cpp
  src/payload.cpp
)
target_include_directories(t4decoder PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(MSVC)
  target_compile_options(t4decoder PRIVATE /W4 /permissive-)
else()
  target_compile_options(t4decoder PRIVATE -Wall -Wextra)
endif()

# --- HTTP ChartClient (optional; needs libcurl) ----------------------------
# The plan's first choice was cpp-httplib, but it isn't packaged for MSYS2;
# libcurl is the de-facto standard C++ HTTP client and is already available.
if(T4DECODER_BUILD_CLIENT)
  find_package(CURL REQUIRED)
  target_sources(t4decoder PRIVATE src/chart_client.cpp)
  target_link_libraries(t4decoder PUBLIC CURL::libcurl)

  add_executable(t4decoder_fetch smoke/fetch_main.cpp)
  target_link_libraries(t4decoder_fetch PRIVATE t4decoder)
endif()

# --- Tests -----------------------------------------------------------------
if(T4DECODER_BUILD_TESTS)
  enable_testing()
  add_executable(t4decoder_tests
    tests/test_main.cpp
    tests/test_encoding.cpp
    tests/test_domain.cpp
    tests/test_aggr.cpp
    tests/test_reader.cpp
    tests/test_payload.cpp
  )
  target_link_libraries(t4decoder_tests PRIVATE t4decoder)
  target_include_directories(t4decoder_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
  target_compile_definitions(t4decoder_tests PRIVATE
    T4_FIXTURE_DIR="${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
  add_test(NAME t4decoder_tests COMMAND t4decoder_tests)
endif()

# --- Smoke CLI -------------------------------------------------------------
# (added in Phase 6; guarded so the project configures cleanly before then)
if(T4DECODER_BUILD_SMOKE AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/smoke/main.cpp)
  add_executable(t4decoder_smoke smoke/main.cpp)
  target_link_libraries(t4decoder_smoke PRIVATE t4decoder)
endif()
