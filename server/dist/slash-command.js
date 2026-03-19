"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveSlashCommandRequest = resolveSlashCommandRequest;
exports.runSlashCommand = runSlashCommand;
const path = __importStar(require("path"));
const config_1 = require("./config");
const sftp_client_1 = require("./sftp-client");
function resolveTargetPath(workspaceFolder, rawPath) {
    return path.isAbsolute(rawPath)
        ? path.resolve(rawPath)
        : path.resolve(workspaceFolder, rawPath);
}
function resolveSlashCommandRequest(options) {
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
function formatWorkspacePath(workspaceFolder, targetPath) {
    const relativePath = path.relative(workspaceFolder, targetPath);
    if (!relativePath || relativePath === "") {
        return ".";
    }
    if (relativePath.startsWith("..")) {
        return targetPath;
    }
    return relativePath.split(path.sep).join("/");
}
async function runSlashCommand(action, workspaceFolder, rawArgs) {
    const configManager = new config_1.ConfigManager(workspaceFolder);
    const config = await configManager.loadConfig();
    if (!config) {
        throw new Error("No SFTP config found. Create .zed/sftp.json before using the slash commands.");
    }
    const request = resolveSlashCommandRequest({
        action,
        args: rawArgs,
        workspaceFolder,
        contextPath: configManager.getContextPath(),
    });
    const connection = {
        console: {
            log() { },
            warn() { },
            error() { },
        },
    };
    const client = new sftp_client_1.SftpClient(config, connection, configManager);
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
    }
    finally {
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
//# sourceMappingURL=slash-command.js.map