#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
EXTENSION_ID="$(awk -F'"' '/^id = / { print $2; exit }' "$REPO_DIR/extension.toml")"

if [ -z "$EXTENSION_ID" ]; then
    echo "❌ Failed to determine extension id from extension.toml"
    exit 1
fi

if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
fi

case "$(uname -s)" in
    Darwin)
        ZED_WORK_ROOT="$HOME/Library/Application Support/Zed/extensions/work"
        ;;
    Linux)
        ZED_WORK_ROOT="${XDG_DATA_HOME:-$HOME/.local/share}/zed/extensions/work"
        ;;
    *)
        echo "❌ Unsupported platform: $(uname -s)"
        exit 1
        ;;
esac

DEST="$ZED_WORK_ROOT/$EXTENSION_ID"

echo "🔧 Installing $EXTENSION_ID into Zed dev extensions..."
echo ""

if ! command -v cargo >/dev/null 2>&1; then
    echo "❌ cargo is not installed"
    exit 1
fi

if ! command -v node >/dev/null 2>&1; then
    echo "❌ node is not installed"
    exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
    echo "❌ npm is not installed"
    exit 1
fi

echo "📦 Installing and building language server..."
(
    cd "$REPO_DIR/server"
    npm install
    npm run build
)

echo ""
echo "🦀 Building WebAssembly extension..."
rustup target add wasm32-wasip2 2>/dev/null || true
(
    cd "$REPO_DIR"
    cargo build --target wasm32-wasip2 --release
)

WASM_SOURCE="$REPO_DIR/target/wasm32-wasip2/release/$EXTENSION_ID.wasm"
if [ ! -f "$WASM_SOURCE" ]; then
    echo "❌ Built wasm not found at $WASM_SOURCE"
    exit 1
fi

cp "$WASM_SOURCE" "$REPO_DIR/extension.wasm"

if [ ! -f "$REPO_DIR/server/dist/index.js" ]; then
    echo "❌ Language server build output missing at $REPO_DIR/server/dist/index.js"
    exit 1
fi

if [ ! -f "$REPO_DIR/server/node_modules/vscode-languageserver/node.js" ]; then
    echo "❌ Runtime dependency missing at $REPO_DIR/server/node_modules/vscode-languageserver/node.js"
    exit 1
fi

echo ""
echo "📂 Syncing built extension into $DEST ..."
mkdir -p "$DEST"
rsync -a --delete \
    --exclude '.git' \
    --exclude '.zed' \
    --exclude 'target' \
    "$REPO_DIR"/ "$DEST"/

echo ""
echo "✅ Dev extension installed"
echo ""
echo "Next steps:"
echo "1. Open Zed"
echo "2. Run: zed: reload extensions"
echo "3. Open your project and configure .zed/sftp.json"
echo ""
echo "Installed files:"
echo "- $DEST/extension.wasm"
echo "- $DEST/server/dist/index.js"
echo "- $DEST/server/node_modules"
