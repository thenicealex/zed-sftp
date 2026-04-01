import {
	createConnection,
	TextDocuments,
	ProposedFeatures,
	InitializeParams,
	TextDocumentSyncKind,
	InitializeResult,
	ExecuteCommandParams,
} from "vscode-languageserver/node";

import { TextDocument } from "vscode-languageserver-textdocument";
import * as path from "path";
import { SftpClient } from "./sftp-client";
import { RuntimeManager } from "./runtime";

// Add error handlers
process.on("uncaughtException", (error) => {
	console.error("Uncaught Exception:", error);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
});

// Create a connection for the server
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let workspaceFolder: string | undefined;
let runtime: RuntimeManager | undefined;

connection.onInitialize((params: InitializeParams) => {
	if (params.workspaceFolders && params.workspaceFolders.length > 0) {
		workspaceFolder = params.workspaceFolders[0].uri.replace("file://", "");
	}

	const result: InitializeResult = {
		capabilities: {
			textDocumentSync: {
				openClose: true,
				change: TextDocumentSyncKind.Full,
				save: {
					includeText: false,
				},
			},
			executeCommandProvider: {
				commands: ["sftp.upload", "sftp.download", "sftp.sync", "sftp.uploadFolder", "sftp.downloadFolder"],
			},
		},
	};

	return result;
});

connection.onInitialized(async () => {
	connection.console.log("SFTP Language Server initialized");

	if (workspaceFolder) {
		try {
			runtime = new RuntimeManager({
				workspaceFolder,
				connection,
				createClient: ({ config, configManager, connection: runtimeConnection }) =>
					new SftpClient(config, runtimeConnection as any, configManager),
			});
			await runtime.start();
		} catch (error) {
			connection.console.error(`Failed to initialize SFTP: ${error}`);
		}
	}
});

// Handle document save
documents.onDidSave(async (event) => {
	if (!runtime) {
		return;
	}

	const readyState = runtime.getReadyState();
	if (!readyState || !readyState.config.uploadOnSave) {
		return;
	}

	const filePath = event.document.uri.replace("file://", "");

	// Check if file is within context path
	if (!readyState.configManager.isInContext(filePath)) {
		connection.console.log(`File is outside context path: ${filePath}`);
		return;
	}

	// Check if file should be ignored
	if (readyState.configManager.shouldIgnore(filePath)) {
		connection.console.log(`Ignoring file: ${filePath}`);
		return;
	}

	try {
		connection.console.log(`Uploading file on save: ${filePath}`);
		await (readyState.client as SftpClient).uploadFile(filePath);
		connection.window.showInformationMessage(`Uploaded: ${path.basename(filePath)}`);
	} catch (error) {
		connection.console.error(`Failed to upload file: ${error}`);
		connection.window.showErrorMessage(`Failed to upload: ${error}`);
	}
});

// Handle commands
connection.onExecuteCommand(async (params: ExecuteCommandParams) => {
	if (!runtime) {
		connection.window.showErrorMessage("SFTP runtime is not initialized");
		return;
	}

	const readyState = runtime.getReadyState();
	if (!readyState) {
		connection.window.showErrorMessage(runtime.getUnavailableMessage());
		return;
	}

	const client = readyState.client as SftpClient;

	try {
		switch (params.command) {
			case "sftp.upload":
				if (params.arguments && params.arguments[0]) {
					const filePath = params.arguments[0] as string;
					await client.uploadFile(filePath);
					connection.window.showInformationMessage(`Uploaded: ${path.basename(filePath)}`);
				}
				break;

			case "sftp.download":
				if (params.arguments && params.arguments[0]) {
					const filePath = params.arguments[0] as string;
					await client.downloadFile(filePath);
					connection.window.showInformationMessage(`Downloaded: ${path.basename(filePath)}`);
				}
				break;

			case "sftp.sync":
				await client.syncFolder(workspaceFolder!);
				connection.window.showInformationMessage("Sync completed");
				break;

			case "sftp.uploadFolder":
				if (params.arguments && params.arguments[0]) {
					const folderPath = params.arguments[0] as string;
					await client.uploadFolder(folderPath);
					connection.window.showInformationMessage(`Uploaded folder: ${path.basename(folderPath)}`);
				}
				break;

			case "sftp.downloadFolder":
				if (params.arguments && params.arguments[0]) {
					const folderPath = params.arguments[0] as string;
					await client.downloadFolder(folderPath);
					connection.window.showInformationMessage(`Downloaded folder: ${path.basename(folderPath)}`);
				}
				break;

			default:
				connection.window.showErrorMessage(`Unknown command: ${params.command}`);
		}
	} catch (error) {
		connection.console.error(`Command failed: ${error}`);
		connection.window.showErrorMessage(`Command failed: ${error}`);
	}
});

connection.onShutdown(async () => {
	if (runtime) {
		await runtime.stop();
	}
});

// Make the text document manager listen on the connection
documents.listen(connection);

// Listen on the connection
connection.listen();
