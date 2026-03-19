import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";

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
  remotePath: string;
  localPath?: string;
  context?: string; // Local subdirectory to use as root (e.g., "site/wp-content/")
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

export class ConfigManager {
  private workspaceFolder: string;
  private workspaceRoot: string;
  private config: SftpConfig | null = null;
  private ignorePatterns: string[] = [];
  private contextPath: string = ""; // Resolved context path

  constructor(workspaceFolder: string) {
    this.workspaceFolder = workspaceFolder;
    this.workspaceRoot = this.resolveExistingPath(workspaceFolder);
    this.contextPath = this.workspaceRoot;
  }

  async loadConfig(): Promise<SftpConfig | null> {
    // Try .zed/sftp.json first
    let configPath = path.join(this.workspaceFolder, ".zed", "sftp.json");

    if (!fs.existsSync(configPath)) {
      // Fall back to .vscode/sftp.json for compatibility
      configPath = path.join(this.workspaceFolder, ".vscode", "sftp.json");
    }

    if (!fs.existsSync(configPath)) {
      // Try root level sftp.json
      configPath = path.join(this.workspaceFolder, "sftp.json");
    }

    if (!fs.existsSync(configPath)) {
      return null;
    }

    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      const rawConfig = JSON.parse(configContent) as SftpConfig | null;
      if (!rawConfig) {
        throw new Error("Config is empty");
      }

      let config = rawConfig;
      if (rawConfig.profiles && rawConfig.defaultProfile) {
        const profile = rawConfig.profiles[rawConfig.defaultProfile];
        if (!profile) {
          throw new Error(
            `Unknown defaultProfile: ${rawConfig.defaultProfile}`,
          );
        }
        config = { ...rawConfig, ...profile };
      }

      if (!config.host) {
        throw new Error("Missing required field: host");
      }

      if (config.protocol !== "sftp") {
        throw new Error(
          `Unsupported protocol: ${config.protocol}. Only "sftp" is currently implemented.`,
        );
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
        throw new Error(
          "remotePath must not contain parent directory segments",
        );
      }
      config.remotePath = remotePath;

      this.config = config;
      this.ignorePatterns = [...(config.ignore || [])];

      if (!this.ignorePatterns.includes(".git")) {
        this.ignorePatterns.push(".git");
      }
      if (!this.ignorePatterns.includes("node_modules")) {
        this.ignorePatterns.push("node_modules");
      }

      return this.config;
    } catch (error) {
      throw new Error(`Failed to parse SFTP config: ${error}`);
    }
  }

  shouldIgnore(filePath: string): boolean {
    const relativePath = path.relative(
      this.workspaceRoot,
      this.resolvePathForContainmentCheck(filePath),
    );

    for (const pattern of this.ignorePatterns) {
      if (minimatch(relativePath, pattern, { dot: true })) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a file is within the context path
   */
  isInContext(filePath: string): boolean {
    return this.isWithinRoot(
      this.contextPath,
      this.resolvePathForContainmentCheck(filePath),
    );
  }

  /**
   * Get the remote path for a local file, respecting the context setting
   */
  getRemotePath(localFilePath: string): string | null {
    if (!this.config) {
      return null;
    }

    // Check if file is within context
    if (!this.isInContext(localFilePath)) {
      return null;
    }

    const resolvedLocalPath =
      this.resolvePathForContainmentCheck(localFilePath);
    const relativePath = path.relative(this.contextPath, resolvedLocalPath);

    // Security check: prevent path traversal
    if (!relativePath || relativePath === ".") {
      return this.config.remotePath;
    }

    if (relativePath.split(path.sep).includes("..")) {
      throw new Error("Path traversal detected in file path");
    }

    const remoteFilePath = path.posix.join(
      this.config.remotePath,
      relativePath.split(path.sep).join("/"),
    );
    if (!this.isWithinRemoteRoot(this.config.remotePath, remoteFilePath)) {
      throw new Error("Path traversal detected in remote path");
    }

    return remoteFilePath;
  }

  getConfig(): SftpConfig | null {
    return this.config;
  }

  getContextPath(): string {
    return this.contextPath;
  }

  private resolveExistingPath(targetPath: string): string {
    return fs.realpathSync.native(path.resolve(targetPath));
  }

  private resolvePathForContainmentCheck(targetPath: string): string {
    const absoluteTarget = path.resolve(targetPath);
    const missingSegments: string[] = [];
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

  private isWithinRoot(rootPath: string, candidatePath: string): boolean {
    const relativePath = path.relative(rootPath, candidatePath);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
  }

  private isWithinRemoteRoot(remoteRoot: string, remotePath: string): boolean {
    const relativePath = path.posix.relative(remoteRoot, remotePath);
    return (
      relativePath === "" ||
      (!relativePath.startsWith("..") && !path.posix.isAbsolute(relativePath))
    );
  }

  async saveConfig(config: SftpConfig): Promise<void> {
    const configDir = path.join(this.workspaceFolder, ".zed");

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const configPath = path.join(configDir, "sftp.json");
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    this.config = config;
  }

  async reloadConfig(): Promise<SftpConfig | null> {
    return this.loadConfig();
  }
}
