use serde_json::{Value, json};
use tokio::{fs, io::AsyncWriteExt};
use uuid::Uuid;

use super::AgentLaunch;

pub const HOOK_MARKER: &str = "RUIMTE_HOOK_URL";

const CLAUDE_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PostToolUseFailure",
    "PermissionRequest",
    "Notification",
    "Elicitation",
    "ElicitationResult",
    "SubagentStop",
    "Stop",
    "StopFailure",
    "SessionEnd",
];

const CODEX_EVENTS: &[&str] = &[
    "SessionStart",
    "UserPromptSubmit",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "SubagentStop",
    "Stop",
    "Interrupt",
    "SessionEnd",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HookOutcome {
    pub agent_session_id: String,
    pub transcript_path: Option<String>,
    pub status: Option<String>,
    pub permission_mode: Option<String>,
}

pub fn events(kind: &str) -> Option<&'static [&'static str]> {
    match kind {
        "claude" => Some(CLAUDE_EVENTS),
        "codex" => Some(CODEX_EVENTS),
        _ => None,
    }
}

#[cfg(test)]
pub fn takes_context(kind: &str) -> bool {
    matches!(kind, "claude" | "codex")
}

pub fn normalize(body: &Value) -> Option<HookOutcome> {
    let hook = body.as_object()?;
    let agent_session_id = nonempty(hook.get("session_id"))?.to_owned();
    let event = nonempty(hook.get("hook_event_name"))?;
    let status = match event {
        "SessionStart" | "Stop" | "Interrupt" => Some("idle"),
        "UserPromptSubmit" | "PostToolUse" | "PostToolUseFailure" | "PostToolBatch"
        | "PermissionDenied" | "ElicitationResult" | "SubagentStart" | "SubagentStop"
        | "PreCompact" | "PostCompact" => Some("running"),
        "PermissionRequest" | "Elicitation" => Some("needs-you"),
        "PreToolUse" if nonempty(hook.get("tool_name")) == Some("AskUserQuestion") => {
            Some("needs-you")
        }
        "PreToolUse" => Some("running"),
        "StopFailure" => Some("error"),
        "SessionEnd" => None,
        "Notification" => match nonempty(hook.get("notification_type")) {
            Some("permission_prompt" | "elicitation_dialog") => Some("needs-you"),
            Some("idle_prompt") => Some("idle"),
            _ => return None,
        },
        _ => return None,
    };
    Some(HookOutcome {
        agent_session_id,
        transcript_path: nonempty(hook.get("transcript_path")).map(str::to_owned),
        status: status.map(str::to_owned),
        permission_mode: nonempty(hook.get("permission_mode")).map(str::to_owned),
    })
}

pub fn mode_of(kind: &str, permission_mode: Option<&str>, launched: &str) -> Option<String> {
    let permission_mode = permission_mode?;
    if kind == "codex" && permission_mode == "default" {
        return Some(
            if launched == "full-access" {
                "supervised"
            } else {
                launched
            }
            .to_owned(),
        );
    }
    Some(
        match permission_mode {
            "acceptEdits" => "auto-accept-edits",
            "auto" => "auto",
            "bypassPermissions" => "full-access",
            _ => "supervised",
        }
        .to_owned(),
    )
}

pub fn command(kind: &str, event: Option<&str>) -> String {
    let max_time = if event == Some("PermissionRequest") {
        120
    } else {
        2
    };
    format!(
        "if [ -n \"$RUIMTE_HOOK_URL\" ]; then curl -sf -m {max_time} -X POST \"$RUIMTE_HOOK_URL/{kind}\" -H \"Authorization: Bearer $RUIMTE_HOOK_TOKEN\" -H \"Content-Type: application/json\" --data-binary @-; else cat >/dev/null 2>&1; fi; exit 0"
    )
}

pub fn terminal_command(launch: &AgentLaunch) -> String {
    terminal_command_with_note(launch, None)
}

