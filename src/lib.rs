use zed_extension_api as zed;

use std::path::{Path, PathBuf};

const EXTENSION_ID: &str = "sftp";
const SERVER_BOOTSTRAP_LABEL: &str = "Server bootstrap file";
const SERVER_BOOTSTRAP_PATH: &str = "server/bootstrap.js";
const SLASH_COMMAND_BOOTSTRAP_LABEL: &str = "Slash command bootstrap file";
const SLASH_COMMAND_BOOTSTRAP_PATH: &str = "server/slash-command-bootstrap.js";
const NODE_SCRIPT_RESOLVER: &str = r#"const fs=require("fs");
const args=process.argv.slice(1);
const separatorIndex=args.indexOf("--");
if(separatorIndex===-1){
  console.error("[SFTP] Internal error: missing candidate separator.");
  process.exit(1);
}
const label=args[0];
const candidates=args.slice(1, separatorIndex);
const forwardedArgs=args.slice(separatorIndex + 1);
const scriptPath=candidates.find((candidate)=>fs.existsSync(candidate));
if(!scriptPath){
  console.error(`[SFTP] ${label} not found. Checked: [${candidates.join(", ")}].`);
  process.exit(1);
}
process.argv=[process.argv[0], scriptPath, ...forwardedArgs];
require(scriptPath);"#;

struct SftpExtension;

fn installed_extension_dir(current_dir: &Path) -> Option<PathBuf> {
    current_dir
        .ancestors()
        .find(|ancestor| ancestor.file_name().and_then(|name| name.to_str()) == Some("extensions"))
        .map(|extensions_dir| extensions_dir.join("installed").join(EXTENSION_ID))
}

fn host_extension_dir_candidates(current_dir: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![current_dir.to_path_buf()];

    if let Some(installed_dir) = installed_extension_dir(current_dir) {
        if installed_dir != current_dir {
            candidates.push(installed_dir);
        }
    }

    candidates
}

