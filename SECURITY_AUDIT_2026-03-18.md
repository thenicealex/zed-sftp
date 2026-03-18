# Security Audit Report

Date: 2026-03-18
Project: `zed-sftp`
Audited components: `server/src/*.ts`, `src/lib.rs`, `README.md`, `ARCHITECTURE.md`, `DEVELOPMENT.md`, `examples/*`, `server/package-lock.json`

## Scope and method

- Performed a static review of the Rust launcher, the Node/TypeScript language server, and the shipped configuration examples.
- Verified live dependency advisories against the current lockfile with `npm audit --package-lock-only --omit=dev --json`.
- Verified the Rust side with `cargo test`; it completed successfully, but the crate currently contains 0 tests.
- Focused on exploitable path-boundary flaws, SSH trust configuration, secret exposure, and documentation/config drift with security impact.

## Executive summary

- High: 3
- Medium: 2
- Low / Hardening: 3

The two most important code issues are:

1. SSH host identity is never verified before establishing the SFTP session, so a machine-in-the-middle can impersonate the server.
2. The `context` setting is not constrained to stay inside the workspace, which lets a malicious repo expand file operations to parent directories.

The most important supply-chain issue is:

3. The current lockfile pins `minimatch` 10.1.1 and `@isaacs/brace-expansion` 5.0.0, both of which are currently flagged by `npm audit` for high-severity ReDoS-style resource exhaustion.

## Findings

### High

#### [H1] SSH host identity is never verified

Affected code:
- `server/src/sftp-client.ts:27-50`

Impact:
- A network attacker who can intercept the connection can present a rogue SSH server, capture credentials, and tamper with uploaded or downloaded content.
- This is especially risky because the extension supports password authentication and private-key authentication, but does not pin or verify the server identity first.

Why this is happening:
- The connection config only sets `host`, `port`, `username`, `password` or `privateKey`, and `readyTimeout`.
- It never sets `hostHash`, `hostVerifier`, a known-hosts lookup, or any equivalent host-fingerprint check before `this.client.connect(connectConfig)`.

Minimal repro idea:
- Place the client behind an active SSH MITM proxy.
- Present a different host key than the real server.
- The extension will attempt the connection anyway because no explicit host verification callback is configured.

Recommended fix:
- Add an explicit host verification feature to `SftpConfig`, such as a pinned fingerprint or known-hosts file path.
- Pass `hostHash` and `hostVerifier` through to the underlying `ssh2` client and fail closed on mismatch.
- Refuse password-based authentication unless host verification is enabled, or at minimum warn loudly and require explicit opt-in.

#### [H2] `context` can escape the workspace root and authorize operations on parent directories

Affected code:
- `server/src/config.ts:100-105`
- `server/src/config.ts:150-191`
- `server/src/index.ts:101-117`
- `server/src/sftp-client.ts:66-175`

Impact:
- A malicious workspace can commit a `.zed/sftp.json` with `"context": ".."` or `"context": "../.."`.
- Once loaded, uploads and downloads are no longer constrained to the workspace tree; files in parent directories become in-scope.
- This can exfiltrate local files outside the repo during upload flows and can overwrite files outside the repo during download flows.

Why this is happening:
- `context` is normalized with `path.join(this.workspaceFolder, context)` but is never validated to remain inside the workspace.
- `isInContext()` uses `path.normalize(...).startsWith(...)`, which is a string-prefix check, not a real containment check.
- `getRemotePath()` only rejects `..` after calling `path.relative(this.contextPath, localFilePath)`. If `contextPath` already points above the workspace, parent-directory files produce a clean relative path and are accepted.

Local proof:
- With `workspace = /tmp/workspace/app` and `context = ".."`, the effective `contextPath` becomes `/tmp/workspace`.
- A target file `/tmp/workspace/secret.txt` returns `isInContext = true`.
- `path.relative("/tmp/workspace", "/tmp/workspace/secret.txt")` is `secret.txt`, so the traversal guard never fires.

