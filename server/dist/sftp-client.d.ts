import { Connection } from 'vscode-languageserver';
import { SftpConfig, ConfigManager } from './config';
export declare class SftpClient {
    private client;
    private config;
    private connection;
    private configManager;
    private isConnected;
    constructor(config: SftpConfig, connection: Connection, configManager: ConfigManager);
    private connect;
    private disconnect;
    uploadFile(localPath: string): Promise<void>;
    downloadFile(localPath: string): Promise<void>;
    uploadFolder(localFolderPath: string): Promise<void>;
    downloadFolder(localFolderPath: string): Promise<void>;
    syncFolder(localFolderPath: string): Promise<void>;
    listRemoteFiles(remotePath: string): Promise<string[]>;
    deleteRemoteFile(remotePath: string): Promise<void>;
    close(): Promise<void>;
    private createProxySocket;
    private connectToProxy;
    private establishHttpTunnel;
    private establishSocks5Tunnel;
    private performSocks5Authentication;
    private createSocks5Address;
    private consumeSocks5ReplyAddress;
    private writeToSocket;
    private readSocketBytes;
    private readSocketUntil;
    private formatAuthority;
    private getSocks5ReplyError;
    private getExpectedHostFingerprint;
    private computeFingerprint;
    private secureCompare;
}
//# sourceMappingURL=sftp-client.d.ts.map