fn host_script_candidates(current_dir: &Path, script_relative_path: &str) -> Vec<String> {
    host_extension_dir_candidates(current_dir)
        .into_iter()
        .map(|candidate| {
            candidate
                .join(script_relative_path)
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

fn node_script_launcher_args(
    current_dir: &Path,
    label: &str,
    script_relative_path: &str,
    forwarded_args: Vec<String>,
) -> Vec<String> {
    let script_candidates = host_script_candidates(current_dir, script_relative_path);
    let mut args = Vec::with_capacity(4 + script_candidates.len() + forwarded_args.len());
    args.push("-e".to_string());
    args.push(NODE_SCRIPT_RESOLVER.to_string());
    args.push(label.to_string());
    args.extend(script_candidates);
    args.push("--".to_string());
    args.extend(forwarded_args);
    args
}

fn current_host_extension_dir() -> zed::Result<PathBuf> {
    std::env::var("PWD")
        .map(PathBuf::from)
        .map_err(|e| format!("Failed to read PWD from the extension host: {}", e).into())
}

fn slash_command_action(command_name: &str) -> Result<&'static str, String> {
    match command_name {
        "sftp-upload" => Ok("upload"),
        "sftp-download" => Ok("download"),
        "sftp-sync" => Ok("sync"),
        other => Err(format!("Unknown slash command: {}", other)),
    }
}

fn node_command_for_script(
    current_dir: &Path,
    label: &str,
    script_relative_path: &str,
    forwarded_args: Vec<String>,
    env: zed::EnvVars,
) -> zed::Result<zed::Command> {
    Ok(zed::Command {
        command: zed::node_binary_path()?,
        args: node_script_launcher_args(current_dir, label, script_relative_path, forwarded_args),
        env,
    })
}

impl zed::Extension for SftpExtension {
    fn new() -> Self {
        Self
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> zed::Result<zed::Command> {
        let current_dir = current_host_extension_dir()?;

        node_command_for_script(
            &current_dir,
            SERVER_BOOTSTRAP_LABEL,
            SERVER_BOOTSTRAP_PATH,
            vec!["--stdio".to_string()],
            worktree.shell_env(),
        )
    }

    fn run_slash_command(
        &self,
        command: zed::SlashCommand,
        args: Vec<String>,
        worktree: Option<&zed::Worktree>,
    ) -> zed::Result<zed::SlashCommandOutput, String> {
        let worktree = worktree.ok_or_else(|| {
            "SFTP slash commands require a project worktree so the extension can find .zed/sftp.json"
                .to_string()
        })?;
        let current_dir = current_host_extension_dir()?;

        let action = slash_command_action(command.name.as_str())?;
        let launcher_args = node_script_launcher_args(
            &current_dir,
            SLASH_COMMAND_BOOTSTRAP_LABEL,
            SLASH_COMMAND_BOOTSTRAP_PATH,
            vec![action.to_string(), worktree.root_path()],
        );

        let mut process = zed::process::Command::new(zed::node_binary_path()?);
        process = process.args(launcher_args).envs(worktree.shell_env());

        let joined_args = args.join(" ");
        if !joined_args.trim().is_empty() {
            process = process.arg(joined_args);
        }

        let output = process.output()?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

        if output.status != Some(0) {
            let message = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!(
                "SFTP {} failed: {}",
                action,
                if message.is_empty() {
                    "unknown error".to_string()
                } else {
                    message.to_string()
                }
            ));
        }

        let text = stdout;
        let section = zed::SlashCommandOutputSection {
            range: (0..text.len()).into(),
            label: format!("SFTP {}", action),
        };

        Ok(zed::SlashCommandOutput {
            text,
            sections: vec![section],
        })
    }
}

zed::register_extension!(SftpExtension);

#[cfg(test)]
mod tests {
    use super::{
        host_extension_dir_candidates, host_script_candidates, node_script_launcher_args,
        slash_command_action, NODE_SCRIPT_RESOLVER,
    };
    use std::path::PathBuf;

    #[test]
    fn derives_work_and_installed_extension_roots_from_work_directory() {
        let current_dir = PathBuf::from("/tmp/zed/extensions/work/sftp");

        assert_eq!(
            host_extension_dir_candidates(&current_dir),
            vec![
                PathBuf::from("/tmp/zed/extensions/work/sftp"),
                PathBuf::from("/tmp/zed/extensions/installed/sftp"),
            ]
        );
    }

    #[test]
    fn derives_script_candidates_from_work_directory() {
        let current_dir = PathBuf::from("/tmp/zed/extensions/work/sftp");

        assert_eq!(
            host_script_candidates(&current_dir, "server/bootstrap.js"),
            vec![
                "/tmp/zed/extensions/work/sftp/server/bootstrap.js".to_string(),
                "/tmp/zed/extensions/installed/sftp/server/bootstrap.js".to_string(),
            ]
        );
    }

    #[test]
    fn builds_node_launcher_args_with_script_candidates_and_forwarded_args() {
        let current_dir = PathBuf::from("/tmp/zed/extensions/work/sftp");

        assert_eq!(
            node_script_launcher_args(
                &current_dir,
                "Server bootstrap file",
                "server/bootstrap.js",
                vec!["--stdio".to_string()]
            ),
            vec![
                "-e".to_string(),
                NODE_SCRIPT_RESOLVER.to_string(),
                "Server bootstrap file".to_string(),
                "/tmp/zed/extensions/work/sftp/server/bootstrap.js".to_string(),
                "/tmp/zed/extensions/installed/sftp/server/bootstrap.js".to_string(),
                "--".to_string(),
                "--stdio".to_string(),
            ]
        );
    }

    #[test]
    fn maps_registered_slash_command_names_to_actions() {
        assert_eq!(slash_command_action("sftp-upload"), Ok("upload"));
        assert_eq!(slash_command_action("sftp-download"), Ok("download"));
        assert_eq!(slash_command_action("sftp-sync"), Ok("sync"));
    }
}
