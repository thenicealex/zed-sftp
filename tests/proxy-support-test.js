const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const Module = require("module");
const { EventEmitter } = require("events");

const rootDir = path.resolve(__dirname, "..");
const distConfigPath = path.join(rootDir, "server", "dist", "config.js");
const distClientPath = path.join(rootDir, "server", "dist", "sftp-client.js");
const readmePath = path.join(rootDir, "README.md");
const examplesDir = path.join(rootDir, "examples");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function createWorkspaceWithConfig(config) {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "zed-sftp-proxy-"));
  const zedDir = path.join(workspaceDir, ".zed");
  fs.mkdirSync(zedDir, { recursive: true });
  fs.writeFileSync(
    path.join(zedDir, "sftp.json"),
    JSON.stringify(config, null, 2),
  );
  return workspaceDir;
}

async function loadConfigFromWorkspace(workspaceDir) {
  delete require.cache[require.resolve(distConfigPath)];
  const { ConfigManager } = require(distConfigPath);
  const manager = new ConfigManager(workspaceDir);
  return manager.loadConfig();
}

async function testConfigLoadsWithSupportedProxyTypes() {
  const baseConfig = {
    protocol: "sftp",
    host: "example.com",
    username: "deploy",
    password: "secret",
    remotePath: "/remote",
  };

  const socksWorkspace = createWorkspaceWithConfig({
    ...baseConfig,
    proxy: { type: "socks5", host: "127.0.0.1", port: 1080 },
  });
  const httpWorkspace = createWorkspaceWithConfig({
    ...baseConfig,
    proxy: { type: "http", host: "127.0.0.1", port: 7890 },
  });

  try {
    const socksConfig = await loadConfigFromWorkspace(socksWorkspace);
    assert(socksConfig.proxy.type === "socks5", "socks5 proxy config should load");

    const httpConfig = await loadConfigFromWorkspace(httpWorkspace);
    assert(httpConfig.proxy.type === "http", "http proxy config should load");
  } finally {
    fs.rmSync(socksWorkspace, { recursive: true, force: true });
    fs.rmSync(httpWorkspace, { recursive: true, force: true });
    delete require.cache[require.resolve(distConfigPath)];
  }
}

async function testConfigRejectsInvalidProxyType() {
  const workspaceDir = createWorkspaceWithConfig({
    protocol: "sftp",
    host: "example.com",
    username: "deploy",
    password: "secret",
    remotePath: "/remote",
    proxy: { type: "https", host: "127.0.0.1", port: 7890 },
  });

  try {
    let caughtError;
    try {
      await loadConfigFromWorkspace(workspaceDir);
    } catch (error) {
      caughtError = error;
    }

    assert(caughtError, "invalid proxy type should fail config loading");
    assert(
      String(caughtError).includes("proxy.type must be either \"socks5\" or \"http\""),
      "invalid proxy type should produce a clear error",
    );
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    delete require.cache[require.resolve(distConfigPath)];
  }
}

class FakeProxySocket extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
    this.destroyed = false;
    this.timeout = 0;
    this.writes = [];
  }

  write(chunk, callback) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    this.writes.push(buffer);
    this.handler(this, buffer);
    if (typeof callback === "function") {
      process.nextTick(() => callback(null));
    }
    return true;
  }

  setTimeout(timeout) {
    this.timeout = timeout;
    return this;
  }

  setNoDelay() {
    return this;
  }

  pause() {
    return this;
  }

  resume() {
    return this;
  }

  unshift(chunk) {
    this.unshifted = chunk;
  }

  end() {
    this.destroyed = true;
    this.emit("close");
  }

  destroy(error) {
    this.destroyed = true;
    if (error) {
      this.emit("error", error);
    }
    this.emit("close");
  }
}

async function withPatchedSftpClient(testFn) {
  const capturedConfigs = [];

  class FakeClient {
    async connect(config) {
      capturedConfigs.push(config);
    }

    async list() {
      return [];
    }

    async end() {}
  }

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "ssh2-sftp-client") {
      return FakeClient;
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(distClientPath)];
    const { SftpClient } = require(distClientPath);
    await testFn({ SftpClient, capturedConfigs });
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(distClientPath)];
  }
}

