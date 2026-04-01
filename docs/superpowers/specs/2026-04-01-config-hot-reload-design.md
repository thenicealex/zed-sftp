# Config Hot Reload Design

## Summary

Add true hot reload for SFTP configuration in the long-lived language server. When the active config file is created, modified, replaced, or deleted, the plugin should detect the change immediately, tear down the old SFTP connection, and transition to the new runtime state without requiring a Zed reload.

The plugin will not keep using the last known good configuration after an invalid edit. If the config becomes invalid, automatic upload and language-server-backed commands stop until the file is fixed.

Slash commands remain process-local and stateless. They already reload config on each invocation and do not need watcher-based hot reload.

## Current Behavior

The language server loads config once during `onInitialized`, creates one `ConfigManager`, and creates one `SftpClient`. On save, it calls `loadConfig()` again, but keeps using the original `SftpClient` instance and its original connection settings.

This means edits to connection-oriented settings such as `host`, `username`, `remotePath`, `context`, `proxy`, or `hostFingerprint` are not fully hot-applied in the long-lived language server. In practice, users may need to reload the extension to ensure the runtime matches the current config file.

## Goals

- Apply config changes without reloading Zed or the extension.
- Detect config changes immediately after file-system events, not only before the next transfer.
- Tear down the old SFTP connection as soon as a new valid config is adopted.
- Tear down the old SFTP connection as soon as the config becomes invalid or disappears.
- Expose explicit runtime states for `ready`, `invalid`, and `unconfigured`.
- Keep slash command behavior unchanged except that it continues to read the latest config on every run.

## Non-Goals

- Preserve in-flight transfers during config switches.
- Fall back to the last valid config after an invalid edit.
- Add new user-facing commands for manual reload.
- Implement currently unused config options such as `downloadOnOpen`, `watcher`, `keepalive`, `algorithms`, `interactiveAuth`, or `concurrency`.

## Requirements

### Functional

- Watch the effective config priority chain:
  - `.zed/sftp.json`
  - `.vscode/sftp.json`
  - `sftp.json`
- React to:
  - file content changes
  - file creation
  - file deletion
  - higher-priority config files appearing later
  - `.zed` or `.vscode` directories being created or removed
- When config changes:
  - re-evaluate which config path is active
  - re-parse using a fresh `ConfigManager`
  - close the old client before adopting the new runtime
- If config becomes invalid:
  - close the old client immediately
  - disable auto-upload
  - fail language-server-backed commands with a clear error
- If no config exists:
  - close the old client immediately
  - disable auto-upload
  - fail language-server-backed commands with a clear "not configured" error

### Operational

- Avoid duplicate reloads during a single save by using a short debounce window.
- Serialize refresh operations so overlapping file-system events do not race each other.
- Keep implementation localized to the language server runtime and avoid spreading lifecycle logic across save handlers and command handlers.

## Proposed Design

### Runtime State Model

Replace the current ad hoc globals with a runtime manager that owns configuration state and watcher lifecycle.

```ts
type RuntimeState =
  | { kind: "unconfigured" }
  | { kind: "invalid"; configPath: string | null; error: string }
  | {
      kind: "ready";
      configPath: string;
      configDigest: string;
      configManager: ConfigManager;
      client: SftpClient;
    };
```

The manager is responsible for:

- resolving the active config path by priority
- loading and validating config with a fresh `ConfigManager`
- switching runtime state
- closing the previous client during transitions
- surfacing state-dependent errors to save handlers and command handlers
- managing all file watchers

### Active Config Resolution

Add a helper that resolves the effective config path without parsing file contents:

1. `workspace/.zed/sftp.json`
2. `workspace/.vscode/sftp.json`
3. `workspace/sftp.json`
4. otherwise `null`

This path resolution runs during startup and every watcher-triggered refresh.

### Watcher Topology

Use `fs.watch` from the language server process and maintain watchers for:

- the workspace root
- `.zed` if present
- `.vscode` if present

The root watcher covers:

- root-level `sftp.json`
- creation or removal of `.zed`
- creation or removal of `.vscode`

Directory watchers cover:

- `.zed/sftp.json`
- `.vscode/sftp.json`

Watcher callbacks do not reload immediately. They schedule a debounced refresh. Every refresh also re-evaluates which watchers should exist so the system adapts when `.zed` or `.vscode` directories are created later.

### Refresh Flow

`refreshRuntime()` performs the full state transition:

1. Resolve the currently active config path.
2. If no config path exists:
   - close the old client
   - switch to `unconfigured`
   - update watchers
   - return
