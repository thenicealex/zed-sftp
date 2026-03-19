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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SftpClient = void 0;
const ssh2_sftp_client_1 = __importDefault(require("ssh2-sftp-client"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const net = __importStar(require("net"));
const crypto_1 = require("crypto");
class SftpClient {
    constructor(config, connection, configManager) {
        this.isConnected = false;
        this.client = new ssh2_sftp_client_1.default();
        this.config = config;
        this.connection = connection;
        this.configManager = configManager;
    }
    async connect() {
        if (this.isConnected) {
            return;
        }
        let proxySocket = null;
        try {
            const connectConfig = {
                host: this.config.host,
                port: this.config.port || 22,
                username: this.config.username,
            };
            const expectedFingerprint = this.getExpectedHostFingerprint();
            if (expectedFingerprint) {
                connectConfig.hostVerifier = (hostKey) => {
                    const actualFingerprint = this.computeFingerprint(hostKey, expectedFingerprint.algorithm);
                    return this.secureCompare(actualFingerprint, expectedFingerprint.value);
                };
            }
            proxySocket = await this.createProxySocket();
            if (proxySocket) {
                connectConfig.sock = proxySocket;
            }
            // Handle authentication
            if (this.config.password) {
                connectConfig.password = this.config.password;
            }
            else if (this.config.privateKeyPath) {
                const keyPath = this.config.privateKeyPath.replace('~', process.env.HOME || '');
                connectConfig.privateKey = fs.readFileSync(keyPath);
                if (this.config.passphrase) {
                    connectConfig.passphrase = this.config.passphrase;
                }
            }
            // Connection timeout
            if (this.config.connectTimeout) {
                connectConfig.readyTimeout = this.config.connectTimeout;
            }
            await this.client.connect(connectConfig);
            this.isConnected = true;
            this.connection.console.log(`Connected to ${this.config.host}`);
        }
        catch (error) {
            this.isConnected = false;
            if (proxySocket && !proxySocket.destroyed) {
                proxySocket.destroy();
            }
            throw new Error(`Failed to connect to SFTP server: ${error}`);
        }
    }
    async disconnect() {
        if (this.isConnected) {
            await this.client.end();
            this.isConnected = false;
        }
    }
    async uploadFile(localPath) {
        await this.connect();
        try {
            // Use ConfigManager to get remote path (respects context setting)
            const remotePath = this.configManager.getRemotePath(localPath);
            if (!remotePath) {
                this.connection.console.warn(`File is outside context path: ${localPath}`);
                return;
            }
            const remoteDir = path.posix.dirname(remotePath);
            // Ensure remote directory exists
            await this.client.mkdir(remoteDir, true);
            // Upload file
            await this.client.put(localPath, remotePath);
            this.connection.console.log(`Uploaded: ${localPath} -> ${remotePath}`);
        }
        catch (error) {
            throw new Error(`Failed to upload file: ${error}`);
        }
    }
    async downloadFile(localPath) {
        await this.connect();
        try {
            const remotePath = this.configManager.getRemotePath(localPath);
            if (!remotePath) {
                this.connection.console.warn(`File is outside context path: ${localPath}`);
                return;
            }
            const localDir = path.dirname(localPath);
            // Ensure local directory exists
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            // Download file
            await this.client.get(remotePath, localPath);
            this.connection.console.log(`Downloaded: ${remotePath} -> ${localPath}`);
        }
        catch (error) {
            throw new Error(`Failed to download file: ${error}`);
        }
    }
    async uploadFolder(localFolderPath) {
        await this.connect();
        try {
            const remoteFolderPath = this.configManager.getRemotePath(localFolderPath);
            if (!remoteFolderPath) {
                this.connection.console.warn(`Folder is outside context path: ${localFolderPath}`);
                return;
            }
            // Upload directory recursively
            await this.client.uploadDir(localFolderPath, remoteFolderPath);
            this.connection.console.log(`Uploaded folder: ${localFolderPath} -> ${remoteFolderPath}`);
        }
        catch (error) {
            throw new Error(`Failed to upload folder: ${error}`);
        }
    }
    async downloadFolder(localFolderPath) {
        await this.connect();
        try {
            const remoteFolderPath = this.configManager.getRemotePath(localFolderPath);
            if (!remoteFolderPath) {
                this.connection.console.warn(`Folder is outside context path: ${localFolderPath}`);
                return;
            }
            // Ensure local directory exists
            if (!fs.existsSync(localFolderPath)) {
                fs.mkdirSync(localFolderPath, { recursive: true });
            }
            // Download directory recursively
            await this.client.downloadDir(remoteFolderPath, localFolderPath);
            this.connection.console.log(`Downloaded folder: ${remoteFolderPath} -> ${localFolderPath}`);
        }
        catch (error) {
            throw new Error(`Failed to download folder: ${error}`);
        }
    }
    async syncFolder(localFolderPath) {
        await this.connect();
        try {
            const remoteFolderPath = this.configManager.getRemotePath(localFolderPath);
            if (!remoteFolderPath) {
                this.connection.console.warn(`Folder is outside context path: ${localFolderPath}`);
                return;
            }
            // Upload directory (this will sync local to remote)
            await this.client.uploadDir(localFolderPath, remoteFolderPath);
            this.connection.console.log(`Synced folder: ${localFolderPath} -> ${remoteFolderPath}`);
        }
        catch (error) {
            throw new Error(`Failed to sync folder: ${error}`);
        }
    }
    async listRemoteFiles(remotePath) {
        await this.connect();
        try {
            const list = await this.client.list(remotePath);
            return list.map((item) => item.name);
        }
        catch (error) {
            throw new Error(`Failed to list remote files: ${error}`);
        }
    }
    async deleteRemoteFile(remotePath) {
        await this.connect();
        try {
            await this.client.delete(remotePath);
            this.connection.console.log(`Deleted remote file: ${remotePath}`);
        }
        catch (error) {
            throw new Error(`Failed to delete remote file: ${error}`);
        }
    }
    async close() {
        await this.disconnect();
    }
    async createProxySocket() {
        const proxy = this.config.proxy;
        if (!proxy) {
            return null;
        }
        const socket = await this.connectToProxy(proxy);
        try {
            if (proxy.type === 'socks5') {
                await this.establishSocks5Tunnel(socket, proxy);
            }
            else {
                await this.establishHttpTunnel(socket, proxy);
            }
            socket.setTimeout(0);
            return socket;
        }
        catch (error) {
            socket.destroy();
            throw error;
        }
    }
    async connectToProxy(proxy) {
        return await new Promise((resolve, reject) => {
            const socket = net.createConnection({
                host: proxy.host,
                port: proxy.port,
            });
            const cleanup = () => {
                socket.removeListener('connect', onConnect);
                socket.removeListener('error', onError);
                socket.removeListener('timeout', onTimeout);
            };
            const onConnect = () => {
                cleanup();
                resolve(socket);
            };
            const onError = (error) => {
                cleanup();
                reject(new Error(`Failed to connect to ${proxy.type} proxy ${proxy.host}:${proxy.port}: ${error.message}`));
            };
            const onTimeout = () => {
                cleanup();
                reject(new Error(`Timed out connecting to ${proxy.type} proxy ${proxy.host}:${proxy.port}`));
            };
            if (this.config.connectTimeout) {
                socket.setTimeout(this.config.connectTimeout);
            }
            socket.once('connect', onConnect);
            socket.once('error', onError);
            socket.once('timeout', onTimeout);
        });
    }
    async establishHttpTunnel(socket, proxy) {
        const authority = this.formatAuthority(this.config.host, this.config.port || 22);
        const headers = [
            `CONNECT ${authority} HTTP/1.1`,
            `Host: ${authority}`,
            'Proxy-Connection: Keep-Alive',
        ];
        if (proxy.username !== undefined || proxy.password !== undefined) {
            const encodedCredentials = Buffer.from(`${proxy.username || ''}:${proxy.password || ''}`).toString('base64');
            headers.push(`Proxy-Authorization: Basic ${encodedCredentials}`);
        }
        await this.writeToSocket(socket, `${headers.join('\r\n')}\r\n\r\n`);
        const response = await this.readSocketUntil(socket, (buffer) => buffer.indexOf('\r\n\r\n') !== -1, 'Failed to establish HTTP proxy tunnel');
        const headerEnd = response.indexOf('\r\n\r\n');
        const responseHead = response.subarray(0, headerEnd).toString('utf8');
        const statusLine = responseHead.split('\r\n')[0] || '';
        const statusMatch = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
        if (!statusMatch) {
            throw new Error(`Failed to establish HTTP proxy tunnel: unexpected response "${statusLine}"`);
        }
        if (statusMatch[1] !== '200') {
            throw new Error(`Failed to establish HTTP proxy tunnel: status ${statusMatch[1]}`);
        }
        const remaining = response.subarray(headerEnd + 4);
        if (remaining.length > 0) {
            socket.unshift(remaining);
        }
    }
    async establishSocks5Tunnel(socket, proxy) {
        const requiresAuth = proxy.username !== undefined || proxy.password !== undefined;
        const methods = requiresAuth ? [0x00, 0x02] : [0x00];
        await this.writeToSocket(socket, Buffer.from([0x05, methods.length, ...methods]));
        const negotiation = await this.readSocketBytes(socket, 2, 'Failed to negotiate SOCKS5 authentication');
        if (negotiation[0] !== 0x05) {
            throw new Error('Failed to negotiate SOCKS5 authentication: invalid proxy version');
        }
        if (negotiation[1] === 0xff) {
            throw new Error('Failed to negotiate SOCKS5 authentication: proxy rejected all auth methods');
        }
        if (negotiation[1] === 0x02) {
            await this.performSocks5Authentication(socket, proxy);
        }
        else if (negotiation[1] !== 0x00) {
            throw new Error(`Failed to negotiate SOCKS5 authentication: unsupported auth method 0x${negotiation[1].toString(16)}`);
        }
        const address = this.createSocks5Address(this.config.host);
        const port = this.config.port || 22;
        const connectRequest = Buffer.concat([
            Buffer.from([0x05, 0x01, 0x00]),
            address,
            Buffer.from([(port >> 8) & 0xff, port & 0xff]),
        ]);
        await this.writeToSocket(socket, connectRequest);
        const replyHeader = await this.readSocketBytes(socket, 4, 'Failed to establish SOCKS5 proxy tunnel');
        if (replyHeader[0] !== 0x05) {
            throw new Error('Failed to establish SOCKS5 proxy tunnel: invalid proxy version');
        }
        if (replyHeader[1] !== 0x00) {
            throw new Error(`Failed to establish SOCKS5 proxy tunnel: ${this.getSocks5ReplyError(replyHeader[1])}`);
        }
        await this.consumeSocks5ReplyAddress(socket, replyHeader[3], 'Failed to establish SOCKS5 proxy tunnel');
    }
    async performSocks5Authentication(socket, proxy) {
        const username = Buffer.from(proxy.username || '', 'utf8');
        const password = Buffer.from(proxy.password || '', 'utf8');
        if (username.length > 255 || password.length > 255) {
            throw new Error('Failed to negotiate SOCKS5 authentication: username and password must be at most 255 bytes');
        }
        const authRequest = Buffer.concat([
            Buffer.from([0x01, username.length]),
            username,
            Buffer.from([password.length]),
            password,
        ]);
        await this.writeToSocket(socket, authRequest);
        const authReply = await this.readSocketBytes(socket, 2, 'Failed to negotiate SOCKS5 authentication');
        if (authReply[0] !== 0x01 || authReply[1] !== 0x00) {
            throw new Error('Failed to negotiate SOCKS5 authentication: proxy rejected credentials');
        }
    }
    createSocks5Address(host) {
        if (net.isIP(host) === 4) {
            return Buffer.from([0x01, ...host.split('.').map((part) => Number(part))]);
        }
        const hostBuffer = Buffer.from(host, 'utf8');
        if (hostBuffer.length > 255) {
            throw new Error('Failed to establish SOCKS5 proxy tunnel: host name is too long');
        }
        return Buffer.concat([Buffer.from([0x03, hostBuffer.length]), hostBuffer]);
    }
    async consumeSocks5ReplyAddress(socket, addressType, context) {
        if (addressType === 0x01) {
            await this.readSocketBytes(socket, 6, context);
            return;
        }
        if (addressType === 0x04) {
            await this.readSocketBytes(socket, 18, context);
            return;
        }
        if (addressType === 0x03) {
            const length = await this.readSocketBytes(socket, 1, context);
            await this.readSocketBytes(socket, length[0] + 2, context);
            return;
        }
        throw new Error(`${context}: unsupported address type 0x${addressType.toString(16)}`);
    }
    async writeToSocket(socket, chunk) {
        await new Promise((resolve, reject) => {
            socket.write(chunk, (error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        });
    }
    async readSocketBytes(socket, minimumBytes, context) {
        const response = await this.readSocketUntil(socket, (buffer) => buffer.length >= minimumBytes, context);
        if (response.length > minimumBytes) {
            socket.unshift(response.subarray(minimumBytes));
        }
        return response.subarray(0, minimumBytes);
    }
    async readSocketUntil(socket, isComplete, context) {
        return await new Promise((resolve, reject) => {
            let data = Buffer.alloc(0);
            const cleanup = () => {
                socket.removeListener('data', onData);
                socket.removeListener('error', onError);
                socket.removeListener('close', onClose);
                socket.removeListener('end', onEnd);
                socket.removeListener('timeout', onTimeout);
            };
            const onData = (chunk) => {
                data = Buffer.concat([data, chunk]);
                if (isComplete(data)) {
                    cleanup();
                    resolve(data);
                }
            };
            const onError = (error) => {
                cleanup();
                reject(new Error(`${context}: ${error.message}`));
            };
            const onClose = () => {
                cleanup();
                reject(new Error(`${context}: proxy socket closed unexpectedly`));
            };
            const onEnd = () => {
                cleanup();
                reject(new Error(`${context}: proxy socket ended unexpectedly`));
            };
            const onTimeout = () => {
                cleanup();
                reject(new Error(`${context}: proxy socket timed out`));
            };
            socket.on('data', onData);
            socket.once('error', onError);
            socket.once('close', onClose);
            socket.once('end', onEnd);
            socket.once('timeout', onTimeout);
        });
    }
    formatAuthority(host, port) {
        return net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
    }
    getSocks5ReplyError(code) {
        const replyMessages = {
            0x01: 'general SOCKS server failure',
            0x02: 'connection not allowed by ruleset',
            0x03: 'network unreachable',
            0x04: 'host unreachable',
            0x05: 'connection refused',
            0x06: 'TTL expired',
            0x07: 'command not supported',
            0x08: 'address type not supported',
        };
        return replyMessages[code] || `proxy returned error 0x${code.toString(16)}`;
    }
    getExpectedHostFingerprint() {
        const fingerprint = this.config.hostFingerprint?.trim();
        if (!fingerprint) {
            return null;
        }
        if (fingerprint.toUpperCase().startsWith('MD5:')) {
            return {
                algorithm: 'md5',
                value: fingerprint.slice(4).toLowerCase().replace(/:/g, ''),
            };
        }
        const normalized = fingerprint.toUpperCase().startsWith('SHA256:')
            ? fingerprint.slice(7)
            : fingerprint;
        return {
            algorithm: 'sha256',
            value: normalized.replace(/=+$/g, ''),
        };
    }
    computeFingerprint(hostKey, algorithm) {
        const digest = (0, crypto_1.createHash)(algorithm).update(hostKey).digest(algorithm === 'md5' ? 'hex' : 'base64');
        return algorithm === 'md5' ? digest.toLowerCase() : digest.replace(/=+$/g, '');
    }
    secureCompare(left, right) {
        const leftBuffer = Buffer.from(left);
        const rightBuffer = Buffer.from(right);
        if (leftBuffer.length !== rightBuffer.length) {
            return false;
        }
        return (0, crypto_1.timingSafeEqual)(leftBuffer, rightBuffer);
    }
}
exports.SftpClient = SftpClient;
//# sourceMappingURL=sftp-client.js.map