async function testConnectUsesSocks5ProxySocket() {
  const originalCreateConnection = net.createConnection;
  const proxyConnections = [];

  net.createConnection = (options) => {
    const socket = new FakeProxySocket((instance, chunk) => {
      if (chunk[0] === 0x05 && chunk.length >= 3) {
        process.nextTick(() => instance.emit("data", Buffer.from([0x05, 0x00])));
        return;
      }

      if (chunk[0] === 0x05 && chunk[1] === 0x01) {
        process.nextTick(() =>
          instance.emit("data", Buffer.from([0x05, 0x00, 0x00, 0x01, 127, 0, 0, 1, 0x04, 0x38])),
        );
      }
    });

    proxyConnections.push({ options, socket });
    process.nextTick(() => socket.emit("connect"));
    return socket;
  };

  try {
    await withPatchedSftpClient(async ({ SftpClient, capturedConfigs }) => {
      const client = new SftpClient(
        {
          protocol: "sftp",
          host: "example.com",
          port: 22,
          username: "deploy",
          password: "secret",
          remotePath: "/remote",
          proxy: { type: "socks5", host: "127.0.0.1", port: 1080 },
        },
        { console: { log() {}, warn() {} } },
        { getRemotePath() { return "/remote/file"; } },
      );

      await client.listRemoteFiles("/remote");

      assert(proxyConnections.length === 1, "socks5 proxy should open a proxy socket");
      assert(capturedConfigs[0].sock, "ssh connect config should receive proxy socket");
      assert(
        proxyConnections[0].options.host === "127.0.0.1" && proxyConnections[0].options.port === 1080,
        "socks5 proxy should connect to the configured proxy endpoint",
      );
    });
  } finally {
    net.createConnection = originalCreateConnection;
  }
}

async function testConnectUsesHttpProxySocket() {
  const originalCreateConnection = net.createConnection;
  const proxyConnections = [];

  net.createConnection = (options) => {
    const socket = new FakeProxySocket((instance, chunk) => {
      const request = chunk.toString("utf8");
      if (request.startsWith("CONNECT ")) {
        process.nextTick(() =>
          instance.emit("data", Buffer.from("HTTP/1.1 200 Connection Established\r\n\r\n")),
        );
      }
    });

    proxyConnections.push({ options, socket });
    process.nextTick(() => socket.emit("connect"));
    return socket;
  };

  try {
    await withPatchedSftpClient(async ({ SftpClient, capturedConfigs }) => {
      const client = new SftpClient(
        {
          protocol: "sftp",
          host: "example.com",
          port: 22,
          username: "deploy",
          password: "secret",
          remotePath: "/remote",
          proxy: { type: "http", host: "127.0.0.1", port: 7890 },
        },
        { console: { log() {}, warn() {} } },
        { getRemotePath() { return "/remote/file"; } },
      );

      await client.listRemoteFiles("/remote");

      assert(proxyConnections.length === 1, "http proxy should open a proxy socket");
      assert(capturedConfigs[0].sock, "ssh connect config should receive http proxy socket");
      assert(
        proxyConnections[0].socket.writes.some((buffer) =>
          buffer.toString("utf8").startsWith("CONNECT example.com:22 HTTP/1.1"),
        ),
        "http proxy should issue a CONNECT request",
      );
    });
  } finally {
    net.createConnection = originalCreateConnection;
  }
}

async function testReadmeDocumentsOptionalProxySupport() {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(
    readme.includes("### Proxy"),
    "README should document optional proxy configuration",
  );
  assert(
    readme.includes('"type": "socks5"'),
    "README should include a SOCKS5 proxy example",
  );
  assert(
    readme.includes('"type": "http"'),
    "README should include an HTTP proxy example",
  );
}

async function testProxyExamplesExist() {
  const socksExamplePath = path.join(examplesDir, "sftp-via-socks5.example.json");
  const httpExamplePath = path.join(examplesDir, "sftp-via-http-proxy.example.json");

  assert(fs.existsSync(socksExamplePath), "SOCKS5 proxy example should exist");
  assert(fs.existsSync(httpExamplePath), "HTTP proxy example should exist");

  const socksExample = fs.readFileSync(socksExamplePath, "utf8");
  const httpExample = fs.readFileSync(httpExamplePath, "utf8");

  assert(
    socksExample.includes('"type": "socks5"'),
    "SOCKS5 proxy example should declare the socks5 proxy type",
  );
  assert(
    httpExample.includes('"type": "http"'),
    "HTTP proxy example should declare the http proxy type",
  );
}

async function main() {
  await testConfigLoadsWithSupportedProxyTypes();
  await testConfigRejectsInvalidProxyType();
  await testConnectUsesSocks5ProxySocket();
  await testConnectUsesHttpProxySocket();
  await testReadmeDocumentsOptionalProxySupport();
  await testProxyExamplesExist();
  process.stdout.write("proxy support tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
