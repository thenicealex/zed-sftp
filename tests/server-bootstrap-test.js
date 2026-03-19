const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const rustEntryPath = path.join(rootDir, "src", "lib.rs");
const bootstrapSourcePath = path.join(rootDir, "server", "bootstrap.js");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function makeTempExtensionDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "zed-sftp-bootstrap-"));
}

function writeExecutable(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function runBootstrap(serverDir) {
  return spawnSync(process.execPath, [path.join(serverDir, "bootstrap.js"), "--stdio"], {
    cwd: serverDir,
    encoding: "utf8",
  });
}

function testRustExtensionUsesBootstrapScript() {
  const rustEntry = fs.readFileSync(rustEntryPath, "utf8");

  assert(
    rustEntry.includes('.join("server").join("bootstrap.js")'),
    "Rust extension should launch server/bootstrap.js as the stable entrypoint",
  );
}

function testBootstrapBuildsMissingDistUsingBundledTypeScript() {
  const extensionDir = makeTempExtensionDir();
  const serverDir = path.join(extensionDir, "server");

  try {
    fs.mkdirSync(path.join(serverDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(serverDir, "src", "index.ts"), "export {};\n");
    fs.writeFileSync(path.join(serverDir, "tsconfig.json"), "{}\n");
    fs.copyFileSync(bootstrapSourcePath, path.join(serverDir, "bootstrap.js"));

    writeExecutable(
      path.join(serverDir, "node_modules", "typescript", "bin", "tsc"),
      `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const serverDir = process.cwd();
fs.mkdirSync(path.join(serverDir, "dist"), { recursive: true });
fs.writeFileSync(
  path.join(serverDir, "dist", "index.js"),
  'process.stdout.write("built-server-started\\\\n");',
);
`,
    );

    const result = runBootstrap(serverDir);

    assert(result.status === 0, `bootstrap should succeed after rebuilding dist, got: ${result.stderr}`);
    assert(
      result.stdout.includes("built-server-started"),
      "bootstrap should execute the rebuilt language server entrypoint",
    );
    assert(
      fs.existsSync(path.join(serverDir, "dist", "index.js")),
      "bootstrap should recreate dist/index.js when it is missing",
    );
  } finally {
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }
}

function testBootstrapUsesExistingDistWithoutRebuilding() {
  const extensionDir = makeTempExtensionDir();
  const serverDir = path.join(extensionDir, "server");

  try {
    fs.mkdirSync(path.join(serverDir, "dist"), { recursive: true });
    fs.copyFileSync(bootstrapSourcePath, path.join(serverDir, "bootstrap.js"));
    fs.writeFileSync(
      path.join(serverDir, "dist", "index.js"),
      'process.stdout.write("existing-server-started\\n");',
    );
    writeExecutable(
      path.join(serverDir, "node_modules", "typescript", "bin", "tsc"),
      `#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
fs.writeFileSync(path.join(process.cwd(), "tsc-ran.txt"), "yes");
`,
    );

    const result = runBootstrap(serverDir);

    assert(result.status === 0, `bootstrap should run existing dist output, got: ${result.stderr}`);
    assert(
      result.stdout.includes("existing-server-started"),
      "bootstrap should execute the existing dist entrypoint",
    );
    assert(
      !fs.existsSync(path.join(serverDir, "tsc-ran.txt")),
      "bootstrap should not rebuild when dist/index.js already exists",
    );
  } finally {
    fs.rmSync(extensionDir, { recursive: true, force: true });
  }
}

function main() {
  assert(fs.existsSync(bootstrapSourcePath), "server/bootstrap.js should exist");
  testRustExtensionUsesBootstrapScript();
  testBootstrapBuildsMissingDistUsingBundledTypeScript();
  testBootstrapUsesExistingDistWithoutRebuilding();
  process.stdout.write("server bootstrap tests passed\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