Minimal repro idea:
- Create a repo with `.zed/sftp.json` containing `"context": ".."`.
- Open the repo in Zed and run a manual download or upload against a path in the parent directory.
- The operation is treated as valid because the configured root has already moved outside the workspace.

Recommended fix:
- Resolve `workspaceFolder`, `contextPath`, and the requested path with `fs.realpathSync.native()` before comparison.
- Reject any `context` whose resolved path is not equal to the workspace root or a descendant of it.
- Replace the prefix check with a segment-aware containment check such as `path.relative(root, candidate)` and reject empty-or-upward escapes after realpath normalization.
- Apply the same realpath-based boundary check before all upload/download/folder operations.

#### [H3] The current lockfile ships vulnerable glob dependencies reachable from workspace-controlled config

Affected code and dependencies:
- `server/src/config.ts:109-140`
- `server/package-lock.json:33-43`
- `server/package-lock.json:181-195`

Impact:
- Opening a malicious repository with a crafted `.zed/sftp.json` can feed hostile glob patterns into `minimatch` during save handling.
- The current versions are flagged for high-severity uncontrolled resource consumption / ReDoS, so the language server can be stalled or pinned at high CPU by attacker-controlled configuration.

Verification:
- `npm audit --package-lock-only --omit=dev --json` reported:
  - `minimatch` 10.1.1 vulnerable to `GHSA-3ppc-4f35-3m26`, `GHSA-7r86-cg39-jmmj`, and `GHSA-23c5-xmqv-rm74`
  - `@isaacs/brace-expansion` 5.0.0 vulnerable to `GHSA-7h2j-956f-4vf2`
- `ConfigManager.shouldIgnore()` loads ignore patterns from workspace config and evaluates them on save via `minimatch(relativePath, pattern, { dot: true })`.

Recommended fix:
- Upgrade `minimatch` to a patched release at or above 10.2.3.
- Refresh the lockfile so `@isaacs/brace-expansion` resolves to a non-vulnerable release.
- Consider bounding ignore-pattern length and count before evaluating repo-supplied patterns.

### Medium

#### [M1] Raw internal errors and absolute paths are reflected into user-visible messages and logs

Affected code:
- `server/src/index.ts:84-85`
- `server/src/index.ts:120-121`
- `server/src/index.ts:175-176`
- `server/src/sftp-client.ts:55`
- `server/src/sftp-client.ts:87`
- `server/src/sftp-client.ts:113`
- `server/src/sftp-client.ts:132`
- `server/src/sftp-client.ts:156`
- `server/src/sftp-client.ts:175`
- `server/src/sftp-client.ts:186`
- `server/src/sftp-client.ts:197`

Impact:
- Absolute local paths, remote paths, hostnames, and low-level library error text can be surfaced directly to the UI and logs.
- This is not as severe as credential disclosure, but it increases accidental exposure in shared logs, screenshots, and support bundles.

Why this is happening:
- Errors are wrapped with string interpolation and then passed straight to `showErrorMessage()` and `connection.console.error(...)`.
- Upload/download success logs also include full local and remote paths.

Recommended fix:
- Replace raw error propagation with sanitized user-facing messages and structured debug logs.
- Strip or hash local absolute paths and remote paths in default logs.
- Gate detailed transport errors behind an explicit debug mode.

#### [M2] Several security-relevant config fields and documented features are silently ignored

Affected code:
- `server/src/config.ts:7-38`
- `server/src/sftp-client.ts:27-50`

Affected docs/examples:
- `README.md:173-186`
- `ARCHITECTURE.md:134-143`
- `examples/sftp-config.example.json:19-58`
- `examples/ftp-config.example.json:2-18`

Impact:
- Operators can reasonably believe they are enforcing stronger SSH algorithms, host-key preferences, keepalives, interactive auth, or FTP/FTPS behavior when the runtime ignores those settings entirely.
- This creates false assurances and makes secure deployment harder because the documented hardening knobs are not wired through.

Evidence:
- `SftpConfig` exposes `protocol`, `interactiveAuth`, `algorithms`, `keepalive`, `watcher`, and `downloadOnOpen`.
- `SftpClient.connect()` only forwards `host`, `port`, `username`, `password` or `privateKey`, and `readyTimeout`.
- The repo ships an `ftp` example and README config table entries for `ftp` / `ftps`, but the implementation uses only `ssh2-sftp-client`.

