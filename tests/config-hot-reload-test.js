const fs = require("fs");
const os = require("os");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const runtimeDistPath = path.join(rootDir, "server", "dist", "runtime.js");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function createTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zed-sftp-runtime-"));
}

function writeConfig(filePath, overrides = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      {
        protocol: "sftp",
        host: "example.com",
        port: 22,
        username: "deploy",
        password: "secret",
        remotePath: "/var/www/html",
        uploadOnSave: true,
        ...overrides,
      },
      null,
      2,
    ),
  );
}

async function waitFor(predicate, message, timeoutMs = 5000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  fail(message);
}

function createConnectionRecorder() {
  const messages = {
    info: [],
    error: [],
    log: [],
    warn: [],
    consoleError: [],
  };

  return {
    console: {
      log(message) {
        messages.log.push(String(message));
      },
      warn(message) {
        messages.warn.push(String(message));
      },
      error(message) {
        messages.consoleError.push(String(message));
      },
    },
    window: {
      showInformationMessage(message) {
        messages.info.push(String(message));
        return Promise.resolve();
      },
      showErrorMessage(message) {
        messages.error.push(String(message));
        return Promise.resolve();
      },
    },
    messages,
  };
}

async function main() {
  delete require.cache[require.resolve(runtimeDistPath)];
  const { RuntimeManager } = require(runtimeDistPath);

  const workspace = createTempWorkspace();
  const rootConfigPath = path.join(workspace, "sftp.json");
  const zedConfigPath = path.join(workspace, ".zed", "sftp.json");

  const connection = createConnectionRecorder();
  const createdClients = [];

  writeConfig(rootConfigPath, {
    host: "root.example.com",
    remotePath: "/root-path",
  });

  const runtime = new RuntimeManager({
    workspaceFolder: workspace,
    connection,
    debounceMs: 10,
    createClient({ config }) {
      const client = {
        host: config.host,
        remotePath: config.remotePath,
        closed: false,
        closeCalls: 0,
        async close() {
          this.closed = true;
          this.closeCalls += 1;
        },
      };
      createdClients.push(client);
      return client;
    },
  });

  try {
    await runtime.start();

    let state = runtime.getState();
    assert(state.kind === "ready", "runtime should start in ready state when a config exists");
    assert(state.configPath === rootConfigPath, "runtime should use the root config initially");
    assert(createdClients.length === 1, "runtime should create an initial client");
    assert(createdClients[0].host === "root.example.com", "initial client should use the root config");

    writeConfig(zedConfigPath, {
      host: "zed.example.com",
      remotePath: "/zed-path",
    });

    await waitFor(() => {
      const nextState = runtime.getState();
      return nextState.kind === "ready" && nextState.configPath === zedConfigPath;
    }, "runtime should switch to the higher-priority .zed config");

    state = runtime.getState();
    assert(state.kind === "ready", "runtime should stay ready after switching config priority");
    assert(createdClients.length === 2, "runtime should recreate the client after a config switch");
    assert(createdClients[0].closed, "runtime should close the previous client when config changes");
    assert(createdClients[1].host === "zed.example.com", "new client should use the higher-priority config");

    fs.writeFileSync(zedConfigPath, "{ invalid json }\n");

    await waitFor(() => runtime.getState().kind === "invalid", "runtime should become invalid when the active config is malformed");

    state = runtime.getState();
    assert(state.kind === "invalid", "runtime should report invalid after a malformed config");
    assert(createdClients[1].closed, "runtime should close the active client when config becomes invalid");
    assert(
      connection.messages.error.some((message) => message.includes("Failed to parse SFTP config")),
      "runtime should surface a config parse error",
    );

    writeConfig(zedConfigPath, {
      host: "fixed.example.com",
      remotePath: "/fixed-path",
    });

    await waitFor(() => {
      const nextState = runtime.getState();
      return nextState.kind === "ready" && nextState.configPath === zedConfigPath;
    }, "runtime should recover when the active config is fixed");

    state = runtime.getState();
    assert(state.kind === "ready", "runtime should return to ready after config repair");
    assert(createdClients.length === 3, "runtime should create a new client after config repair");
    assert(createdClients[2].host === "fixed.example.com", "recovered client should use the repaired config");

    fs.unlinkSync(zedConfigPath);

    await waitFor(() => {
      const nextState = runtime.getState();
      return nextState.kind === "ready" && nextState.configPath === rootConfigPath;
    }, "runtime should fall back to the root config after deleting the .zed config");

    state = runtime.getState();
    assert(state.kind === "ready", "runtime should return to ready on root config fallback");
    assert(createdClients.length === 4, "runtime should recreate the client on fallback");
    assert(createdClients[2].closed, "runtime should close the repaired client during fallback");
    assert(createdClients[3].host === "root.example.com", "fallback client should use the root config");

    fs.unlinkSync(rootConfigPath);

    await waitFor(() => runtime.getState().kind === "unconfigured", "runtime should become unconfigured when all configs are removed");

    state = runtime.getState();
    assert(state.kind === "unconfigured", "runtime should end in unconfigured state after removing all configs");
    assert(createdClients[3].closed, "runtime should close the last active client when configs disappear");
  } finally {
    await runtime.stop();
    fs.rmSync(workspace, { recursive: true, force: true });
  }

  process.stdout.write("config hot reload tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
