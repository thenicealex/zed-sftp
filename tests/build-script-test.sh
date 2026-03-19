#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_SCRIPT="$ROOT_DIR/build.sh"
CORE_PATH="/usr/bin:/bin"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

assert_contains() {
    local haystack="$1"
    local needle="$2"

    if [[ "$haystack" != *"$needle"* ]]; then
        fail "expected output to contain: $needle"
    fi
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"

    if [[ "$haystack" == *"$needle"* ]]; then
        fail "expected output not to contain: $needle"
    fi
}

make_fake_repo() {
    local repo_dir="$1"

    mkdir -p "$repo_dir/server"
    cp "$BUILD_SCRIPT" "$repo_dir/build.sh"
    cat <<'EOF' > "$repo_dir/extension.toml"
id = "sftp"
name = "SFTP"
EOF
}

write_fake_command() {
    local bin_dir="$1"
    local name="$2"
    local body="$3"

    cat <<EOF > "$bin_dir/$name"
#!/bin/bash
set -euo pipefail
$body
EOF
    chmod +x "$bin_dir/$name"
}

test_reports_missing_node() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    make_fake_repo "$temp_dir/repo"
    mkdir -p "$temp_dir/bin"

    write_fake_command "$temp_dir/bin" cargo 'echo "cargo 1.0.0"'
    write_fake_command "$temp_dir/bin" npm 'echo "npm 1.0.0"'

    local output
    set +e
    output="$(
        PATH="$temp_dir/bin:$CORE_PATH" HOME="$temp_dir/home" \
        "$temp_dir/repo/build.sh" 2>&1
    )"
    local status=$?
    set -e

    if [[ $status -eq 0 ]]; then
        fail "build.sh should fail when node is missing"
    fi

    assert_contains "$output" "Node.js is not installed"
}

test_builds_extension_artifacts() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    make_fake_repo "$temp_dir/repo"
    mkdir -p "$temp_dir/bin" "$temp_dir/home"

    write_fake_command "$temp_dir/bin" cargo '
if [[ "${1:-}" == "--version" ]]; then
    echo "cargo 1.0.0"
    exit 0
fi

if [[ "${1:-}" == "build" ]]; then
    mkdir -p target/wasm32-wasip2/release
    printf "wasm" > target/wasm32-wasip2/release/sftp.wasm
    exit 0
fi

echo "unexpected cargo args: $*" >&2
exit 1
'
    write_fake_command "$temp_dir/bin" rustup 'exit 0'
    write_fake_command "$temp_dir/bin" node 'echo "v20.0.0"'
    write_fake_command "$temp_dir/bin" npm '
if [[ "${1:-}" == "--version" ]]; then
    echo "10.0.0"
    exit 0
fi

if [[ "${1:-}" == "install" ]]; then
    mkdir -p node_modules/vscode-languageserver
    printf "runtime" > node_modules/vscode-languageserver/node.js
    exit 0
fi

if [[ "${1:-}" == "run" && "${2:-}" == "build" ]]; then
    mkdir -p dist
    printf "server build" > dist/index.js
    exit 0
fi

echo "unexpected npm args: $*" >&2
exit 1
'

    PATH="$temp_dir/bin:$CORE_PATH" HOME="$temp_dir/home" "$temp_dir/repo/build.sh" >/dev/null 2>&1

    [[ -f "$temp_dir/repo/extension.wasm" ]] || fail "expected extension.wasm to be created"
    [[ -f "$temp_dir/repo/server/dist/index.js" ]] || fail "expected language server output to be created"
}

test_points_to_install_flag() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    make_fake_repo "$temp_dir/repo"
    mkdir -p "$temp_dir/bin" "$temp_dir/home"

    write_fake_command "$temp_dir/bin" cargo '
if [[ "${1:-}" == "--version" ]]; then
    echo "cargo 1.0.0"
    exit 0
fi

if [[ "${1:-}" == "build" ]]; then
    mkdir -p target/wasm32-wasip2/release
    printf "wasm" > target/wasm32-wasip2/release/sftp.wasm
    exit 0
fi

echo "unexpected cargo args: $*" >&2
exit 1
'
    write_fake_command "$temp_dir/bin" rustup 'exit 0'
    write_fake_command "$temp_dir/bin" node 'echo "v20.0.0"'
    write_fake_command "$temp_dir/bin" npm '
if [[ "${1:-}" == "--version" ]]; then
    echo "10.0.0"
    exit 0
fi

if [[ "${1:-}" == "install" ]]; then
    mkdir -p node_modules/vscode-languageserver
    printf "runtime" > node_modules/vscode-languageserver/node.js
    exit 0
fi

if [[ "${1:-}" == "run" && "${2:-}" == "build" ]]; then
    mkdir -p dist
    printf "server build" > dist/index.js
    exit 0
fi

echo "unexpected npm args: $*" >&2
exit 1
'

    local output
    output="$(
        PATH="$temp_dir/bin:$CORE_PATH" HOME="$temp_dir/home" "$temp_dir/repo/build.sh" 2>&1
    )"

    assert_contains "$output" "./build.sh --install"
    assert_not_contains "$output" "./install-zed-dev.sh"
}

test_install_flag_syncs_extension_into_zed_dir() {
    local temp_dir
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN

    make_fake_repo "$temp_dir/repo"
    mkdir -p "$temp_dir/bin" "$temp_dir/home"

    write_fake_command "$temp_dir/bin" cargo '
if [[ "${1:-}" == "--version" ]]; then
    echo "cargo 1.0.0"
    exit 0
fi

if [[ "${1:-}" == "build" ]]; then
    mkdir -p target/wasm32-wasip2/release
    printf "wasm" > target/wasm32-wasip2/release/sftp.wasm
    exit 0
fi

echo "unexpected cargo args: $*" >&2
exit 1
'
    write_fake_command "$temp_dir/bin" rustup 'exit 0'
    write_fake_command "$temp_dir/bin" node 'echo "v20.0.0"'
    write_fake_command "$temp_dir/bin" npm '
if [[ "${1:-}" == "--version" ]]; then
    echo "10.0.0"
    exit 0
fi

if [[ "${1:-}" == "install" ]]; then
    mkdir -p node_modules/vscode-languageserver
    printf "runtime" > node_modules/vscode-languageserver/node.js
    exit 0
fi

if [[ "${1:-}" == "run" && "${2:-}" == "build" ]]; then
    mkdir -p dist
    printf "server build" > dist/index.js
    exit 0
fi

echo "unexpected npm args: $*" >&2
exit 1
'

    PATH="$temp_dir/bin:$CORE_PATH" HOME="$temp_dir/home" "$temp_dir/repo/build.sh" --install >/dev/null 2>&1

    [[ -f "$temp_dir/home/Library/Application Support/Zed/extensions/work/sftp/extension.wasm" ]] || fail "expected extension.wasm to be installed into Zed work dir"
    [[ -f "$temp_dir/home/Library/Application Support/Zed/extensions/work/sftp/server/dist/index.js" ]] || fail "expected language server output to be installed into Zed work dir"
    [[ -f "$temp_dir/home/Library/Application Support/Zed/extensions/work/sftp/server/node_modules/vscode-languageserver/node.js" ]] || fail "expected runtime dependency to be installed into Zed work dir"
}

test_reports_missing_node
test_builds_extension_artifacts
test_points_to_install_flag
test_install_flag_syncs_extension_into_zed_dir

echo "build-script tests passed"
