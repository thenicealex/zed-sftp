# SFTP Extension for Zed

SFTP sync extension for Zed, inspired by [vscode-sftp](https://github.com/Natizyskunk/vscode-sftp).

It runs a Node.js language server from a small Rust/WASM Zed extension and supports upload-on-save, manual transfers, folder sync, multiple profiles, ignore rules, and host fingerprint verification.

## Features

- Upload files automatically on save
- Upload or download individual files and folders
- Sync a local folder to a remote folder
- Support multiple server profiles
- Support SSH key or password authentication
- Respect ignore patterns such as `.git` and `node_modules`
- Restrict sync to a workspace subdirectory with `context`

## Requirements

- Zed
- Node.js 20+
- Rust with `wasm32-wasip2`

Install the Rust target if needed:

```bash
rustup target add wasm32-wasip2
```

## Install

### From source as a dev extension

```bash
git clone https://github.com/andreyc0d3r/zed-sftp
cd zed-sftp
./install-zed-dev.sh
```

Then in Zed run `zed: reload extensions`.

## Configuration

Create `.zed/sftp.json` in the workspace root:

```json
{
  "protocol": "sftp",
  "host": "example.com",
  "port": 22,
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint",
  "remotePath": "/var/www/html",
  "uploadOnSave": true,
  "ignore": [
    ".git",
    "node_modules",
    ".zed"
  ]
}
```

### Authentication

SSH key:

```json
{
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint"
}
```

Password:

```json
{
  "username": "deploy",
  "password": "your-password",
  "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint"
}
```

Get the host fingerprint with:

```bash
ssh-keyscan -t rsa,ecdsa,ed25519 example.com | ssh-keygen -lf - -E sha256
```

### Multiple profiles

```json
{
  "protocol": "sftp",
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint",
  "profiles": {
    "dev": {
      "host": "dev.example.com",
      "remotePath": "/var/www/dev"
    },
    "production": {
      "host": "prod.example.com",
      "remotePath": "/var/www/html"
    }
  },
  "defaultProfile": "dev",
  "uploadOnSave": true
}
```

### Context path

Use `context` when only part of the workspace should be synced:

```json
{
  "protocol": "sftp",
  "host": "example.com",
  "username": "deploy",
  "privateKeyPath": "~/.ssh/id_rsa",
  "hostFingerprint": "SHA256:base64-encoded-host-key-fingerprint",
  "remotePath": "/wp-content",
  "context": "site/wp-content",
  "uploadOnSave": true
}
```

With this setup, `site/wp-content/themes/style.css` maps to `/wp-content/themes/style.css`.

## Commands

Run these from the Zed command palette:

- `SFTP: Upload File`
- `SFTP: Download File`
- `SFTP: Upload Folder`
- `SFTP: Download Folder`
- `SFTP: Sync`

If `uploadOnSave` is `true`, saving a file inside the configured context uploads it automatically.

## Config Reference

| Option | Type | Notes |
| --- | --- | --- |
| `protocol` | string | Must be `sftp` |
| `host` | string | Required |
| `port` | number | Default `22` |
| `username` | string | Required |
| `password` | string | Use instead of `privateKeyPath` if needed |
| `privateKeyPath` | string | Path to SSH private key |
| `passphrase` | string | Optional key passphrase |
| `hostFingerprint` | string | Required, `SHA256:` recommended |
| `remotePath` | string | Required, must be absolute |
| `localPath` | string | Defaults to workspace root |
| `context` | string | Workspace subdirectory used as local sync root |
| `uploadOnSave` | boolean | Default `false` |
| `ignore` | string[] | Glob patterns |
| `profiles` | object | Named profile overrides |
| `defaultProfile` | string | Selected profile name |
| `connectTimeout` | number | Connection timeout in ms |
| `concurrency` | number | Reserved for transfer batching |

## Troubleshooting

### Extension loads but does nothing

- Make sure `.zed/sftp.json` exists and contains valid JSON
- Make sure `uploadOnSave` is enabled if you expect auto-upload
- Make sure the saved file is inside the configured `context`
- Check Zed logs with `zed: open log`

### Build or install issues

Rebuild everything:

```bash
./build.sh
./verify-build.sh
./install-zed-dev.sh
```

Make sure these files exist afterward:

- `extension.wasm`
- `server/dist/index.js`
- `server/node_modules/vscode-languageserver/node.js`

### Connection issues

- Confirm Node.js is installed: `node --version`
- Confirm the remote host is reachable: `ssh user@host`
- Confirm the remote path exists and is writable
- Confirm the host fingerprint matches the server

## Development

Build locally:

```bash
./build.sh
```

Manual build:

```bash
cd server
npm install
npm run build
cd ..
cargo build --target wasm32-wasip2 --release
cp target/wasm32-wasip2/release/sftp.wasm extension.wasm
```

Verify the package:

```bash
./verify-build.sh
```

Install into Zed's dev extensions directory:

```bash
./install-zed-dev.sh
```

## Current Scope

- Implemented: upload on save, manual upload/download, folder sync, multiple profiles, SSH key auth, password auth, host fingerprint verification, context path support
- Not implemented: FTP/FTPS, remote explorer, diff with remote, full filesystem watching beyond save events

## Examples

See [examples](examples) for sample configs and task files.

## License

MIT. See [LICENSE](LICENSE).
