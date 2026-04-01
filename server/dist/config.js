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
exports.ConfigManager = void 0;
exports.resolveConfigPath = resolveConfigPath;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const minimatch_1 = require("minimatch");
function resolveConfigPath(workspaceFolder) {
    const configPaths = [
        path.join(workspaceFolder, ".zed", "sftp.json"),
        path.join(workspaceFolder, ".vscode", "sftp.json"),
        path.join(workspaceFolder, "sftp.json"),
    ];
    for (const configPath of configPaths) {
        if (fs.existsSync(configPath)) {
            return configPath;
        }
    }
    return null;
}
class ConfigManager {
    constructor(workspaceFolder) {
        this.config = null;
        this.ignorePatterns = [];
        this.contextPath = ""; // Resolved context path
        this.configPath = null;
        this.workspaceFolder = workspaceFolder;
        this.workspaceRoot = this.resolveExistingPath(workspaceFolder);
        this.contextPath = this.workspaceRoot;
    }
    async loadConfig() {
        const configPath = resolveConfigPath(this.workspaceFolder);
        if (!configPath || !fs.existsSync(configPath)) {
            return null;
        }
        try {
            const configContent = fs.readFileSync(configPath, "utf-8");
            const rawConfig = JSON.parse(configContent);
            if (!rawConfig) {
                throw new Error("Config is empty");
            }
            let config = rawConfig;
            if (rawConfig.profiles && rawConfig.defaultProfile) {
                const profile = rawConfig.profiles[rawConfig.defaultProfile];
                if (!profile) {
                    throw new Error(`Unknown defaultProfile: ${rawConfig.defaultProfile}`);
                }
                config = { ...rawConfig, ...profile };
            }
            if (!config.host) {
                throw new Error("Missing required field: host");
            }
            if (config.protocol !== "sftp") {
                throw new Error(`Unsupported protocol: ${config.protocol}. Only "sftp" is currently implemented.`);
            }
            if (!config.username) {
                throw new Error("Missing required field: username");
            }
            if (!config.remotePath) {
                throw new Error("Missing required field: remotePath");
            }
            if (!config.password && !config.privateKeyPath) {
                throw new Error("Either password or privateKeyPath must be provided");
            }
            this.validateProxyConfig(config.proxy);
            if (!config.localPath) {
                config.localPath = this.workspaceRoot;
            }
            const context = (config.context || "").trim();
            const candidateContext = context
                ? path.resolve(this.workspaceRoot, context)
                : this.workspaceRoot;
            if (!this.isWithinRoot(this.workspaceRoot, candidateContext)) {
                throw new Error("Context path must stay inside the workspace");
            }
            this.contextPath = this.resolvePathForContainmentCheck(candidateContext);
            if (!this.isWithinRoot(this.workspaceRoot, this.contextPath)) {
                throw new Error("Context path resolves outside the workspace");
            }
            const remotePath = path.posix.normalize(config.remotePath);
            if (!remotePath.startsWith("/")) {
                throw new Error("remotePath must be absolute");
            }
            if (remotePath.split("/").includes("..")) {
                throw new Error("remotePath must not contain parent directory segments");
            }
            config.remotePath = remotePath;
            this.config = config;
            this.configPath = configPath;
            this.ignorePatterns = [...(config.ignore || [])];
            if (!this.ignorePatterns.includes(".git")) {
                this.ignorePatterns.push(".git");
            }
            if (!this.ignorePatterns.includes("node_modules")) {
                this.ignorePatterns.push("node_modules");
            }
            return this.config;
        }
        catch (error) {
            throw new Error(`Failed to parse SFTP config: ${error}`);
        }
    }
    shouldIgnore(filePath) {
        const relativePath = path.relative(this.workspaceRoot, this.resolvePathForContainmentCheck(filePath));
        for (const pattern of this.ignorePatterns) {
            if ((0, minimatch_1.minimatch)(relativePath, pattern, { dot: true })) {
                return true;
            }
        }
        return false;
    }
    /**
     * Check if a file is within the context path
     */
    isInContext(filePath) {
        return this.isWithinRoot(this.contextPath, this.resolvePathForContainmentCheck(filePath));
    }
    /**
     * Get the remote path for a local file, respecting the context setting
     */
    getRemotePath(localFilePath) {
        if (!this.config) {
            return null;
        }
        // Check if file is within context
        if (!this.isInContext(localFilePath)) {
            return null;
        }
        const resolvedLocalPath = this.resolvePathForContainmentCheck(localFilePath);
        const relativePath = path.relative(this.contextPath, resolvedLocalPath);
        // Security check: prevent path traversal
        if (!relativePath || relativePath === ".") {
            return this.config.remotePath;
        }
        if (relativePath.split(path.sep).includes("..")) {
            throw new Error("Path traversal detected in file path");
        }
        const remoteFilePath = path.posix.join(this.config.remotePath, relativePath.split(path.sep).join("/"));
        if (!this.isWithinRemoteRoot(this.config.remotePath, remoteFilePath)) {
            throw new Error("Path traversal detected in remote path");
        }
        return remoteFilePath;
    }
    getConfig() {
        return this.config;
    }
    getConfigPath() {
        return this.configPath;
    }
    getContextPath() {
        return this.contextPath;
    }
    validateProxyConfig(proxy) {
        if (!proxy) {
            return;
        }
        if (proxy.type !== "socks5" && proxy.type !== "http") {
            throw new Error('proxy.type must be either "socks5" or "http"');
        }
        if (!proxy.host || !proxy.host.trim()) {
            throw new Error("proxy.host is required when proxy is configured");
        }
        if (!Number.isInteger(proxy.port) ||
            proxy.port < 1 ||
            proxy.port > 65535) {
            throw new Error("proxy.port must be an integer between 1 and 65535");
        }
        proxy.host = proxy.host.trim();
    }
    resolveExistingPath(targetPath) {
        return fs.realpathSync.native(path.resolve(targetPath));
    }
    resolvePathForContainmentCheck(targetPath) {
        const absoluteTarget = path.resolve(targetPath);
        const missingSegments = [];
        let current = absoluteTarget;
        while (!fs.existsSync(current)) {
            const parent = path.dirname(current);
            if (parent === current) {
                return absoluteTarget;
            }
            missingSegments.unshift(path.basename(current));
            current = parent;
        }
        const resolvedBase = fs.realpathSync.native(current);
        return path.resolve(resolvedBase, ...missingSegments);
    }
    isWithinRoot(rootPath, candidatePath) {
        const relativePath = path.relative(rootPath, candidatePath);
        return (relativePath === "" ||
            (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)));
    }
    isWithinRemoteRoot(remoteRoot, remotePath) {
        const relativePath = path.posix.relative(remoteRoot, remotePath);
        return (relativePath === "" ||
            (!relativePath.startsWith("..") && !path.posix.isAbsolute(relativePath)));
    }
    async saveConfig(config) {
        const configDir = path.join(this.workspaceFolder, ".zed");
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const configPath = path.join(configDir, "sftp.json");
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        this.config = config;
    }
    async reloadConfig() {
        return this.loadConfig();
    }
}
exports.ConfigManager = ConfigManager;
//# sourceMappingURL=config.js.map