fn terminal_command_with_note(launch: &AgentLaunch, note: Option<&str>) -> String {
    if launch.resume.is_some() {
        let resumed = launch_line(launch, None);
        let mut fresh = launch.clone();
        fresh.resume = None;
        return format!("{resumed} || {}", launch_line(&fresh, note));
    }
    launch_line(launch, note)
}

pub fn terminal_command_with_prompt(
    launch: &AgentLaunch,
    prompt: Option<&str>,
    note: Option<&str>,
) -> String {
    let mut command = terminal_command_with_note(launch, note);
    if launch.resume.is_none()
        && let Some(prompt) = prompt
    {
        match launch.kind.as_str() {
            "gemini" => command.push_str(&format!(" -i {}", quote(prompt))),
            "copilot" => command.push_str(&format!(" -p {}", quote(prompt))),
            _ => command.push_str(&format!(" {}", quote(prompt))),
        }
    }
    command
}

fn launch_line(launch: &AgentLaunch, note: Option<&str>) -> String {
    let mut flags = launch_flags(launch);
    if launch.kind == "codex"
        && launch.resume.is_none()
        && let Some(note) = note
    {
        let note = serde_json::to_string(note).expect("a string serializes to JSON");
        flags.extend(["-c".to_owned(), format!("developer_instructions={note}")]);
    }
    let flags = flags.iter().map(|flag| quote(flag)).collect::<Vec<_>>();
    let executable = launch.kind.as_str();
    match launch.resume.as_deref() {
        Some(id) if launch.kind == "codex" => {
            format!("codex resume {} {}", flags.join(" "), quote(id))
        }
        Some(id) if launch.kind == "copilot" => {
            format!(
                "copilot {} {}",
                flags.join(" "),
                quote(&format!("--resume={id}"))
            )
        }
        Some(id) => format!("{} {} --resume {}", executable, flags.join(" "), quote(id)),
        None => std::iter::once(executable.to_owned())
            .chain(flags)
            .collect::<Vec<_>>()
            .join(" "),
    }
}

pub fn resume_command(launch: &AgentLaunch, agent_session_id: &str) -> String {
    let mut launch = launch.clone();
    launch.resume = Some(agent_session_id.to_owned());
    terminal_command(&launch)
}

fn launch_flags(launch: &AgentLaunch) -> Vec<String> {
    let mode = launch
        .runtime_mode
        .as_deref()
        .unwrap_or(if launch.resume.is_some() {
            "supervised"
        } else {
            "full-access"
        });
    let mut flags = match (launch.kind.as_str(), mode) {
        ("claude", "auto-accept-edits") => vec![
            "--allowedTools=Bash(ruimte-context *)".into(),
            "--permission-mode".into(),
            "acceptEdits".into(),
        ],
        ("claude", "auto") => vec![
            "--allowedTools=Bash(ruimte-context *)".into(),
            "--permission-mode".into(),
            "auto".into(),
        ],
        ("claude", "full-access") => vec![
            "--allowedTools=Bash(ruimte-context *)".into(),
            "--permission-mode".into(),
            "bypassPermissions".into(),
        ],
        ("claude", _) => vec!["--allowedTools=Bash(ruimte-context *)".into()],
        ("codex", "full-access") => vec![
            "--ask-for-approval".into(),
            "never".into(),
            "--sandbox".into(),
            "danger-full-access".into(),
        ],
        ("codex", _) => vec![
            "--ask-for-approval".into(),
            "on-request".into(),
            "--sandbox".into(),
            "workspace-write".into(),
        ],
        ("gemini", "auto-accept-edits") => {
            vec!["--approval-mode".into(), "auto_edit".into()]
        }
        ("gemini", "full-access") => vec!["--approval-mode".into(), "yolo".into()],
        _ => Vec::new(),
    };
    if let Some(model) = &launch.model
        && matches!(launch.kind.as_str(), "claude" | "codex")
    {
        flags.extend(["--model".into(), model.clone()]);
    }
    flags
}

fn quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

