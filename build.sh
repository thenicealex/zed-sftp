#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$SCRIPT_DIR"
SERVER_DIR="$REPO_DIR/server"
EXTENSION_ID="$(awk -F'"' '/^id = / { print $2; exit }' "$REPO_DIR/extension.toml")"
INSTALL_AFTER_BUILD=0

if [ -z "$EXTENSION_ID" ]; then
    echo "❌ Failed to determine extension id from extension.toml"
    exit 1
fi

usage() {
    echo "Usage: ./build.sh [--install]"
}

# Source cargo environment if it exists
if [ -f "$HOME/.cargo/env" ]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
fi

require_command() {
    local command_name="$1"
    local label="$2"
    local install_hint="$3"

    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "❌ $label is not installed"
        echo ""
        echo "Please install $label first:"
        echo "  $install_hint"
        exit 1
    fi
}

resolve_zed_work_root() {
    case "$(uname -s)" in
        Darwin)
            echo "$HOME/Library/Application Support/Zed/extensions/work"
            ;;
        Linux)
            echo "${XDG_DATA_HOME:-$HOME/.local/share}/zed/extensions/work"
            ;;
        *)
            echo "❌ Unsupported platform: $(uname -s)" >&2
            exit 1
            ;;
    esac
}

install_extension() {
    local zed_work_root
    local dest

    require_command rsync "rsync" "brew install rsync"

    zed_work_root="$(resolve_zed_work_root)"
    dest="$zed_work_root/$EXTENSION_ID"

    echo ""
    echo "📂 Syncing built extension into $dest ..."
    mkdir -p "$dest"
    rsync -a --delete \
        --exclude '.git' \
        --exclude '.zed' \
        --exclude 'target' \
        "$REPO_DIR"/ "$dest"/

    echo ""
    echo "✅ Dev extension installed"
    echo ""
    echo "Next steps:"
    echo "1. Open Zed"
    echo "2. Run: zed: reload extensions"
    echo "3. Open your project and configure .zed/sftp.json"
    echo ""
    echo "Installed files:"
    echo "- $dest/extension.wasm"
    echo "- $dest/server/dist/index.js"
    echo "- $dest/server/node_modules"
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --install)
            INSTALL_AFTER_BUILD=1
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            usage
            exit 1
            ;;
    esac
    shift
done

echo "🔧 Building SFTP Extension for Zed..."
echo ""

require_command cargo "Rust" "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
echo "✅ Rust is installed ($(cargo --version))"

require_command node "Node.js" "brew install node"
echo "✅ Node.js is installed ($(node --version))"

require_command npm "npm" "brew install node"
echo "✅ npm is installed ($(npm --version))"

echo ""
echo "📦 Installing dependencies and building language server..."
(
    cd "$SERVER_DIR"
    npm install
    npm run build
)

echo ""
echo "🦀 Building Rust extension for WebAssembly..."
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

if [ ! -f "$SERVER_DIR/dist/index.js" ]; then
    echo "❌ Language server build output missing at $SERVER_DIR/dist/index.js"
    exit 1
fi

if [ ! -f "$SERVER_DIR/node_modules/vscode-languageserver/node.js" ]; then
    echo "❌ Runtime dependency missing at $SERVER_DIR/node_modules/vscode-languageserver/node.js"
    exit 1
fi

echo ""
echo "✅ Build complete!"

if [ "$INSTALL_AFTER_BUILD" -eq 1 ]; then
    install_extension
    exit 0
fi

echo ""
echo "📝 Next steps:"
echo "1. Install the dev extension:"
echo "   ./build.sh --install"
echo ""
echo "2. Open Zed and run: zed: reload extensions"
echo ""
echo "3. Create .zed/sftp.json in your project:"
echo '   {
     "host": "your-server.com",
     "username": "your-username",
     "privateKeyPath": "~/.ssh/id_rsa",
     "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint",
     "remotePath": "/var/www/html",
     "uploadOnSave": true
   }'
