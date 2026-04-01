import { Connection } from "vscode-languageserver";
import { ConfigManager, SftpConfig } from "./config";
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
export type RuntimeState = ReadyRuntimeState | InvalidRuntimeState | UnconfiguredRuntimeState;
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
export declare function describeRuntimeState(state: RuntimeState): string | null;
export declare class RuntimeManager {
    private workspaceFolder;
    private connection;
    private createClient;
    private debounceMs;
    private state;
    private watchers;
    private refreshTimer;
    private refreshQueue;
    private started;
    private lastShownError;
    constructor(options: RuntimeManagerOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    getState(): RuntimeState;
    getReadyState(): ReadyRuntimeState | null;
    getUnavailableMessage(): string;
    refreshRuntime(reason: string): Promise<void>;
    private performRefresh;
    private setInvalid;
    private setUnconfigured;
    private closeReadyClient;
    private scheduleRefresh;
    private rebuildWatchers;
    private watchDirectory;
    private disposeWatchers;
}
//# sourceMappingURL=runtime.d.ts.map