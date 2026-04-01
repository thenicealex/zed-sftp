export interface ProxyConfig {
    type: "socks5" | "http";
    host: string;
    port: number;
    username?: string;
    password?: string;
}
export interface SftpConfig {
    name?: string;
    protocol: "sftp" | "ftp" | "ftps";
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    hostFingerprint?: string;
    proxy?: ProxyConfig;
    remotePath: string;
    localPath?: string;
    context?: string;
    uploadOnSave?: boolean;
    downloadOnOpen?: boolean;
    ignore?: string[];
    concurrency?: number;
    connectTimeout?: number;
    keepalive?: number;
    interactiveAuth?: boolean;
    algorithms?: {
        kex?: string[];
        cipher?: string[];
        serverHostKey?: string[];
        hmac?: string[];
    };
    watcher?: {
        files?: string;
        autoUpload?: boolean;
        autoDelete?: boolean;
    };
    profiles?: {
        [key: string]: Partial<SftpConfig>;
    };
    defaultProfile?: string;
}
export declare function resolveConfigPath(workspaceFolder: string): string | null;
export declare class ConfigManager {
    private workspaceFolder;
    private workspaceRoot;
    private config;
    private ignorePatterns;
    private contextPath;
    private configPath;
    constructor(workspaceFolder: string);
    loadConfig(): Promise<SftpConfig | null>;
    shouldIgnore(filePath: string): boolean;
    /**
     * Check if a file is within the context path
     */
    isInContext(filePath: string): boolean;
    /**
     * Get the remote path for a local file, respecting the context setting
     */
    getRemotePath(localFilePath: string): string | null;
    getConfig(): SftpConfig | null;
    getConfigPath(): string | null;
    getContextPath(): string;
    private validateProxyConfig;
    private resolveExistingPath;
    private resolvePathForContainmentCheck;
    private isWithinRoot;
    private isWithinRemoteRoot;
    saveConfig(config: SftpConfig): Promise<void>;
    reloadConfig(): Promise<SftpConfig | null>;
}
//# sourceMappingURL=config.d.ts.map