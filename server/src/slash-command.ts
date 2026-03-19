import * as path from "path";
import { ConfigManager } from "./config";
import { SftpClient } from "./sftp-client";

type SlashAction = "upload" | "download" | "sync";

interface ResolveSlashCommandRequestOptions {
  action: SlashAction;
  args: string[];
  workspaceFolder: string;
  contextPath: string;
}

interface SlashCommandRequest {
  action: SlashAction;
  targetPath: string;
}

function resolveTargetPath(workspaceFolder: string, rawPath: string): string {
  return path.isAbsolute(rawPath)
    ? path.resolve(rawPath)
    : path.resolve(workspaceFolder, rawPath);
}

export function resolveSlashCommandRequest(
  options: ResolveSlashCommandRequestOptions,
): SlashCommandRequest {
  const rawPath = options.args.join(" ").trim();

  if ((options.action === "upload" || options.action === "download") && !rawPath) {
    throw new Error(`${options.action} requires a path argument`);
  }

  const targetPath = rawPath
    ? resolveTargetPath(options.workspaceFolder, rawPath)
    : options.contextPath;

  return {
    action: options.action,
    targetPath,
  };
}

function formatWorkspacePath(workspaceFolder: string, targetPath: string): string {
  const relativePath = path.relative(workspaceFolder, targetPath);
  if (!relativePath || relativePath === "") {
    return ".";
  }

  if (relativePath.startsWith("..")) {
    return targetPath;
  }

  return relativePath.split(path.sep).join("/");
}

export async function runSlashCommand(
  action: SlashAction,
  workspaceFolder: string,
  rawArgs: string[],
): Promise<string> {
  const configManager = new ConfigManager(workspaceFolder);
  const config = await configManager.loadConfig();

  if (!config) {
    throw new Error(
      "No SFTP config found. Create .zed/sftp.json before using the slash commands.",
    );
  }

  const request = resolveSlashCommandRequest({
    action,
    args: rawArgs,
    workspaceFolder,
    contextPath: configManager.getContextPath(),
  });

  const connection = {
    console: {
      log() {},
      warn() {},
      error() {},
    },
  } as any;

  const client = new SftpClient(config, connection, configManager);

  try {
    switch (request.action) {
      case "upload": {
        await client.uploadFile(request.targetPath);
        const remotePath = configManager.getRemotePath(request.targetPath);
        const localLabel = formatWorkspacePath(workspaceFolder, request.targetPath);
        return remotePath
          ? `Uploaded \`${localLabel}\` to \`${remotePath}\`.`
          : `Uploaded \`${localLabel}\`.`;
      }

      case "download": {
        await client.downloadFile(request.targetPath);
        const remotePath = configManager.getRemotePath(request.targetPath);
        const localLabel = formatWorkspacePath(workspaceFolder, request.targetPath);
        return remotePath
          ? `Downloaded \`${remotePath}\` into \`${localLabel}\`.`
          : `Downloaded \`${localLabel}\`.`;
      }

      case "sync": {
        await client.syncFolder(request.targetPath);
        const localLabel = formatWorkspacePath(workspaceFolder, request.targetPath);
        return `Synced \`${localLabel}\` to the configured remote path.`;
      }
    }
  } finally {
    await client.close();
  }
}

async function main() {
  const [, , rawAction, workspaceFolder, rawPath] = process.argv;

  if (rawAction !== "upload" && rawAction !== "download" && rawAction !== "sync") {
    throw new Error("Expected action to be upload, download, or sync");
  }

  if (!workspaceFolder) {
    throw new Error("Expected workspace folder argument");
  }

  const args = rawPath ? [rawPath] : [];
  const message = await runSlashCommand(rawAction, workspaceFolder, args);
  process.stdout.write(`${message}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
