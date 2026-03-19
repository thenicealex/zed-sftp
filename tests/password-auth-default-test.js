const fs = require("fs");
const path = require("path");
const Module = require("module");

const rootDir = path.resolve(__dirname, "..");
const readmePath = path.join(rootDir, "README.md");
const buildScriptPath = path.join(rootDir, "build.sh");
const examplesDir = path.join(rootDir, "examples");
const distClientPath = path.join(rootDir, "server", "dist", "sftp-client.js");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function getDefaultConfigSnippet() {
  const readme = fs.readFileSync(readmePath, "utf8");
  const marker = "Create `.zed/sftp.json` in the workspace root:";
  const markerIndex = readme.indexOf(marker);
  assert(markerIndex >= 0, "README default config section not found");

  const snippetStart = readme.indexOf("```json", markerIndex);
  const snippetEnd = readme.indexOf("```", snippetStart + 7);
  assert(snippetStart >= 0 && snippetEnd >= 0, "README default config snippet not found");

  return readme.slice(snippetStart, snippetEnd);
}

function getBuildScriptConfigSnippet() {
  const buildScript = fs.readFileSync(buildScriptPath, "utf8");
  const marker = "Create .zed/sftp.json in your project:";
  const markerIndex = buildScript.indexOf(marker);
  assert(markerIndex >= 0, "build.sh config guidance not found");

  return buildScript.slice(markerIndex);
}

async function testReadmeDefaultsToPasswordAuth() {
  const snippet = getDefaultConfigSnippet();
  assert(
    snippet.includes('"password": "your-password"'),
    "README default config should use password authentication",
  );
  assert(
    !snippet.includes('"privateKeyPath"'),
    "README default config should not default to privateKeyPath",
  );
}

async function testBuildScriptDefaultsToPasswordAuth() {
  const snippet = getBuildScriptConfigSnippet();
  assert(
    snippet.includes('"password": "your-password"'),
    "build.sh config guidance should use password authentication",
  );
  assert(
    !snippet.includes('"privateKeyPath"'),
    "build.sh config guidance should not default to privateKeyPath",
  );
  assert(
    !snippet.includes('"hostFingerprint"'),
    "build.sh config guidance should not require hostFingerprint by default",
  );
}

async function testExamplesReflectPasswordDefaultAndOptionalFingerprint() {
  const files = [
    "multi-profile.example.json",
    "sftp-config.example.json",
    "wordpress-context.example.json",
  ];

  for (const file of files) {
    const content = fs.readFileSync(path.join(examplesDir, file), "utf8");
    assert(
      content.includes('"password"'),
      `${file} should include password authentication in its example config`,
    );
    assert(
      !content.includes('"hostFingerprint"'),
      `${file} should not require hostFingerprint in its example config`,
    );
  }
}

async function testPasswordTakesPriorityOverPrivateKey() {
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

  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function patchedReadFileSync(filePath, options) {
    if (filePath === "/fake/key") {
      return Buffer.from("private-key");
    }
    return originalReadFileSync.call(this, filePath, options);
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
        privateKeyPath: "/fake/key",
        passphrase: "ignored-passphrase",
        hostFingerprint: "SHA256:abcdef",
        remotePath: "/remote",
      },
      connection,
      configManager,
    );

    await client.listRemoteFiles("/remote");
    const connectConfig = capturedConfigs[0];

    assert(connectConfig, "SFTP client did not attempt to connect");
    assert(connectConfig.password === "secret", "password should be forwarded to connect config");
    assert(!("privateKey" in connectConfig), "private key should not be loaded when password is present");
    assert(!("passphrase" in connectConfig), "passphrase should not be forwarded when password is present");
  } finally {
    Module._load = originalLoad;
    fs.readFileSync = originalReadFileSync;
    delete require.cache[require.resolve(distClientPath)];
  }
}

async function main() {
  await testReadmeDefaultsToPasswordAuth();
  await testBuildScriptDefaultsToPasswordAuth();
  await testExamplesReflectPasswordDefaultAndOptionalFingerprint();
  await testPasswordTakesPriorityOverPrivateKey();
  process.stdout.write("password auth default tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
