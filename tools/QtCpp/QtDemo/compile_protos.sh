#!/bin/bash

PROTOC=protoc
PROTO_DIR=../../../proto        # where proto/t4/... lives
OUT_DIR=$PROTO_DIR

echo "📦 Compiling all .proto files under $PROTO_DIR..."

find "$PROTO_DIR" -name "*.proto" | while read -r proto_file; do
    echo "→ $proto_file"
    $PROTOC --proto_path="$PROTO_DIR" --cpp_out="$OUT_DIR" "$proto_file"
    if [ $? -ne 0 ]; then
        echo "❌ Failed: $proto_file"
        exit 1
    fi
done

echo "✅ All .proto files compiled successfully."
