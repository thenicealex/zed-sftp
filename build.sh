#!/bin/bash

set -e

# Source cargo environment if it exists
if [ -f "$HOME/.cargo/env" ]; then
    source "$HOME/.cargo/env"
fi

echo "Building SFTP Extension for Zed..."

# Build the language server
echo "Building language server..."
cd server
npm install
npm run build
cd ..

# Build the Rust extension for WebAssembly
echo "Building Rust extension for WebAssembly..."
rustup target add wasm32-wasip2 2>/dev/null || true
cargo build --target wasm32-wasip2 --release

WASM_SOURCE="target/wasm32-wasip2/release/sftp.wasm"
if [ ! -f "$WASM_SOURCE" ]; then
    echo "Built wasm not found at $WASM_SOURCE"
    exit 1
fi

cp "$WASM_SOURCE" extension.wasm

echo "Build complete!"
echo ""
echo "To install as dev extension:"
echo "1. Open Zed"
echo "2. Open Extensions (Cmd+Shift+X)"
echo "3. Click 'Install Dev Extension'"
echo "4. Select this directory"
