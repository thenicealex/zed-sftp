const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const extensionTomlPath = path.join(rootDir, "extension.toml");
const readmePath = path.join(rootDir, "README.md");
const distSlashCommandPath = path.join(rootDir, "server", "dist", "slash-command.js");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readExtensionToml() {
  return fs.readFileSync(extensionTomlPath, "utf8");
}

async function testManifestRegistersSlashCommands() {
  const extensionToml = readExtensionToml();

  assert(
    extensionToml.includes("[slash_commands.sftp-upload]"),
    "extension.toml should register /sftp-upload",
  );
  assert(
    extensionToml.includes("[slash_commands.sftp-download]"),
    "extension.toml should register /sftp-download",
  );
  assert(
    extensionToml.includes("[slash_commands.sftp-sync]"),
    "extension.toml should register /sftp-sync",
  );
}

async function testResolveSlashCommandRequest() {
  delete require.cache[require.resolve(distSlashCommandPath)];
  const { resolveSlashCommandRequest } = require(distSlashCommandPath);

  let caughtError;
  try {
    resolveSlashCommandRequest({
      action: "upload",
      args: [],
      workspaceFolder: "/tmp/workspace",
      contextPath: "/tmp/workspace/context",
    });
  } catch (error) {
    caughtError = error;
  }

  assert(caughtError, "upload without a path should fail");
  assert(
    String(caughtError).includes("requires a path argument"),
    "upload without a path should explain that a path argument is required",
  );

  const uploadRequest = resolveSlashCommandRequest({
    action: "upload",
    args: ["src/index.ts"],
    workspaceFolder: "/tmp/workspace",
    contextPath: "/tmp/workspace/context",
  });
  assert(
    uploadRequest.targetPath === path.resolve("/tmp/workspace", "src/index.ts"),
    "relative upload paths should resolve from the workspace root",
  );

  const syncRequest = resolveSlashCommandRequest({
    action: "sync",
    args: [],
    workspaceFolder: "/tmp/workspace",
    contextPath: "/tmp/workspace/context",
  });
  assert(
    syncRequest.targetPath === "/tmp/workspace/context",
    "sync without a path should default to the configured context path",
  );
}

async function testReadmeDocumentsSlashCommands() {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(
    readme.includes("/sftp-upload"),
    "README should document the /sftp-upload assistant command",
  );
  assert(
    readme.includes("/sftp-download"),
    "README should document the /sftp-download assistant command",
  );
  assert(
    readme.includes("/sftp-sync"),
    "README should document the /sftp-sync assistant command",
  );
}

async function main() {
  await testManifestRegistersSlashCommands();
  await testResolveSlashCommandRequest();
  await testReadmeDocumentsSlashCommands();
  process.stdout.write("slash command support tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
