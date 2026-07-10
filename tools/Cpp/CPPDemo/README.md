# CPPDemo

Qt6 Widgets demo client for the T4 API — login, market data, order routing, and
a live candlestick chart. Talks to the T4 gateway over WebSocket + REST, decodes
the binary chart feed with the sibling [`t4-cpp-api`](../t4-cpp-api) decoder, and
renders it with a custom `ChartWidget`.

Builds from the command line with **no Visual Studio IDE required**.

## Prerequisites

- A C++17 compiler and **CMake ≥ 3.20**
- **Qt6** — components `Core Gui Widgets WebSockets Network`
- **Protobuf** (the `protoc` compiler + runtime) — the wire-format sources are
  regenerated at build time from the repo-root [`proto/`](../../../proto) tree, so
  the build always matches your installed protobuf runtime.

Pick one toolchain:

- **MSYS2 / MinGW-w64 (UCRT64)** — install with pacman:
  ```sh
  pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake \
            mingw-w64-ucrt-x86_64-ninja mingw-w64-ucrt-x86_64-qt6 \
            mingw-w64-ucrt-x86_64-protobuf
  ```
- **MSVC command-line** (Build Tools, no IDE) — Qt for MSVC + vcpkg providing
  protobuf.

## Configure credentials

The app loads **`config/config.json`** relative to its working directory. That
file holds live credentials and is intentionally not committed — create it from
the sample:

```sh
mkdir -p config
cp config.sample.json config/config.json
# then edit config/config.json with your firm / username / password / app license
```

`CMakeLists.txt` copies the `config/` directory next to the built executable, but
only if it exists at configure time — so create it **before** running cmake (or
re-run cmake afterward).

## Build & run

Presets live in `CMakePresets.json`. **Edit the toolchain paths in that file to
match your machine** (`CMAKE_PREFIX_PATH` for Qt, and for MSVC the vcpkg
toolchain file) before configuring.

MinGW (run from a UCRT64 shell, or with `C:/msys64/ucrt64/bin` on `PATH`):

```sh
cd tools/Cpp/CPPDemo
cmake --preset mingw
cmake --build --preset mingw
./build/mingw/CPPDemo
```

MSVC (run from an "x64 Native Tools" prompt):

```sh
cd tools/Cpp/CPPDemo
cmake --preset msvc
cmake --build --preset msvc
./build/msvc/CPPDemo
```

The executable runs from its build directory so it can find the copied `config/`
tree.

## Notes

- The committed `addressbook.pb.*` are legacy protobuf samples pinned to
  protobuf 29.3 and are **not** compiled — the real messages come from the
  regenerated `proto/` sources.
- The chart decoder is pulled in as a dependency-free static lib via
  `add_subdirectory(../t4-cpp-api)`; its libcurl-based HTTP client is disabled
  here because CPPDemo fetches chart data with Qt's own networking.
