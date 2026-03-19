type SlashAction = "upload" | "download" | "sync";
interface ResolveSlashCommandRequestOptions {
    action: SlashAction;
    args: string[];
    workspaceFolder: string;
    contextPath: string;
}
interface SlashCommandRequest {
    action: SlashAction;
    targetPath: string;
}
export declare function resolveSlashCommandRequest(options: ResolveSlashCommandRequestOptions): SlashCommandRequest;
export declare function runSlashCommand(action: SlashAction, workspaceFolder: string, rawArgs: string[]): Promise<string>;
export {};
//# sourceMappingURL=slash-command.d.ts.map