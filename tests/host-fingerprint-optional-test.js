const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const rootDir = path.resolve(__dirname, "..");
const distConfigPath = path.join(rootDir, "server", "dist", "config.js");
const distClientPath = path.join(rootDir, "server", "dist", "sftp-client.js");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function testConfigLoadsWithoutHostFingerprint() {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), "zed-sftp-config-"));
  const zedDir = path.join(workspaceDir, ".zed");
  fs.mkdirSync(zedDir, { recursive: true });
  fs.writeFileSync(
    path.join(zedDir, "sftp.json"),
    JSON.stringify(
      {
        protocol: "sftp",
        host: "example.com",
        username: "deploy",
        password: "secret",
        remotePath: "/remote",
      },
      null,
      2,
    ),
  );

  try {
    delete require.cache[require.resolve(distConfigPath)];
    const { ConfigManager } = require(distConfigPath);
    const manager = new ConfigManager(workspaceDir);
    const config = await manager.loadConfig();

    assert(config, "config should load without hostFingerprint");
    assert(config.password === "secret", "config should preserve password authentication");
  } finally {
    fs.rmSync(workspaceDir, { recursive: true, force: true });
    delete require.cache[require.resolve(distConfigPath)];
  }
}

async function testConnectSkipsHostVerifierWhenFingerprintIsMissing() {
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

    const connection = {
      console: {
        log() {},
        warn() {},
      },
    };
    const configManager = {
      getRemotePath() {
        return "/remote/file";
      },
    };

    const client = new SftpClient(
      {
        protocol: "sftp",
        host: "example.com",
        username: "deploy",
        password: "secret",
        remotePath: "/remote",
      },
      connection,
      configManager,
    );

    await client.listRemoteFiles("/remote");
    const connectConfig = capturedConfigs[0];

    assert(connectConfig, "SFTP client should connect without hostFingerprint");
    assert(connectConfig.password === "secret", "password should still be used for authentication");
    assert(!("hostVerifier" in connectConfig), "hostVerifier should be omitted when hostFingerprint is missing");
  } finally {
    Module._load = originalLoad;
    delete require.cache[require.resolve(distClientPath)];
  }
}

async function main() {
  await testConfigLoadsWithoutHostFingerprint();
  await testConnectSkipsHostVerifierWhenFingerprintIsMissing();
  process.stdout.write("host fingerprint optional tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
