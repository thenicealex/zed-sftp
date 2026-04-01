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
exports.RuntimeManager = void 0;
exports.describeRuntimeState = describeRuntimeState;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const config_1 = require("./config");
function describeRuntimeState(state) {
    switch (state.kind) {
        case "ready":
            return null;
        case "invalid":
            return `SFTP config is invalid: ${state.error}`;
        case "unconfigured":
            return "No SFTP config found. Create .zed/sftp.json before using SFTP.";
    }
}
function stableValue(value) {
    if (Array.isArray(value)) {
        return value.map((entry) => stableValue(entry));
    }
    if (value && typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
            result[key] = stableValue(value[key]);
            return result;
        }, {});
    }
    return value;
}
function createConfigDigest(configPath, config, contextPath) {
    return JSON.stringify(stableValue({
        configPath,
        config,
        contextPath,
    }));
}
class RuntimeManager {
    constructor(options) {
        this.state = { kind: "unconfigured" };
        this.watchers = [];
        this.refreshTimer = null;
        this.refreshQueue = Promise.resolve();
        this.started = false;
        this.lastShownError = null;
        this.workspaceFolder = options.workspaceFolder;
        this.connection = options.connection;
        this.createClient = options.createClient;
        this.debounceMs = options.debounceMs ?? 75;
    }
    async start() {
        if (this.started) {
            return;
        }
        this.started = true;
        await this.refreshRuntime("startup");
    }
    async stop() {
        if (!this.started) {
            return;
        }
        this.started = false;
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
        this.disposeWatchers();
        await this.closeReadyClient(this.state);
        this.state = { kind: "unconfigured" };
        this.lastShownError = null;
    }
    getState() {
        return this.state;
    }
    getReadyState() {
        return this.state.kind === "ready" ? this.state : null;
    }
    getUnavailableMessage() {
        return (describeRuntimeState(this.state) ??
            "SFTP runtime is unavailable.");
    }
    async refreshRuntime(reason) {
        const nextRefresh = this.refreshQueue.then(() => this.performRefresh(reason), () => this.performRefresh(reason));
        this.refreshQueue = nextRefresh.catch(() => undefined);
        return nextRefresh;
    }
    async performRefresh(reason) {
        const activeConfigPath = (0, config_1.resolveConfigPath)(this.workspaceFolder);
        try {
            if (!activeConfigPath) {
                await this.setUnconfigured();
                return;
            }
            const configManager = new config_1.ConfigManager(this.workspaceFolder);
            const config = await configManager.loadConfig();
            if (!config) {
                await this.setUnconfigured();
                return;
            }
            const configPath = configManager.getConfigPath() ?? activeConfigPath;
            const configDigest = createConfigDigest(configPath, config, configManager.getContextPath());
            if (this.state.kind === "ready" &&
                this.state.configPath === configPath &&
                this.state.configDigest === configDigest) {
                return;
            }
            await this.closeReadyClient(this.state);
            const client = await this.createClient({
                config,
                configManager,
                connection: this.connection,
            });
            this.state = {
                kind: "ready",
                configPath,
                configDigest,
                config,
                configManager,
                client,
            };
            this.lastShownError = null;
            this.connection.console.log(`SFTP config loaded for ${config.host}`);
            if (config.context) {
                this.connection.console.log(`Context path: ${config.context} -> ${configManager.getContextPath()}`);
            }
            if (reason !== "startup") {
                this.connection.console.log(`SFTP config hot reloaded (${reason})`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await this.setInvalid(activeConfigPath, message);
        }
        finally {
            this.rebuildWatchers();
        }
    }
    async setInvalid(configPath, error) {
        await this.closeReadyClient(this.state);
        this.state = {
            kind: "invalid",
            configPath,
            error,
        };
        const message = describeRuntimeState(this.state);
        if (message && message !== this.lastShownError) {
            this.lastShownError = message;
            this.connection.console.error(message);
            void this.connection.window.showErrorMessage(message);
        }
    }
    async setUnconfigured() {
        const wasUnconfigured = this.state.kind === "unconfigured";
        await this.closeReadyClient(this.state);
        this.state = { kind: "unconfigured" };
        this.lastShownError = null;
        if (!wasUnconfigured) {
            this.connection.console.warn("No SFTP config found");
        }
    }
    async closeReadyClient(state) {
        if (state.kind !== "ready") {
            return;
        }
        if (this.state === state) {
            this.state = { kind: "unconfigured" };
        }
        try {
            await state.client.close();
        }
        catch (error) {
            this.connection.console.error(`Failed to close SFTP client: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    scheduleRefresh(reason) {
        if (!this.started) {
            return;
        }
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.refreshRuntime(reason);
        }, this.debounceMs);
    }
    rebuildWatchers() {
        this.disposeWatchers();
        this.watchDirectory(this.workspaceFolder, (fileName) => {
            return (fileName === null ||
                fileName === "sftp.json" ||
                fileName === ".zed" ||
                fileName === ".vscode");
        });
        const zedDir = path.join(this.workspaceFolder, ".zed");
        if (fs.existsSync(zedDir) && fs.statSync(zedDir).isDirectory()) {
            this.watchDirectory(zedDir, (fileName) => fileName === null || fileName === "sftp.json");
        }
        const vscodeDir = path.join(this.workspaceFolder, ".vscode");
        if (fs.existsSync(vscodeDir) && fs.statSync(vscodeDir).isDirectory()) {
            this.watchDirectory(vscodeDir, (fileName) => fileName === null || fileName === "sftp.json");
        }
    }
    watchDirectory(directoryPath, shouldRefresh) {
        try {
            const watcher = fs.watch(directoryPath, (_eventType, fileName) => {
                const normalizedFileName = typeof fileName === "string"
                    ? fileName
                    : fileName
                        ? String(fileName)
                        : null;
                if (!shouldRefresh(normalizedFileName)) {
                    return;
                }
                this.scheduleRefresh(`fs.watch:${directoryPath}`);
            });
            watcher.on("error", (error) => {
                this.connection.console.error(`SFTP config watcher error for ${directoryPath}: ${error.message}`);
                this.scheduleRefresh(`watch-error:${directoryPath}`);
            });
            this.watchers.push(watcher);
        }
        catch (error) {
            this.connection.console.error(`Failed to watch ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    disposeWatchers() {
        for (const watcher of this.watchers) {
            watcher.close();
        }
        this.watchers = [];
    }
}
exports.RuntimeManager = RuntimeManager;
//# sourceMappingURL=runtime.js.map