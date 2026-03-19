use zed_extension_api as zed;

struct SftpExtension;

impl zed::Extension for SftpExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        // Zed runs extensions from their installation directory, so we can use
        // the current directory to find our server files
        let extension_dir = std::env::current_dir()
            .map_err(|e| format!("Failed to get current directory: {}", e))?;

        let server_path = extension_dir.join("server").join("bootstrap.js");

        // Verify server file exists
        if !server_path.exists() {
            return Err(format!(
                "Server bootstrap file not found at {:?}. Extension directory: {:?}",
                server_path, extension_dir
            )
            .into());
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![
                server_path.to_string_lossy().to_string(),
                "--stdio".to_string(),
            ],
            env: worktree.shell_env(),
        })
    }
}

zed::register_extension!(SftpExtension);