pub fn merge(config: &Value, kind: &str) -> (Value, bool) {
    let mut root = config.as_object().cloned().unwrap_or_default();
    let mut hooks = root
        .get("hooks")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let wanted = events(kind).unwrap_or_default();
    let mut event_names = wanted
        .iter()
        .map(|event| (*event).to_owned())
        .collect::<Vec<_>>();
    for event in hooks.keys() {
        if !event_names.contains(event) {
            event_names.push(event.clone());
        }
    }
    let mut changed = false;
    for event in event_names {
        let wanted_event = wanted.contains(&event.as_str());
        let wanted_entry = hook_entry(kind, &event);
        let groups = hooks
            .get(&event)
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut placed = false;
        let mut next_groups = Vec::new();
        for group in groups {
            let Some(group_object) = group.as_object() else {
                next_groups.push(group);
                continue;
            };
            let Some(group_hooks) = group_object.get("hooks").and_then(Value::as_array) else {
                next_groups.push(group);
                continue;
            };
            let mut kept = Vec::new();
            let mut group_changed = false;
            for hook in group_hooks {
                if !is_ours(hook) {
                    kept.push(hook.clone());
                } else if wanted_event && !placed {
                    placed = true;
                    if hook == &wanted_entry {
                        kept.push(hook.clone());
                    } else {
                        kept.push(wanted_entry.clone());
                        group_changed = true;
                    }
                } else {
                    group_changed = true;
                }
            }
            changed |= group_changed;
            if !kept.is_empty() {
                if group_changed {
                    let mut next = group_object.clone();
                    next.insert("hooks".to_owned(), Value::Array(kept));
                    next_groups.push(Value::Object(next));
                } else {
                    next_groups.push(group);
                }
            } else if group_hooks.is_empty() {
                next_groups.push(group);
            }
        }
        if wanted_event && !placed {
            next_groups.push(json!({ "hooks": [wanted_entry] }));
            changed = true;
        }
        if next_groups.is_empty() {
            hooks.remove(&event);
        } else {
            hooks.insert(event, Value::Array(next_groups));
        }
    }
    root.insert("hooks".to_owned(), Value::Object(hooks));
    (Value::Object(root), changed)
}

pub async fn install_defaults() -> anyhow::Result<()> {
    let home = std::env::var_os("HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| std::path::PathBuf::from("/"));
    let claude = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(".claude"))
        .join("settings.json");
    let codex_home = std::env::var_os("CODEX_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| home.join(".codex"));
    install_file(&claude, "claude").await?;
    install_file(&codex_home.join("hooks.json"), "codex").await?;
    write_if_changed(
        &codex_home.join("rules/ruimte.rules"),
        b"# Written by Ruimte; it is rewritten when it changes.\nprefix_rule(pattern=[\"ruimte-context\"], decision=\"allow\")\n",
        0o644,
    )
    .await?;
    Ok(())
}

async fn install_file(path: &std::path::Path, kind: &str) -> anyhow::Result<()> {
    let existing = match fs::read(path).await {
        Ok(raw) => serde_json::from_slice(&raw)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => json!({}),
        Err(error) => return Err(error.into()),
    };
    let (config, changed) = merge(&existing, kind);
    if changed {
        let mut body = serde_json::to_vec_pretty(&config)?;
        body.push(b'\n');
        write_if_changed(path, &body, 0o644).await?;
    }
    Ok(())
}

async fn write_if_changed(path: &std::path::Path, body: &[u8], mode: u32) -> anyhow::Result<()> {
    if fs::read(path).await.ok().as_deref() == Some(body) {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("hook path has no parent"))?;
    fs::create_dir_all(parent).await?;
    let temporary = path.with_extension(format!("tmp.{}", Uuid::new_v4()));
    let result = async {
        let mut options = fs::OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(mode);
        let mut file = options.open(&temporary).await?;
        file.write_all(body).await?;
        file.sync_all().await?;
        drop(file);
        fs::rename(&temporary, path).await?;
        anyhow::Ok(())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temporary).await;
    }
    result
}

