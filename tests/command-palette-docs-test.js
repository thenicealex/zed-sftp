const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const readmePath = path.join(rootDir, "README.md");

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

async function testReadmeDoesNotPromiseCommandPaletteEntries() {
  const readme = fs.readFileSync(readmePath, "utf8");

  assert(
    !readme.includes("Run these from the Zed command palette:"),
    "README should not claim that SFTP actions appear in the Zed command palette",
  );
  assert(
    readme.includes("does not currently expose extension-defined commands in the command palette"),
    "README should explain the current Zed command palette limitation",
  );
  assert(
    readme.includes("examples/zed-tasks.example.json"),
    "README should point users to the Zed tasks example as the manual-trigger workaround",
  );
}

async function main() {
  await testReadmeDoesNotPromiseCommandPaletteEntries();
  process.stdout.write("command palette docs tests passed\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
