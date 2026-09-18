# 🧬 Proto Compilation Guide

This folder contains Protocol Buffer (`.proto`) files organized by package and
version under the `t4/v1/` and `t4/v2/` structures.

Use this guide to compile the proto definitions into your desired target language (C++, Python, Go, etc.) using `protoc`.

---

## 📁 Folder Layout

```
proto/
├── README.md
├── protos.txt         # List of all .proto files to compile
└── t4/
    ├── v1/
    │   ├── service.proto
    │   ├── account/
    │   ├── auth/
    │   ├── common/
    │   ├── market/
    │   └── orderrouting/
    └── v2/
        ├── service.proto
        ├── account/
        │   └── account.proto
        ├── auth/
        │   └── auth.proto
        ├── common/
        │   ├── enums.proto
        │   └── price.proto
        ├── market/
        │   └── market.proto
        └── orderrouting/
            └── orderrouting.proto
```

- Packages in `.proto` files (e.g. `package t4proto.v2.account`) mirror the folder layout.
- `protos.txt` contains paths to all `.proto` files for batch compilation.

---

## ⚙️ Step 1: Download protoc (if you haven't already)

This will allow you to compile the proto files. 
**macOS (Homebrew):**
  ```bash
  brew install protobuf
  ```

- **Ubuntu / Debian:**
  ```bash
  sudo apt-get install -y protobuf-compiler
  ```

- **Windows:**
  1. Download the latest release from [https://github.com/protocolbuffers/protobuf/releases](https://github.com/protocolbuffers/protobuf/releases)
  2. Unzip and add the `bin/` directory to your system PATH.

> To verify installation:
```bash
protoc --version
```

## 🚀 Step 2: Compile to Your Target Language

Run the following from the `proto/` directory. The protos.txt file contains all the necessary paths allowing you to compile all necessary .proto files at once.

### ➤ Compile to C++

```bash
protoc --proto_path=. --cpp_out=[insert path to your desired location] @protos.txt
```

### ➤ Compile to Python

```bash
protoc --proto_path=. --python_out=[insert path to your desired location] @protos.txt
```

> Optional: Add `--go_opt=paths=source_relative` if needed.

### ➤ Compile to Java

```bash
protoc --proto_path=. --java_out=[insert path to your desired location] @protos.txt
```

### ➤ Compile to TypeScript (with `ts-protoc-gen`)

Install the plugin:

```bash
npm install -g ts-protoc-gen
```

Then compile:

```bash
protoc --proto_path=. \
  --js_out=import_style=commonjs,binary:../tools/TS/proto \
  --ts_out=../tools/TS/proto \
  @protos.txt
```

---
### ➤ example compilation in python

```bash
protoc --proto_path=. --python_out=../tools/Python/PyDemo/proto @protos.txt
```

## ✅ Output Expectations

The generated files will appear under the specified path

## 🧩 Notes

- Keep folder structure consistent with `package` declarations.
- Make sure the relevant language runtime libraries are installed (e.g. `protobuf` for Python, `protobuf-java`, `protoc-gen-go`, etc.).
