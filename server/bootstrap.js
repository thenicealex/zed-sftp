"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const serverDir = __dirname;
const distEntry = path.join(serverDir, "dist", "index.js");
const sourceEntry = path.join(serverDir, "src", "index.ts");
const tsconfigPath = path.join(serverDir, "tsconfig.json");
const typescriptBinary = path.join(
  serverDir,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

function ensureServerEntry() {
  if (fs.existsSync(distEntry)) {
    return;
  }

  if (!fs.existsSync(sourceEntry)) {
    throw new Error(
      `Language server source not found at "${sourceEntry}". Reinstall the extension with ./build.sh --install.`,
    );
  }

  if (!fs.existsSync(tsconfigPath)) {
    throw new Error(
      `TypeScript config not found at "${tsconfigPath}". Reinstall the extension with ./build.sh --install.`,
    );
  }

  if (!fs.existsSync(typescriptBinary)) {
    throw new Error(
      `Bundled TypeScript compiler not found at "${typescriptBinary}". Reinstall the extension with ./build.sh --install.`,
    );
  }

  const result = spawnSync(process.execPath, [typescriptBinary, "-p", tsconfigPath], {
    cwd: serverDir,
    env: process.env,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    const compilerOutput = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(
      `Failed to rebuild the language server from "${sourceEntry}".${compilerOutput ? `\n${compilerOutput}` : ""}`,
    );
  }

  if (!fs.existsSync(distEntry)) {
    throw new Error(
      `Rebuild completed but "${distEntry}" is still missing. Reinstall the extension with ./build.sh --install.`,
    );
  }
}

try {
  ensureServerEntry();
  require(distEntry);
} catch (error) {
  const details = error instanceof Error ? error.message : String(error);
  console.error(`[SFTP] Failed to start the language server.\n${details}`);
  process.exit(1);
}
