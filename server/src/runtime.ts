import * as fs from "fs";
import * as path from "path";
import { Connection } from "vscode-languageserver";
import { ConfigManager, SftpConfig, resolveConfigPath } from "./config";

export interface ManagedClient {
  close(): Promise<void>;
}

export interface ReadyRuntimeState {
  kind: "ready";
  configPath: string;
  configDigest: string;
  config: SftpConfig;
  configManager: ConfigManager;
  client: ManagedClient;
}

export interface InvalidRuntimeState {
  kind: "invalid";
  configPath: string | null;
  error: string;
}

export interface UnconfiguredRuntimeState {
  kind: "unconfigured";
}

export type RuntimeState =
  | ReadyRuntimeState
  | InvalidRuntimeState
  | UnconfiguredRuntimeState;

export interface RuntimeManagerOptions {
  workspaceFolder: string;
  connection: Pick<Connection, "console" | "window">;
  createClient: (options: {
    config: SftpConfig;
    configManager: ConfigManager;
    connection: Pick<Connection, "console" | "window">;
  }) => ManagedClient | Promise<ManagedClient>;
  debounceMs?: number;
}

export function describeRuntimeState(state: RuntimeState): string | null {
  switch (state.kind) {
    case "ready":
      return null;
    case "invalid":
      return `SFTP config is invalid: ${state.error}`;
    case "unconfigured":
      return "No SFTP config found. Create .zed/sftp.json before using SFTP.";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => stableValue(entry));
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = stableValue((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }

  return value;
}

function createConfigDigest(
  configPath: string,
  config: SftpConfig,
  contextPath: string,
): string {
  return JSON.stringify(
    stableValue({
      configPath,
      config,
      contextPath,
    }),
  );
}

export class RuntimeManager {
  private workspaceFolder: string;
  private connection: Pick<Connection, "console" | "window">;
  private createClient: RuntimeManagerOptions["createClient"];
  private debounceMs: number;
  private state: RuntimeState = { kind: "unconfigured" };
  private watchers: fs.FSWatcher[] = [];
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshQueue: Promise<void> = Promise.resolve();
  private started: boolean = false;
  private lastShownError: string | null = null;

  constructor(options: RuntimeManagerOptions) {
    this.workspaceFolder = options.workspaceFolder;
    this.connection = options.connection;
    this.createClient = options.createClient;
    this.debounceMs = options.debounceMs ?? 75;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    await this.refreshRuntime("startup");
  }

  async stop(): Promise<void> {
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

  getState(): RuntimeState {
    return this.state;
  }

  getReadyState(): ReadyRuntimeState | null {
    return this.state.kind === "ready" ? this.state : null;
  }

  getUnavailableMessage(): string {
    return (
      describeRuntimeState(this.state) ??
      "SFTP runtime is unavailable."
    );
  }

  async refreshRuntime(reason: string): Promise<void> {
    const nextRefresh = this.refreshQueue.then(
      () => this.performRefresh(reason),
      () => this.performRefresh(reason),
    );
    this.refreshQueue = nextRefresh.catch(() => undefined);
    return nextRefresh;
  }

  private async performRefresh(reason: string): Promise<void> {
    const activeConfigPath = resolveConfigPath(this.workspaceFolder);

    try {
      if (!activeConfigPath) {
        await this.setUnconfigured();
        return;
      }

      const configManager = new ConfigManager(this.workspaceFolder);
      const config = await configManager.loadConfig();

      if (!config) {
        await this.setUnconfigured();
        return;
      }

      const configPath = configManager.getConfigPath() ?? activeConfigPath;
      const configDigest = createConfigDigest(
        configPath,
        config,
        configManager.getContextPath(),
      );

      if (
        this.state.kind === "ready" &&
        this.state.configPath === configPath &&
        this.state.configDigest === configDigest
      ) {
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
        this.connection.console.log(
          `Context path: ${config.context} -> ${configManager.getContextPath()}`,
        );
      }
      if (reason !== "startup") {
        this.connection.console.log(`SFTP config hot reloaded (${reason})`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.setInvalid(activeConfigPath, message);
    } finally {
      this.rebuildWatchers();
    }
  }

  private async setInvalid(
    configPath: string | null,
    error: string,
  ): Promise<void> {
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

  private async setUnconfigured(): Promise<void> {
    const wasUnconfigured = this.state.kind === "unconfigured";
    await this.closeReadyClient(this.state);
    this.state = { kind: "unconfigured" };
    this.lastShownError = null;
    if (!wasUnconfigured) {
      this.connection.console.warn("No SFTP config found");
    }
  }

  private async closeReadyClient(state: RuntimeState): Promise<void> {
    if (state.kind !== "ready") {
      return;
    }

    if (this.state === state) {
      this.state = { kind: "unconfigured" };
    }

    try {
      await state.client.close();
    } catch (error) {
      this.connection.console.error(
        `Failed to close SFTP client: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private scheduleRefresh(reason: string): void {
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

  private rebuildWatchers(): void {
    this.disposeWatchers();

    this.watchDirectory(this.workspaceFolder, (fileName) => {
      return (
        fileName === null ||
        fileName === "sftp.json" ||
        fileName === ".zed" ||
        fileName === ".vscode"
      );
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

  private watchDirectory(
    directoryPath: string,
    shouldRefresh: (fileName: string | null) => boolean,
  ): void {
    try {
      const watcher = fs.watch(directoryPath, (_eventType, fileName) => {
        const normalizedFileName =
          typeof fileName === "string"
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
        this.connection.console.error(
          `SFTP config watcher error for ${directoryPath}: ${error.message}`,
        );
        this.scheduleRefresh(`watch-error:${directoryPath}`);
      });

      this.watchers.push(watcher);
    } catch (error) {
      this.connection.console.error(
        `Failed to watch ${directoryPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.close();
    }

    this.watchers = [];
  }
}