3. Create a fresh `ConfigManager` and call `loadConfig()`.
4. If parsing or validation fails:
   - close the old client
   - switch to `invalid`
   - update watchers
   - emit an error message
   - return
5. Compute a stable digest from the effective config payload plus the active config path.
6. If the current state is already `ready` and both `configPath` and `configDigest` are unchanged:
   - keep the existing client
   - update watchers
   - return
7. Otherwise:
   - close the old client
   - create a new `SftpClient`
   - switch to `ready`
   - update watchers
   - log the applied config change

### Config Digest

The digest only needs to detect semantic changes for reload decisions. A JSON string of the parsed config with sorted keys is sufficient.

Inputs to the digest:

- active config path
- parsed effective config after profile resolution
- resolved context path

Including the active config path ensures that switching from root config to `.zed/sftp.json` forces a runtime replacement even if content is identical.

### Command and Save Integration

Save handling and LSP command handling should query the runtime manager instead of directly referencing global `configManager` and `sftpClient` variables.

Expected behavior:

- `ready`: continue with upload/download/sync using the current `ConfigManager` and `SftpClient`
- `invalid`: do not transfer; show a clear error
- `unconfigured`: do not transfer; show a clear error

On save:

- only upload when state is `ready`
- keep current checks for `uploadOnSave`, `context`, and ignore patterns

On LSP commands:

- only execute when state is `ready`
- otherwise return a state-specific error

### Connection Semantics

The old connection is closed before the new runtime becomes active. This matches the required behavior: config changes should take effect immediately, and current connections should not survive a config switch.

In-flight operations are allowed to fail if a config change happens concurrently. That tradeoff is acceptable because immediate teardown is explicitly required.

### Error Reporting

The runtime manager should avoid spamming duplicate popups for the same invalid config event. A simple last-error cache keyed by message is sufficient.

User-visible messages:

- invalid config: clear parsing or validation error
- unconfigured: SFTP config not found
- restored config: optional info log only; no popup required unless needed for debugging

## Implementation Notes

### Files Expected to Change

- `server/src/index.ts`
- optionally a new runtime helper such as `server/src/runtime.ts`
- tests covering runtime reload behavior

### Recommended Structure

Extract watcher and state handling out of `index.ts` into a focused runtime helper. `index.ts` should stay responsible for wiring LSP events, while the runtime helper owns:

- watcher setup and teardown
- active config resolution
- refresh serialization
- state transitions

This keeps transfer logic in `SftpClient`, config logic in `ConfigManager`, and runtime lifecycle logic in one place.

### Concurrency Model

Refresh operations must be serialized through a promise chain or equivalent queue. This prevents overlapping file-system events from closing and recreating clients out of order.

Handlers should read a consistent runtime snapshot at the start of each operation. A transfer either runs on the old runtime or the new runtime, never a partially swapped one.

## Testing Plan

### Unit / Focused Runtime Tests

Add tests for:

- initial state becomes `ready` when config exists
- `ready -> ready` when config content changes
- `ready -> invalid` when config becomes invalid
- `ready -> unconfigured` when config file is deleted
- `invalid -> ready` when config is fixed
- higher-priority config file appearing later takes over

These tests can target a runtime manager abstraction directly with temp directories and synthetic file writes.

### Regression Coverage

Add a focused regression test script under `tests/`, for example:

- `tests/config-hot-reload-test.js`

It should verify state transitions and ensure that language-server-backed behavior stops when config is invalid or missing.

### Existing Behavior Protection

Retain current behavior for:

- upload on save within `context`
- ignore rules
- slash command config loading

## Risks and Mitigations

### Duplicate Watcher Events

Risk:
`fs.watch` can emit multiple events per save.

Mitigation:
debounce refresh and skip no-op reloads via digest comparison.

### Directory Watch Instability

Risk:
watchers on `.zed` or `.vscode` may become stale if directories are recreated.

Mitigation:
always keep a root watcher and rebuild directory watchers during every refresh.

### Mid-Transfer Teardown

Risk:
an active upload may fail during config replacement.

Mitigation:
accept this behavior by design because immediate connection invalidation is the explicit requirement.

## Rollout

1. Add runtime manager with explicit states and watcher lifecycle.
2. Wire `index.ts` save and command handlers through the manager.
3. Add focused hot reload tests.
4. Run targeted regression tests for slash commands and build behavior.

## Decision

Implement watcher-based hot reload in the language server with immediate connection teardown on any config change, no fallback to the last good config, and explicit `ready` / `invalid` / `unconfigured` runtime states.