Recommended fix:
- Remove unsupported security-sensitive fields from the public config surface until they are implemented.
- Alternatively, wire them through fully and add validation that rejects unsupported combinations at load time.
- Update docs to distinguish implemented behavior from planned behavior.

### Low / Hardening

#### [L1] Documentation still normalizes plaintext passwords in repo-tracked config files

Affected docs/examples:
- `README.md:99-105`
- `DEVELOPMENT.md:143-153`
- `examples/ftp-config.example.json:6-13`

Impact:
- The docs explicitly model storing credentials in JSON under the project tree, which is easy to commit accidentally.
- This is a documentation risk rather than a direct code defect, but it materially increases secret-spillage risk for users.

Recommended fix:
- Prefer SSH keys plus host verification in all examples.
- If password auth must remain documented, move the secret source to environment variables or OS keychain guidance and add a prominent warning not to commit config files.

#### [L2] Runtime support guidance is out of sync with the shipped dependency graph

Affected docs:
- `README.md:35-39`
- `DEVELOPMENT.md:12-19`

Affected lockfile:
- `server/package-lock.json:181-191`
- `server/package-lock.json:295-307`

Impact:
- The docs claim Node.js `v18+`, but the resolved dependency graph now includes packages that declare `node: "20 || >=22"` and `node: ">=18.20.4"`.
- This mismatch can leave some users on unsupported runtimes, which makes it harder to receive security fixes reliably and increases troubleshooting ambiguity.

Recommended fix:
- Update docs and setup scripts to the strictest supported version in the lockfile.
- Add an install-time engine check instead of relying on stale documentation.

#### [L3] The Rust launcher passes the full worktree shell environment to the Node language server

Affected code:
- `src/lib.rs:31-38`

Impact:
- The language server inherits the full `worktree.shell_env()`.
- This is not an immediate exploit by itself, but it increases the blast radius of any future server-side compromise because unrelated environment secrets become available to the Node process.

Recommended fix:
- Pass an allowlist of required environment variables instead of the full shell environment.
- If the full environment is necessary for compatibility, document the tradeoff explicitly and avoid logging environment-derived values.

## Dependency status snapshot

As verified on 2026-03-18 against the current lockfile:

- `minimatch` 10.1.1: vulnerable, fix available
- `@isaacs/brace-expansion` 5.0.0: vulnerable, fix available
- `ssh2` 1.17.0: not flagged by `npm audit` in this run
- `ssh2-sftp-client` 11.0.0: not flagged by `npm audit` in this run
- `chokidar` 4.0.3: not flagged by `npm audit` in this run
- `vscode-languageserver` 9.0.1: not flagged by `npm audit` in this run

## Recommended remediation order

1. Implement fail-closed SSH host verification and add a migration path for existing configs.
2. Lock `context` to the workspace root or a descendant after realpath resolution, then add regression tests for `..`, symlinks, and sibling-prefix tricks.
3. Upgrade `minimatch` and refresh the lockfile immediately.
4. Sanitize UI/log error output and reduce path disclosure.
5. Remove or reject unsupported security-sensitive config fields until they are actually implemented.
6. Clean up the docs and examples so they no longer teach insecure defaults.

## Sources

- `npm audit --package-lock-only --omit=dev --json` run locally on 2026-03-18
- [ssh2 README](https://github.com/mscdex/ssh2/blob/master/README.md)
- [GHSA-3ppc-4f35-3m26](https://github.com/advisories/GHSA-3ppc-4f35-3m26)
- [GHSA-7r86-cg39-jmmj](https://github.com/advisories/GHSA-7r86-cg39-jmmj)
- [GHSA-23c5-xmqv-rm74](https://github.com/advisories/GHSA-23c5-xmqv-rm74)
- [GHSA-7h2j-956f-4vf2](https://github.com/advisories/GHSA-7h2j-956f-4vf2)
