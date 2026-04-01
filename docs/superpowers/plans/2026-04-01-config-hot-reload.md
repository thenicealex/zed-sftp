# Config Hot Reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add immediate config hot reload to the long-lived language server so config edits take effect without reloading Zed.

**Architecture:** Introduce a focused runtime manager that owns config resolution, watcher lifecycle, and `ready` / `invalid` / `unconfigured` state transitions. Keep `ConfigManager` responsible for parsing and path mapping, keep `SftpClient` responsible for transport, and route LSP save/command handlers through the runtime manager.

**Tech Stack:** TypeScript, Node.js `fs.watch`, `vscode-languageserver`, `ssh2-sftp-client`, direct Node regression scripts

---

### Task 1: Add focused failing coverage for config hot reload

**Files:**
- Create: `tests/config-hot-reload-test.js`
- Modify: `server/src/index.ts` only after the failing test is verified
- Test: `tests/config-hot-reload-test.js`

- [ ] **Step 1: Write the failing regression test**

```js
// Verify that a runtime manager can transition:
// ready -> invalid -> ready -> unconfigured
// and that a higher-priority config file takes over immediately.
```

- [ ] **Step 2: Run the new test to verify it fails**

Run: `node tests/config-hot-reload-test.js`
Expected: FAIL because the runtime helper does not exist yet.

- [ ] **Step 3: Commit the failing test only if a checkpoint is needed**

```bash
git add tests/config-hot-reload-test.js
git commit -m "test: cover config hot reload transitions"
```

### Task 2: Implement the runtime manager and config watching

**Files:**
- Create: `server/src/runtime.ts`
- Modify: `server/src/config.ts`
- Test: `tests/config-hot-reload-test.js`

- [ ] **Step 1: Add active-config resolution and runtime state primitives**

```ts
export type RuntimeState = ...
export function resolveActiveConfigPath(workspaceFolder: string): string | null
```

- [ ] **Step 2: Add a runtime manager that serializes refresh operations**

```ts
class RuntimeManager {
  async start(): Promise<void> { ... }
  async stop(): Promise<void> { ... }
  getState(): RuntimeState { ... }
  async refreshRuntime(reason: string): Promise<void> { ... }
}
```

- [ ] **Step 3: Add watcher lifecycle management**

```ts
private rebuildWatchers(): void { ... }
private scheduleRefresh(reason: string): void { ... }
```

- [ ] **Step 4: Run the focused test**

Run: `node tests/config-hot-reload-test.js`
Expected: PASS

- [ ] **Step 5: Commit the runtime layer**

```bash
git add server/src/runtime.ts server/src/config.ts tests/config-hot-reload-test.js
git commit -m "feat: add config hot reload runtime"
```

### Task 3: Wire the language server through runtime state

**Files:**
- Modify: `server/src/index.ts`
- Modify: `server/src/runtime.ts`
- Test: `tests/config-hot-reload-test.js`

- [ ] **Step 1: Replace one-time globals with runtime manager lookups**

```ts
const runtime = new RuntimeManager(...)
await runtime.start()
```

- [ ] **Step 2: Update save handling to gate on runtime state**

```ts
const ready = runtime.requireReadyState("upload on save")
```

- [ ] **Step 3: Update LSP command handling to gate on runtime state**

```ts
const ready = runtime.requireReadyState("command execution")
```

- [ ] **Step 4: Run focused regression coverage**

Run: `node tests/config-hot-reload-test.js`
Expected: PASS

- [ ] **Step 5: Commit the integration changes**

```bash
git add server/src/index.ts server/src/runtime.ts
git commit -m "feat: hot reload sftp runtime config"
```

### Task 4: Rebuild artifacts and document user-visible behavior

**Files:**
- Modify: `README.md`
- Modify: `examples/sftp-config.example.json`
- Modify: `server/dist/*.js` and `server/dist/*.d.ts` via build
- Test: `server/src/*`, `README.md`

- [ ] **Step 1: Update docs for hot reload behavior**

```md
Document that editing `.zed/sftp.json` takes effect automatically and invalid configs disable transfers until fixed.
```

- [ ] **Step 2: Rebuild the language server output**

Run: `cd server && npm run build`
Expected: `server/dist/` refreshed successfully

- [ ] **Step 3: Run targeted verification**

Run: `node tests/config-hot-reload-test.js`
Expected: PASS

Run: `node tests/slash-command-support-test.js`
Expected: PASS

Run: `node tests/server-bootstrap-test.js`
Expected: PASS

- [ ] **Step 4: Commit the doc and build outputs**

```bash
git add README.md examples/sftp-config.example.json server/dist
git commit -m "docs: describe hot reloaded sftp config"
```
