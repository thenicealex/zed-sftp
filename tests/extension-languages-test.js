const fs = require("fs");
const path = require("path");

const extensionTomlPath = path.resolve(__dirname, "..", "extension.toml");
const expectedLanguages = [
  "JSX",
  "TSX",
  "JSONC",
  "TOML",
  "Shell Script",
  "Dockerfile",
  "SQL",
  "SCSS",
  "LESS",
  "Vue",
  "Svelte",
  "Astro",
];

function fail(message) {
  throw new Error(message);
}

function getDeclaredLanguages() {
  const content = fs.readFileSync(extensionTomlPath, "utf8");
  const match = content.match(/languages = \[(.*?)\]/s);

  if (!match) {
    fail("extension.toml does not declare language server languages");
  }

  return match[1]
    .split(",")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

function main() {
  const declaredLanguages = getDeclaredLanguages();

  for (const language of expectedLanguages) {
    if (!declaredLanguages.includes(language)) {
      fail(`extension.toml should support ${language}`);
    }
  }

  process.stdout.write("extension language coverage tests passed\n");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
}