fn hook_entry(kind: &str, event: &str) -> Value {
    json!({
        "type": "command",
        "command": command(kind, Some(event)),
        "timeout": if event == "PermissionRequest" { 125 } else { 3 },
    })
}

fn is_ours(value: &Value) -> bool {
    value
        .get("command")
        .and_then(Value::as_str)
        .is_some_and(|command| command.contains(HOOK_MARKER))
}

fn nonempty(value: Option<&Value>) -> Option<&str> {
    value?.as_str().filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_typescript_hook_oracle() {
        let fixture: Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../apps/server-rust/tests/fixtures/agent-hooks.json"
        )))
        .unwrap();
        for case in fixture["hooks"].as_array().unwrap() {
            let actual = normalize(&case["input"]).map(|outcome| {
                json!({
                    "agentSessionId": outcome.agent_session_id,
                    "transcriptPath": outcome.transcript_path,
                    "status": outcome.status,
                    "permissionMode": outcome.permission_mode,
                })
            });
            assert_eq!(actual.unwrap_or(Value::Null), case["expected"]);
        }
        for case in fixture["modes"].as_array().unwrap() {
            assert_eq!(
                mode_of(
                    case["kind"].as_str().unwrap(),
                    case["permission"].as_str(),
                    case["launched"].as_str().unwrap(),
                )
                .map(Value::String)
                .unwrap_or(Value::Null),
                case["expected"]
            );
        }
        for case in fixture["capabilities"].as_array().unwrap() {
            let kind = case["kind"].as_str().unwrap();
            assert_eq!(events(kind).is_some(), case["hasHooks"].as_bool().unwrap());
            assert_eq!(takes_context(kind), case["takesContext"].as_bool().unwrap());
        }
        for case in fixture["merges"].as_array().unwrap() {
            let (config, changed) = merge(&case["input"], case["kind"].as_str().unwrap());
            assert_eq!(config, case["expected"]["config"]);
            assert_eq!(changed, case["expected"]["changed"].as_bool().unwrap());
        }
        for case in fixture["commands"].as_array().unwrap() {
            assert_eq!(
                command(case["kind"].as_str().unwrap(), case["event"].as_str()),
                case["expected"].as_str().unwrap()
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn terminal_launch_survives_one_shell_parse_without_splitting_arguments() {
        use std::os::unix::fs::PermissionsExt;

        let temporary = tempfile::tempdir().unwrap();
        let executable = temporary.path().join("claude");
        std::fs::write(&executable, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let launch = AgentLaunch {
            kind: "claude".into(),
            runtime_mode: Some("full-access".into()),
            model: Some("model with spaces'quote".into()),
            resume: None,
        };
        let output = std::process::Command::new("/bin/sh")
            .args(["-c", &terminal_command(&launch)])
            .env("PATH", temporary.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout)
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            [
                "--allowedTools=Bash(ruimte-context *)",
                "--permission-mode",
                "bypassPermissions",
                "--model",
                "model with spaces'quote",
            ]
        );

        let executable = temporary.path().join("codex");
        std::fs::write(&executable, "#!/bin/sh\nprintf '%s\\n' \"$@\"\n").unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let launch = AgentLaunch {
            kind: "codex".into(),
            runtime_mode: Some("auto".into()),
            model: None,
            resume: None,
        };
        let note = "Run `ruimte-context help`; it's \"quoted\"\nand \\ kept";
        let output = std::process::Command::new("/bin/sh")
            .args([
                "-c",
                &terminal_command_with_prompt(&launch, Some("go"), Some(note)),
            ])
            .env("PATH", temporary.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(
            String::from_utf8(output.stdout)
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            [
                "--ask-for-approval",
                "on-request",
                "--sandbox",
                "workspace-write",
                "-c",
                "developer_instructions=\"Run `ruimte-context help`; it's \\\"quoted\\\"\\nand \\\\ kept\"",
                "go",
            ]
        );
    }
}
